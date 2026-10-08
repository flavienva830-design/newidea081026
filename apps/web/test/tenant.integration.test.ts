import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const adminUrl = process.env["TEST_ADMIN_URL"];
const appUrl = process.env["TEST_APP_URL"];
if (process.env["CI"] && !(adminUrl && appUrl)) throw new Error("TEST_ADMIN_URL / TEST_APP_URL requis en CI");
const run = adminUrl && appUrl ? describe : describe.skip;

run("foyer actif, tableau de bord et plan (RLS)", () => {
  let admin: import("@mon-agent-ia/db").Db;
  let app: import("@mon-agent-ia/db").Db;
  const A = randomUUID();
  const B = randomUUID();
  const uA = `ua-${A}`;
  const uB = `ub-${B}`;

  beforeAll(async () => {
    const { createDb } = await import("@mon-agent-ia/db");
    admin = createDb(adminUrl!);
    app = createDb(appUrl!);
    await admin.user.createMany({ data: [{ id: uA, name: "A", email: `${uA}@t.test` }, { id: uB, name: "B", email: `${uB}@t.test` }] });
    await admin.household.createMany({ data: [{ id: A, name: "A", wrappedDek: Buffer.from("x") }, { id: B, name: "B", wrappedDek: Buffer.from("x") }] });
    await admin.membership.createMany({ data: [{ householdId: A, userId: uA, role: "OWNER" }, { householdId: B, userId: uB, role: "READ" }] });
    const soon = new Date(Date.now() + 5 * 86_400_000);
    await admin.document.createMany({ data: [{ householdId: A, source: "WEB_UPLOAD", title: "d1" }, { householdId: A, source: "WEB_UPLOAD", title: "d2" }, { householdId: B, source: "WEB_UPLOAD", title: "autre" }] });
    await admin.deadline.createMany({ data: [{ householdId: A, kind: "PAYMENT", title: "EDF", dueDate: soon }, { householdId: B, kind: "PAYMENT", title: "secret", dueDate: soon }] });
    await admin.saving.create({ data: { householdId: A, kind: "PRICE_INCREASE", title: "t", rationale: "r", monthlyCents: 600, annualCents: 7200, confidence: 0.9 } });
    await admin.saving.create({ data: { householdId: B, kind: "PRICE_INCREASE", title: "t", rationale: "r", monthlyCents: 9900, annualCents: 99000, confidence: 0.9 } });
  });
  afterAll(async () => { await admin.$disconnect(); await app.$disconnect(); });

  it("resolveTenant : foyer par défaut, rôle exact", async () => {
    const { resolveTenant } = await import("../src/server/tenant");
    expect(await resolveTenant(app, uA)).toEqual({ userId: uA, householdId: A, role: "OWNER" });
    expect((await resolveTenant(app, uB))?.role).toBe("READ");
  });

  it("resolveTenant : refuse un foyer dont l'utilisateur n'est pas membre (IDOR)", async () => {
    const { resolveTenant } = await import("../src/server/tenant");
    expect(await resolveTenant(app, uA, B)).toBeNull();
    expect(await resolveTenant(app, "inconnu")).toBeNull();
  });

  it("withPermission : un lecteur ne peut pas écrire", async () => {
    const { resolveTenant, withPermission } = await import("../src/server/tenant");
    const tB = (await resolveTenant(app, uB))!;
    await expect(withPermission(app, tB, "document:write", (tx) => tx.document.count())).rejects.toThrow("Accès refusé");
    await expect(withPermission(app, tB, "document:read", (tx) => tx.document.count())).resolves.toBe(1);
  });

  it("tableau de bord : uniquement les données du foyer", async () => {
    const { loadDashboard } = await import("../src/server/dashboard");
    const d = await loadDashboard(app, { userId: uA, householdId: A, role: "OWNER" });
    expect(d.documents).toBe(2);
    expect(d.savingsAnnualCents).toBe(7200);
    expect(d.deadlines30d).toBe(1);
    expect(d.nextDeadlines.map((x) => x.title)).toEqual(["EDF"]);
  });

  it("plan : gratuit par défaut, puis selon l'abonnement actif", async () => {
    const { currentPlan } = await import("../src/server/plan");
    const { withTenant } = await import("@mon-agent-ia/db");
    const ctx = { userId: uA, householdId: A };
    expect(await withTenant(app, ctx, (tx) => currentPlan(tx, A))).toBe("FREE");
    await admin.billingSubscription.create({ data: { householdId: A, stripeCustomerId: `cus_${A}`, plan: "FAMILLE", status: "ACTIVE" } });
    expect(await withTenant(app, ctx, (tx) => currentPlan(tx, A))).toBe("FAMILLE");
    await admin.billingSubscription.update({ where: { householdId: A }, data: { status: "CANCELED" } });
    expect(await withTenant(app, ctx, (tx) => currentPlan(tx, A))).toBe("FREE");
  });
});
