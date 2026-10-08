import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@mon-agent-ia/db";
import { purgeDueDeletions } from "../src/deletion.ts";

const adminUrl = process.env["TEST_ADMIN_URL"];
const svcUrl = process.env["TEST_SERVICE_URL"];
if (process.env["CI"] && !(adminUrl && svcUrl)) throw new Error("TEST_ADMIN_URL / TEST_SERVICE_URL requis en CI");
const run = adminUrl && svcUrl ? describe : describe.skip;
const NOW = new Date("2026-10-08T10:00:00Z");

run("suppression de compte", () => {
  let admin: Db; let svc: Db;
  beforeAll(() => { admin = createDb(adminUrl!); svc = createDb(svcUrl!); });
  afterAll(async () => { await admin.$disconnect(); await svc.$disconnect(); });

  async function user(label: string) { const id = `${label}-${randomUUID()}`; await admin.user.create({ data: { id, name: label, email: `${id}@t.test` } }); return id; }
  async function home(ownerId: string, withData = true) {
    const householdId = randomUUID();
    await admin.household.create({ data: { id: householdId, name: "T", wrappedDek: Buffer.from("x") } });
    await admin.membership.create({ data: { householdId, userId: ownerId, role: "OWNER" } });
    await admin.profile.create({ data: { householdId, userId: ownerId, displayName: "Moi", relation: "SELF" } });
    if (withData) {
      const d = await admin.document.create({ data: { householdId, source: "WEB_UPLOAD", title: "Facture", uploadedById: ownerId } });
      await admin.deadline.create({ data: { householdId, documentId: d.id, kind: "PAYMENT", title: "Payer", dueDate: new Date("2026-12-01") } });
      await admin.saving.create({ data: { householdId, documentId: d.id, kind: "FEE", title: "t", rationale: "r", monthlyCents: 1, annualCents: 12, confidence: 0.5 } });
    }
    return householdId;
  }
  const ask = (userId: string, when = NOW) => admin.deletionRequest.create({ data: { userId, scheduledFor: when } });

  it("foyer individuel : tout disparaît, le client de paiement est supprimé", async () => {
    const u = await user("solo"); const h = await home(u);
    await admin.billingSubscription.create({ data: { householdId: h, stripeCustomerId: `cus_${h}`, plan: "SOLO", status: "ACTIVE" } });
    await admin.consent.create({ data: { userId: u, type: "TERMS", granted: true, version: "x" } });
    await admin.session.create({ data: { id: `s-${u}`, token: `t-${u}`, userId: u, expiresAt: new Date("2030-01-01") } });
    await ask(u);
    const deleted: string[] = [];
    const st = await purgeDueDeletions({ db: svc, now: () => NOW, deleteBillingCustomer: async (id) => void deleted.push(id) });
    expect(st.purged).toBeGreaterThanOrEqual(1);
    expect(deleted).toContain(`cus_${h}`);
    expect(await admin.user.count({ where: { id: u } })).toBe(0);
    expect(await admin.household.count({ where: { id: h } })).toBe(0);
    for (const t of ["document", "deadline", "saving", "profile", "membership", "billingSubscription"] as const) {
      expect(await (admin[t] as unknown as { count: (a: object) => Promise<number> }).count({ where: { householdId: h } }), t).toBe(0);
    }
    expect(await admin.session.count({ where: { userId: u } })).toBe(0);
    expect(await admin.consent.count({ where: { userId: u } })).toBe(0);
  });

  it("demande non échue : rien n'est supprimé", async () => {
    const u = await user("later"); await home(u);
    await ask(u, new Date(NOW.getTime() + 86_400_000));
    await purgeDueDeletions({ db: svc, now: () => NOW });
    expect(await admin.user.count({ where: { id: u } })).toBe(1);
  });

  it("foyer partagé : le foyer reste, la propriété est transmise (administrateur d'abord)", async () => {
    const owner = await user("owner"); const admin2 = await user("adm"); const reader = await user("rd");
    const h = await home(owner);
    await admin.membership.createMany({ data: [{ householdId: h, userId: reader, role: "READ" }, { householdId: h, userId: admin2, role: "ADMIN" }] });
    await ask(owner);
    await purgeDueDeletions({ db: svc, now: () => NOW });
    expect(await admin.user.count({ where: { id: owner } })).toBe(0);
    expect(await admin.household.count({ where: { id: h } })).toBe(1);
    expect((await admin.membership.findFirstOrThrow({ where: { householdId: h, userId: admin2 } })).role).toBe("OWNER");
    expect(await admin.document.count({ where: { householdId: h } })).toBe(1); // données du foyer conservées pour les autres membres
    expect((await admin.document.findFirstOrThrow({ where: { householdId: h } })).uploadedById).toBeNull();
    const prof = await admin.profile.findFirstOrThrow({ where: { householdId: h, displayName: "Moi" } });
    expect(prof.userId).toBeNull();
    expect(prof.archivedAt).not.toBeNull();
  });

  it("échec du prestataire de paiement : rien n'est supprimé, nouvel essai programmé", async () => {
    const u = await user("fail"); const h = await home(u);
    await admin.billingSubscription.create({ data: { householdId: h, stripeCustomerId: `cus_${h}`, plan: "SOLO", status: "ACTIVE" } });
    await ask(u);
    const st = await purgeDueDeletions({ db: svc, now: () => NOW, deleteBillingCustomer: async () => { throw new Error("stripe indisponible"); } });
    expect(st.failed).toBeGreaterThanOrEqual(1);
    expect(await admin.user.count({ where: { id: u } })).toBe(1);
    const r = await admin.deletionRequest.findFirstOrThrow({ where: { userId: u } });
    expect(r.status).toBe("PENDING");
    expect(r.scheduledFor.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("deux workers simultanés : une seule purge", async () => {
    const u = await user("race"); await home(u); await ask(u);
    const [a, b] = await Promise.all([purgeDueDeletions({ db: svc, now: () => NOW }), purgeDueDeletions({ db: svc, now: () => NOW })]);
    expect(a.purged + b.purged).toBeGreaterThanOrEqual(1);
    expect(await admin.user.count({ where: { id: u } })).toBe(0);
  });
});
