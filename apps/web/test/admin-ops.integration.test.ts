import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createIsolatedDb, type IsolatedDb } from "./helpers/isolated-db";

const adminUrl = process.env["TEST_ADMIN_URL"];
const serviceUrl = process.env["TEST_SERVICE_URL"];
if (process.env["CI"] && !(adminUrl && serviceUrl)) throw new Error("TEST_ADMIN_URL / TEST_SERVICE_URL requis en CI");
const run = adminUrl && serviceUrl ? describe : describe.skip;

const PEPPER = "p".repeat(40);

run("portail admin : opérations et journal d'audit (base isolée)", () => {
  let iso: IsolatedDb;
  let db: import("@mon-agent-ia/db").Db;
  const ctx = { userId: "staff-admin", ip: "203.0.113.50", userAgent: "vitest", pepper: PEPPER };
  const mk = (id: string, extra: Record<string, unknown> = {}) => db.user.create({ data: { id, name: id, email: `${id}@exemple.test`, emailVerified: true, ...extra } });
  const session = (userId: string, n: number) => db.session.createMany({ data: Array.from({ length: n }, (_, i) => ({ id: `${userId}-s${i}`, token: `${userId}-t${i}`, userId, expiresAt: new Date(Date.now() + 3600_000) })) });
  const auditOf = (action: string, targetId: string) => db.auditLog.findMany({ where: { action, targetId } });

  beforeAll(async () => {
    iso = await createIsolatedDb(adminUrl!, serviceUrl!);
    const { createDb } = await import("@mon-agent-ia/db");
    db = createDb(iso.url);
    await mk("staff-admin", { staffRole: "ADMIN" });
    await mk("staff-support", { staffRole: "SUPPORT" });
  });
  afterAll(async () => {
    await db?.$disconnect();
    await iso?.drop();
  });

  it("suspension : compte marqué, toutes les sessions fermées, action journalisée avec motif (IP hachée)", async () => {
    const { banUserOp } = await import("../src/server/admin/ops");
    await mk("victim");
    await session("victim", 3);
    await mk("bystander");
    await session("bystander", 1);

    const r = await banUserOp(db, ctx, { id: "victim", reason: "fraude avérée" });
    expect(r.ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: "victim" } })).bannedAt).toBeInstanceOf(Date);
    expect(await db.session.count({ where: { userId: "victim" } })).toBe(0);
    expect(await db.session.count({ where: { userId: "bystander" } })).toBe(1); // les autres comptes ne sont pas touchés

    const [row] = await auditOf("admin.user.ban", "victim");
    expect(row).toMatchObject({ actorId: "staff-admin", targetType: "user", metadata: { reason: "fraude avérée", sessionsRevoked: 3 } });
    expect(row!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.50"); // jamais d'IP en clair
  });

  it("suspension refusée : soi-même, un administrateur, un compte inconnu — rien n'est modifié ni journalisé", async () => {
    const { banUserOp } = await import("../src/server/admin/ops");
    await mk("other-admin", { staffRole: "ADMIN" });
    const before = await db.auditLog.count();
    for (const id of ["staff-admin", "other-admin", "nobody"]) {
      const r = await banUserOp(db, ctx, { id, reason: "test" });
      expect(r.ok).toBe(false);
    }
    expect((await banUserOp(db, ctx, { id: "staff-admin", reason: "x" }))).toEqual({ ok: false, error: expect.stringContaining("propre compte") });
    expect((await db.user.findMany({ where: { id: { in: ["staff-admin", "other-admin"] } } })).every((u) => u.bannedAt === null)).toBe(true);
    expect(await db.auditLog.count()).toBe(before);
  });

  it("réactivation : seulement si le compte est suspendu", async () => {
    const { unbanUserOp } = await import("../src/server/admin/ops");
    expect((await unbanUserOp(db, ctx, { id: "bystander", reason: "test" })).ok).toBe(false);
    expect(await auditOf("admin.user.unban", "bystander")).toHaveLength(0);

    expect((await unbanUserOp(db, ctx, { id: "victim", reason: "erreur de ma part" })).ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: "victim" } })).bannedAt).toBeNull();
    expect((await auditOf("admin.user.unban", "victim"))[0]!.metadata).toMatchObject({ reason: "erreur de ma part" });
    expect((await unbanUserOp(db, ctx, { id: "victim", reason: "deux fois" })).ok).toBe(false); // idempotent : pas de second journal
    expect(await auditOf("admin.user.unban", "victim")).toHaveLength(1);
  });

  it("fermeture des sessions : nombre exact, journalisé", async () => {
    const { revokeSessionsOp } = await import("../src/server/admin/ops");
    await mk("travel");
    await session("travel", 2);
    const r = await revokeSessionsOp(db, ctx, { id: "travel", reason: "appareil perdu" });
    expect(r).toEqual({ ok: true, message: "2 session(s) fermée(s)." });
    expect(await db.session.count({ where: { userId: "travel" } })).toBe(0);
    expect((await auditOf("admin.user.revoke_sessions", "travel"))[0]!.metadata).toMatchObject({ count: 2, reason: "appareil perdu" });
  });

  it("notes de support : 1 à 500 caractères (contrainte en base), le corps de la note n'est jamais copié dans le journal", async () => {
    const { addNoteOp } = await import("../src/server/admin/ops");
    await mk("noted");
    expect((await addNoteOp(db, ctx, { id: "noted", body: "A rappelé : facture contestée" })).ok).toBe(true);
    expect((await addNoteOp(db, ctx, { id: "ghost", body: "x" })).ok).toBe(false);
    const audits = await auditOf("admin.note.add", "noted");
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain("facture contestée");

    const before = await db.auditLog.count();
    await expect(addNoteOp(db, ctx, { id: "noted", body: "x".repeat(501) })).rejects.toThrow();
    await expect(addNoteOp(db, ctx, { id: "noted", body: "" })).rejects.toThrow();
    expect(await db.auditLog.count()).toBe(before); // l'échec n'écrit pas de journal « réussi »
    expect(await db.supportNote.count({ where: { userId: "noted" } })).toBe(1);

    // Les notes suivent la suppression du compte (RGPD) et sont fermées au rôle applicatif.
    await db.user.delete({ where: { id: "noted" } });
    expect(await db.supportNote.count({ where: { userId: "noted" } })).toBe(0);
  });

  it("suppression de compte : avancer l'échéance ou annuler, uniquement si en attente", async () => {
    const { updateDeletionOp } = await import("../src/server/admin/ops");
    const inThirty = new Date(Date.now() + 30 * 86_400_000);
    await mk("leaving", { deletionRequestedAt: new Date() });
    const req = await db.deletionRequest.create({ data: { userId: "leaving", scheduledFor: inThirty } });

    expect((await updateDeletionOp(db, ctx, { id: req.id, action: "execute_now", reason: "demande écrite" })).ok).toBe(true);
    const sooner = await db.deletionRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(sooner.status).toBe("PENDING"); // c'est le worker qui exécute
    expect(sooner.scheduledFor.getTime()).toBeLessThanOrEqual(Date.now());

    await mk("hesitant", { deletionRequestedAt: new Date() });
    const req2 = await db.deletionRequest.create({ data: { userId: "hesitant", scheduledFor: inThirty } });
    expect((await updateDeletionOp(db, ctx, { id: req2.id, action: "cancel", reason: "s'est rétracté" })).ok).toBe(true);
    expect((await db.deletionRequest.findUniqueOrThrow({ where: { id: req2.id } })).status).toBe("CANCELLED");
    expect((await db.user.findUniqueOrThrow({ where: { id: "hesitant" } })).deletionRequestedAt).toBeNull();

    expect((await updateDeletionOp(db, ctx, { id: req2.id, action: "cancel", reason: "encore" })).ok).toBe(false); // déjà annulée
    await db.deletionRequest.update({ where: { id: req.id }, data: { status: "PROCESSING" } });
    expect((await updateDeletionOp(db, ctx, { id: req.id, action: "execute_now", reason: "trop tard" })).ok).toBe(false); // en cours : on n'y touche pas
    expect((await updateDeletionOp(db, ctx, { id: randomUUID(), action: "cancel", reason: "inconnue" })).ok).toBe(false);
    expect((await auditOf("admin.deletion.cancel", req2.id))[0]!.metadata).toMatchObject({ reason: "s'est rétracté" });
  });

  it("consultation d'une fiche : une ligne de journal, pas de doublon pour les rechargements rapprochés", async () => {
    const { recordUserView } = await import("../src/server/admin/audit");
    await mk("viewed");
    const view = { actorId: "staff-support", targetId: "viewed", ip: "203.0.113.60" };
    expect(await recordUserView(db, view, PEPPER)).toBe(true);
    expect(await recordUserView(db, view, PEPPER)).toBe(false); // rafraîchissement après une action
    expect(await recordUserView(db, { ...view, actorId: "staff-admin" }, PEPPER)).toBe(true); // autre agent : tracé
    expect(await recordUserView(db, { ...view, targetId: "bystander" }, PEPPER)).toBe(true); // autre personne : tracé
    expect(await recordUserView(db, view, PEPPER, new Date(Date.now() + 3 * 60_000))).toBe(true); // plus tard : tracé de nouveau
    expect(await db.auditLog.count({ where: { action: "admin.user.view", targetId: "viewed", actorId: "staff-support" } })).toBe(2);
  });

  it("journal : append-only, même pour le rôle de service", async () => {
    const [row] = await db.auditLog.findMany({ take: 1 });
    await expect(db.auditLog.update({ where: { id: row!.id }, data: { action: "falsifié" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: row!.id } })).rejects.toThrow();
    await expect(db.auditLog.deleteMany({})).rejects.toThrow();
  });

  it("journal : filtres (préfixe d'action littéral, foyer, auteur) et pagination par curseur sans perte ni doublon", async () => {
    const { listAudit, encodeCursor, decodeCursor } = await import("../src/server/admin/audit");
    const household = randomUUID();
    const tie = new Date("2026-03-01T10:00:00.000Z");
    const rows = [
      // 70 lignes à la MÊME milliseconde : un curseur sur la seule date en perdrait à la frontière d'une page.
      ...Array.from({ length: 70 }, (_, i) => ({ action: "pg.tie", householdId: household, actorId: "pg-actor", metadata: { i }, createdAt: tie })),
      ...Array.from({ length: 50 }, (_, i) => ({ action: "pg.seq", householdId: household, actorId: "pg-actor", metadata: { i }, createdAt: new Date(tie.getTime() + (i + 1) * 1000) })),
      { action: "pgX.other", householdId: null, actorId: "someone", createdAt: tie },
    ];
    await db.auditLog.createMany({ data: rows });

    const seen: string[] = [];
    let cursor: ReturnType<typeof decodeCursor>;
    let pages = 0;
    for (;;) {
      const page = await listAudit(db, { householdId: household, before: cursor });
      pages++;
      seen.push(...page.rows.map((r) => r.id));
      expect(page.rows.length).toBeLessThanOrEqual(50);
      if (!page.next) break;
      cursor = decodeCursor(encodeCursor(page.next)); // aller-retour par l'URL
      expect(cursor).toBeDefined();
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120); // aucun doublon, aucune ligne perdue
    expect((await listAudit(db, { householdId: household })).rows[0]!.action).toBe("pg.seq"); // plus récent d'abord

    // Filtres : le préfixe est littéral (« pg_ » ne doit pas jouer le rôle de « pgX »).
    expect((await listAudit(db, { action: "pg." , actorId: "pg-actor" })).rows.every((r) => r.action.startsWith("pg."))).toBe(true);
    expect((await listAudit(db, { action: "pg_" })).rows).toHaveLength(0);
    expect((await listAudit(db, { action: "pg%" })).rows).toHaveLength(0);
    expect((await listAudit(db, { action: "pgX" })).rows).toHaveLength(1);
    expect((await listAudit(db, { householdId: "pas-un-uuid" })).rows.length).toBeGreaterThan(0); // identifiant invalide ignoré, pas d'erreur SQL

    expect(decodeCursor("n'importe quoi")).toBeUndefined();
    expect(decodeCursor(`2026-03-01T10:00:00.000Z_${household}`)).toBeDefined();
    expect(decodeCursor(`pas-une-date_${household}`)).toBeUndefined();
    expect(decodeCursor("2026-03-01T10:00:00.000Z_'; DROP TABLE users;--")).toBeUndefined();
  });

  it("RGPD : sans purge enregistrée, le portail l'indique (null) ; après une purge, il montre la dernière", async () => {
    const { getPrivacyOverview } = await import("../src/server/admin/metrics");
    expect((await getPrivacyOverview(db, new Date())).lastPurge).toBeNull();
    await db.auditLog.create({ data: { actorId: "worker", action: "retention.purged", metadata: { loginEvents: 2, aiRuns: 0, failed: "" } } });
    expect((await getPrivacyOverview(db, new Date())).lastPurge).toMatchObject({ deleted: 2, failed: [] });
  });

  it("export RGPD : les notes de support de la personne concernée y figurent, sans l'identité de l'agent", async () => {
    const { buildExport } = await import("../src/server/export");
    await mk("subject");
    await db.supportNote.create({ data: { userId: "subject", authorId: "staff-admin", body: "Dossier relancé par téléphone" } });
    const data = await buildExport(db, "subject", new Date(), db);
    expect(data.supportNotes).toEqual([{ body: "Dossier relancé par téléphone", createdAt: expect.any(Date) }]);
    expect(JSON.stringify(data)).not.toContain("staff-admin");
    expect((await buildExport(db, "subject", new Date())).supportNotes).toEqual([]); // sans client de service : pas d'accès à la table
  });
});
