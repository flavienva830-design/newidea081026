import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@mon-agent-ia/db";
import { RETENTION_DAYS, purgeExpiredData } from "../src/retention.ts";

const adminUrl = process.env["TEST_ADMIN_URL"];
const svcUrl = process.env["TEST_SERVICE_URL"];
if (process.env["CI"] && !(adminUrl && svcUrl)) throw new Error("TEST_ADMIN_URL / TEST_SERVICE_URL requis en CI");
const run = adminUrl && svcUrl ? describe : describe.skip;

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const D = RETENTION_DAYS;

/**
 * Purge de rétention sur la base de test commune : chaque test crée SES lignes (identifiants uniques, dates explicites) et ne
 * vérifie que celles-ci. Une ligne plus ancienne que la durée est supprimée, une plus récente est conservée, y compris à la limite.
 */
run("purge de rétention des données d'exploitation", () => {
  let admin: Db;
  let svc: Db;
  const tag = randomUUID().slice(0, 8);
  const exists = async (table: string, id: string) => (await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}" WHERE "id" = $1`, id))[0]!.n === 1;
  const user = async (label: string) => {
    const id = `ret-${label}-${tag}-${randomUUID().slice(0, 6)}`;
    await admin.user.create({ data: { id, name: label, email: `${id}@t.test` } });
    return id;
  };
  const household = async () => {
    const id = randomUUID();
    await admin.household.create({ data: { id, name: "R", wrappedDek: Buffer.from("x") } });
    return id;
  };

  beforeAll(() => {
    admin = createDb(adminUrl!);
    svc = createDb(svcUrl!);
  });
  afterAll(async () => {
    await admin.$disconnect();
    await svc.$disconnect();
  });

  it("connexions, appels IA, événements Stripe : supprimés après leur durée, conservés avant (limite incluse)", async () => {
    const mk = (days: number) => admin.loginEvent.create({ data: { emailHash: `ret-${tag}`, success: true, method: "password", ipHash: "i", createdAt: ago(days) }, select: { id: true } });
    const oldLogin = await mk(D.loginEvents + 1);
    const edgeLogin = await mk(D.loginEvents - 1);
    const freshLogin = await mk(1);

    const run_ = (days: number) => admin.aiRun.create({ data: { task: "ANALYZE", model: "m", promptVersion: `ret-${tag}`, status: "OK", createdAt: ago(days) }, select: { id: true } });
    const oldRun = await run_(D.aiRuns + 1);
    const edgeRun = await run_(D.aiRuns - 1);

    const evt = (suffix: string, days: number) => admin.stripeEvent.create({ data: { id: `evt_ret_${tag}_${suffix}`, type: "invoice.paid", receivedAt: ago(days) }, select: { id: true } });
    const oldEvt = await evt("old", D.stripeEvents + 1);
    const edgeEvt = await evt("edge", D.stripeEvents - 1);

    const r = await purgeExpiredData({ db: svc });
    expect(r.failed).toEqual([]);
    expect(await exists("login_events", oldLogin.id)).toBe(false);
    expect(await exists("login_events", edgeLogin.id)).toBe(true);
    expect(await exists("login_events", freshLogin.id)).toBe(true);
    expect(await exists("ai_runs", oldRun.id)).toBe(false);
    expect(await exists("ai_runs", edgeRun.id)).toBe(true);
    expect(await exists("stripe_events", oldEvt.id)).toBe(false);
    expect(await exists("stripe_events", edgeEvt.id)).toBe(true);
    expect(r.deleted.loginEvents).toBeGreaterThanOrEqual(1);
    expect(r.deleted.aiRuns).toBeGreaterThanOrEqual(1);
    expect(r.deleted.stripeEvents).toBeGreaterThanOrEqual(1);
  });

  it("notifications : lues après 6 mois, toutes après 12 mois ; non lues récentes conservées", async () => {
    const u = await user("notif");
    const mk = (readDays: number | null, ageDays: number) =>
      admin.notification.create({ data: { userId: u, type: "t", title: "x", readAt: readDays === null ? null : ago(readDays), createdAt: ago(ageDays) }, select: { id: true } });
    const readOld = await mk(1, D.notificationsRead + 1);
    const readRecent = await mk(1, D.notificationsRead - 1);
    const unreadOld = await mk(null, D.notificationsRead + 30); // non lue, mais < 12 mois : conservée
    const unreadAncient = await mk(null, D.notificationsAny + 1);
    await purgeExpiredData({ db: svc });
    expect(await exists("notifications", readOld.id)).toBe(false);
    expect(await exists("notifications", readRecent.id)).toBe(true);
    expect(await exists("notifications", unreadOld.id)).toBe(true);
    expect(await exists("notifications", unreadAncient.id)).toBe(false);
  });

  it("rappels : seuls les rappels déjà traités sont purgés, jamais un rappel encore à envoyer", async () => {
    const u = await user("rem");
    const h = await household();
    await admin.membership.create({ data: { householdId: h, userId: u, role: "OWNER" } });
    const dl = await admin.deadline.create({ data: { householdId: h, kind: "PAYMENT", title: "x", dueDate: ago(-30) }, select: { id: true } });
    const mk = (status: "PENDING" | "SENT" | "FAILED", days: number) =>
      admin.reminder.create({ data: { householdId: h, deadlineId: dl.id, channel: "EMAIL", remindAt: ago(days), status }, select: { id: true } });
    const sentOld = await mk("SENT", D.reminders + 1);
    const failedOld = await mk("FAILED", D.reminders + 1);
    const pendingOld = await mk("PENDING", D.reminders + 1);
    const sentRecent = await mk("SENT", D.reminders - 1);
    await purgeExpiredData({ db: svc });
    expect(await exists("reminders", sentOld.id)).toBe(false);
    expect(await exists("reminders", failedOld.id)).toBe(false);
    expect(await exists("reminders", pendingOld.id)).toBe(true);
    expect(await exists("reminders", sentRecent.id)).toBe(true);
  });

  it("sessions et jetons de vérification expirés : supprimés ; valides ou récemment expirés : conservés", async () => {
    const u = await user("sess");
    const s = (n: string, expiresInDays: number) => admin.session.create({ data: { id: `ret-${tag}-${n}`, token: `ret-${tag}-${n}`, userId: u, expiresAt: ago(-expiresInDays) }, select: { id: true } });
    const expiredLong = await s("a", -(D.sessions + 1));
    const expiredRecent = await s("b", -(D.sessions - 1));
    const valid = await s("c", 5);
    const v = (n: string, expiresInDays: number) => admin.verification.create({ data: { id: `ret-${tag}-v-${n}`, identifier: "x", value: "y", expiresAt: ago(-expiresInDays) }, select: { id: true } });
    const vOld = await v("a", -(D.verifications + 1));
    const vRecent = await v("b", -(D.verifications - 1));
    await purgeExpiredData({ db: svc });
    expect(await exists("sessions", expiredLong.id)).toBe(false);
    expect(await exists("sessions", expiredRecent.id)).toBe(true);
    expect(await exists("sessions", valid.id)).toBe(true);
    expect(await exists("verifications", vOld.id)).toBe(false);
    expect(await exists("verifications", vRecent.id)).toBe(true);
  });

  it("invitations : terminées depuis plus de 30 jours supprimées (elles contiennent l'adresse de l'invité) ; en attente conservées", async () => {
    const u = await user("inv");
    const h = await household();
    const hash = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const mk = (n: string, over: Record<string, Date | null>) =>
      admin.invitation.create({ data: { householdId: h, email: `inv-${n}-${tag}@t.test`, role: "READ", tokenHash: hash(), invitedById: u, expiresAt: ago(-7), ...over }, select: { id: true } });
    const accepted = await mk("a", { acceptedAt: ago(D.invitations + 1) });
    const acceptedRecent = await mk("b", { acceptedAt: ago(D.invitations - 1) });
    const revoked = await mk("c", { revokedAt: ago(D.invitations + 1) });
    const expired = await mk("d", { expiresAt: ago(D.invitations + 1) });
    const pending = await mk("e", {});
    await purgeExpiredData({ db: svc });
    expect(await exists("invitations", accepted.id)).toBe(false);
    expect(await exists("invitations", acceptedRecent.id)).toBe(true);
    expect(await exists("invitations", revoked.id)).toBe(false);
    expect(await exists("invitations", expired.id)).toBe(false);
    expect(await exists("invitations", pending.id)).toBe(true);
  });

  it("demandes RGPD terminées, notes de support et compteurs d'usage : durées respectées ; une suppression en attente n'est JAMAIS purgée", async () => {
    const u = await user("priv");
    const dr = (status: "PENDING" | "CANCELLED" | "FAILED", days: number) =>
      admin.deletionRequest.create({ data: { userId: u, status, scheduledFor: ago(-1), createdAt: ago(days) }, select: { id: true } });
    const cancelledOld = await dr("CANCELLED", D.privacyRequests + 1);
    const pendingOld = await dr("PENDING", D.privacyRequests + 1);
    const cancelledRecent = await dr("CANCELLED", D.privacyRequests - 1);
    const note = (days: number) => admin.supportNote.create({ data: { userId: u, authorId: "staff", body: "n", createdAt: ago(days) }, select: { id: true } });
    const noteOld = await note(D.supportNotes + 1);
    const noteRecent = await note(D.supportNotes - 1);
    const h = await household();
    const period = (days: number) => ago(days).toISOString().slice(0, 7);
    const oldCounter = await admin.usageCounter.create({ data: { householdId: h, period: period(D.usageCounters + 62) }, select: { id: true } });
    const recentCounter = await admin.usageCounter.create({ data: { householdId: h, period: period(30) }, select: { id: true } });
    await purgeExpiredData({ db: svc });
    expect(await exists("deletion_requests", cancelledOld.id)).toBe(false);
    expect(await exists("deletion_requests", pendingOld.id)).toBe(true);
    expect(await exists("deletion_requests", cancelledRecent.id)).toBe(true);
    expect(await exists("support_notes", noteOld.id)).toBe(false);
    expect(await exists("support_notes", noteRecent.id)).toBe(true);
    expect(await exists("usage_counters", oldCounter.id)).toBe(false);
    expect(await exists("usage_counters", recentCounter.id)).toBe(true);
  });

  it("journal d'audit : purgé uniquement par la fonction réservée, jamais avant 12 mois, jamais modifiable", async () => {
    const mk = (days: number) => admin.auditLog.create({ data: { actorId: `ret-${tag}`, action: "ret.test", createdAt: ago(days) }, select: { id: true } });
    const ancient = await mk(D.auditLogs + 1);
    const kept = await mk(D.auditLogs - 1);
    const young = await mk(30);

    // Le rôle de service ne peut ni modifier ni supprimer directement, même une ligne très ancienne.
    await expect(svc.auditLog.delete({ where: { id: ancient.id } })).rejects.toThrow();
    await expect(svc.auditLog.update({ where: { id: kept.id }, data: { action: "x" } })).rejects.toThrow();
    // Plancher imposé par la base : refus de raccourcir la durée, et refus de supprimer une ligne de moins de 12 mois même avec l'indicateur de purge.
    await expect(svc.$queryRaw`SELECT purge_audit_logs(interval '6 months')`).rejects.toThrow();
    await expect(
      admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.audit_retention_purge', 'on', true)`;
        await tx.$executeRaw`DELETE FROM audit_logs WHERE "id" = ${young.id}::uuid`;
      }),
    ).rejects.toThrow();
    expect(await exists("audit_logs", young.id)).toBe(true);

    const r = await purgeExpiredData({ db: svc });
    expect(r.failed).toEqual([]);
    expect(await exists("audit_logs", ancient.id)).toBe(false);
    expect(await exists("audit_logs", kept.id)).toBe(true);
    expect(await exists("audit_logs", young.id)).toBe(true);
    expect(r.deleted.auditLogs).toBeGreaterThanOrEqual(1);
    // L'indicateur ne reste pas armé après la purge.
    await expect(svc.auditLog.delete({ where: { id: young.id } })).rejects.toThrow();
  });

  it("la purge laisse sa trace (comptes seulement) dans le journal", async () => {
    await admin.loginEvent.create({ data: { emailHash: `ret-${tag}`, success: true, method: "password", ipHash: "i", createdAt: ago(D.loginEvents + 5) } });
    const t0 = new Date();
    const r = await purgeExpiredData({ db: svc });
    expect(r.deleted.loginEvents).toBeGreaterThanOrEqual(1);
    const rows = await admin.auditLog.findMany({ where: { action: "retention.purged", createdAt: { gte: new Date(t0.getTime() - 1000) } }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(rows[0]).toMatchObject({ actorId: "worker" });
    expect((rows[0]!.metadata as Record<string, unknown>)["loginEvents"]).toBeGreaterThanOrEqual(1);
  });

  it("lots : beaucoup de lignes sont supprimées par paquets, et un second passage ne trouve plus rien", async () => {
    await admin.loginEvent.createMany({ data: Array.from({ length: 53 }, () => ({ emailHash: `ret-${tag}-batch`, success: true, method: "password", ipHash: "i", createdAt: ago(D.loginEvents + 10) })) });
    const first = await purgeExpiredData({ db: svc, batchSize: 7 });
    expect(first.deleted.loginEvents).toBeGreaterThanOrEqual(53);
    expect(await admin.loginEvent.count({ where: { emailHash: `ret-${tag}-batch` } })).toBe(0);
    const second = await purgeExpiredData({ db: svc, batchSize: 7 });
    expect(second.deleted.loginEvents).toBe(0);
  });

  it("l'échec d'une catégorie n'empêche pas les autres et ne recopie jamais le message d'erreur", async () => {
    const flaky = new Proxy(svc, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (prop === "$executeRaw") {
          return (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (JSON.stringify(values).includes("support_notes")) throw new Error("contenu secret de la note");
            return (v as (...a: unknown[]) => unknown).call(target, strings, ...values);
          };
        }
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as Db;
    const old = await admin.loginEvent.create({ data: { emailHash: `ret-${tag}-flaky`, success: true, method: "password", ipHash: "i", createdAt: ago(D.loginEvents + 3) }, select: { id: true } });
    const r = await purgeExpiredData({ db: flaky });
    expect(r.failed).toEqual(["supportNotes"]);
    expect(await exists("login_events", old.id)).toBe(false); // les autres catégories ont été traitées
    const trace = await admin.auditLog.findFirst({ where: { action: "retention.purged" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(trace)).not.toContain("contenu secret");
  });

  it("la politique est cohérente : plancher de 12 mois pour le journal, durées strictement positives", () => {
    expect(D.auditLogs).toBeGreaterThanOrEqual(365);
    for (const [k, v] of Object.entries(D)) expect(v, k).toBeGreaterThan(0);
    expect(D.notificationsRead).toBeLessThanOrEqual(D.notificationsAny);
  });
});
