import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { createDb, type Db } from "@mon-agent-ia/db";
import { enforcePlanLimits, handleStripeEvent } from "../src/handler.ts";
import { effectivePlan, mrrCents } from "../src/mrr.ts";
import type { PriceCatalog } from "../src/catalog.ts";

const adminUrl = process.env["TEST_ADMIN_URL"];
const svcUrl = process.env["TEST_SERVICE_URL"];
if (process.env["CI"] && !(adminUrl && svcUrl)) throw new Error("TEST_ADMIN_URL / TEST_SERVICE_URL requis en CI");
const run = adminUrl && svcUrl ? describe : describe.skip;

const CATALOG: PriceCatalog = { SOLO: { month: "p_sm", year: "p_sy" }, FAMILLE: { month: "p_fm", year: "p_fy" } };
const T0 = 1_790_000_000;

const ev = (type: string, object: unknown, created = T0, id = `evt_${randomUUID()}`) => ({ id, type, created, data: { object } }) as unknown as Stripe.Event;
const sub = (customer: string, price: string, over: Record<string, unknown> = {}) => ({
  id: `sub_${customer}`, object: "subscription", customer, status: "active", cancel_at_period_end: false, metadata: {},
  items: { data: [{ price: { id: price }, current_period_end: T0 + 30 * 86400 }] }, ...over,
});

run("webhooks Stripe : synchronisation des abonnements", () => {
  let admin: Db;
  let svc: Db;
  const deps = () => ({ db: svc, catalog: CATALOG });

  async function home(profiles = 1) {
    const householdId = randomUUID();
    const userId = `u-${householdId}`;
    await admin.user.create({ data: { id: userId, name: "T", email: `${userId}@t.test` } });
    await admin.household.create({ data: { id: householdId, name: "T", wrappedDek: Buffer.from("x") } });
    await admin.membership.create({ data: { householdId, userId, role: "OWNER" } });
    for (let i = 0; i < profiles; i++) await admin.profile.create({ data: { householdId, displayName: `P${i}`, relation: i === 0 ? "SELF" : "CHILD", createdAt: new Date(T0 * 1000 + i * 1000) } });
    const customer = `cus_${householdId}`;
    return { householdId, userId, customer };
  }
  const row = (householdId: string) => admin.billingSubscription.findUniqueOrThrow({ where: { householdId } });

  beforeAll(() => { admin = createDb(adminUrl!); svc = createDb(svcUrl!); });
  afterAll(async () => { await admin.$disconnect(); await svc.$disconnect(); });

  it("parcours nominal : paiement validé puis abonnement actif", async () => {
    const h = await home();
    expect((await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }))).status).toBe("processed");
    expect((await handleStripeEvent(deps(), ev("customer.subscription.created", sub(h.customer, "p_sm"), T0 + 1))).status).toBe("processed");
    expect(await row(h.householdId)).toMatchObject({ plan: "SOLO", status: "ACTIVE", interval: "month", stripeSubscriptionId: `sub_${h.customer}`, cancelAtPeriodEnd: false });
    expect((await row(h.householdId)).currentPeriodEnd!.getTime()).toBe((T0 + 30 * 86400) * 1000);
  });

  it("idempotence : un événement reçu deux fois n'est traité qu'une fois", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    const e = ev("invoice.payment_failed", { customer: h.customer }, T0 + 5);
    expect((await handleStripeEvent(deps(), e)).status).toBe("processed");
    expect((await handleStripeEvent(deps(), e)).status).toBe("duplicate");
    expect(await admin.notification.count({ where: { householdId: h.householdId, type: "payment_failed" } })).toBe(1);
    expect((await admin.stripeEvent.findUniqueOrThrow({ where: { id: e.id } })).processedAt).not.toBeNull();
  });

  it("désordre : un événement plus ancien arrivé en retard est ignoré", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }, T0));
    await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_fm"), T0 + 100));
    const late = await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_sm"), T0 + 50));
    expect(late).toMatchObject({ status: "ignored", detail: "événement plus ancien" });
    expect((await row(h.householdId)).plan).toBe("FAMILLE");
  });

  it("changement d'offre, de période et résiliation programmée", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_fy", { cancel_at_period_end: true }), T0 + 10));
    expect(await row(h.householdId)).toMatchObject({ plan: "FAMILLE", interval: "year", cancelAtPeriodEnd: true, status: "ACTIVE" });
  });

  it("prix inconnu : l'offre n'est pas modifiée", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_sm"), T0 + 1));
    const r = await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_inconnu"), T0 + 2));
    expect(r).toMatchObject({ status: "ignored", detail: "prix inconnu" });
    expect((await row(h.householdId)).plan).toBe("SOLO");
  });

  it("impayé puis régularisation", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_sm"), T0 + 1));
    await handleStripeEvent(deps(), ev("invoice.payment_failed", { customer: h.customer }, T0 + 2));
    expect((await row(h.householdId)).status).toBe("PAST_DUE");
    await handleStripeEvent(deps(), ev("invoice.paid", { customer: h.customer }, T0 + 3));
    expect((await row(h.householdId)).status).toBe("ACTIVE");
  });

  it("fin d'abonnement : retour à l'offre gratuite", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_sm"), T0 + 1));
    await handleStripeEvent(deps(), ev("customer.subscription.deleted", sub(h.customer, "p_sm", { status: "canceled" }), T0 + 9));
    expect(await row(h.householdId)).toMatchObject({ plan: "FREE", status: "CANCELED", stripeSubscriptionId: null, cancelAtPeriodEnd: false });
  });

  it("rétrogradation : profils en trop archivés (jamais supprimés), propriétaire prévenu", async () => {
    const h = await home(4);
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_fm"), T0 + 1));
    expect(await admin.profile.count({ where: { householdId: h.householdId, archivedAt: null } })).toBe(4); // Famille : 5 profils autorisés
    await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_sm"), T0 + 2));
    const profiles = await admin.profile.findMany({ where: { householdId: h.householdId }, orderBy: { createdAt: "asc" } });
    expect(profiles).toHaveLength(4); // aucun supprimé
    expect(profiles.map((p) => p.archivedAt !== null)).toEqual([false, true, true, true]); // les plus récents archivés
    expect(await admin.notification.count({ where: { householdId: h.householdId, type: "plan_downgrade" } })).toBe(1);
    expect(await enforcePlanLimits(svc, h.householdId, "SOLO")).toBe(0); // idempotent
  });

  it("clients et foyers inconnus, types non gérés : ignorés sans erreur", async () => {
    expect(await handleStripeEvent(deps(), ev("customer.subscription.updated", sub("cus_inconnu", "p_sm")))).toMatchObject({ status: "ignored", detail: "client inconnu" });
    expect(await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: randomUUID(), customer: "cus_x", subscription: "sub_x" }))).toMatchObject({ status: "ignored" });
    expect(await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "payment", client_reference_id: "x", customer: "c" }))).toMatchObject({ status: "ignored" });
    expect(await handleStripeEvent(deps(), ev("payment_intent.created", {}))).toMatchObject({ status: "ignored" });
  });

  it("remboursement : simple trace d'audit sans donnée de paiement", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    await handleStripeEvent(deps(), ev("charge.refunded", { id: "ch_1", customer: h.customer }, T0 + 4));
    const a = await admin.auditLog.findFirstOrThrow({ where: { householdId: h.householdId, action: "billing.charge.refunded" } });
    expect(a.targetId).toBe("ch_1");
  });

  it("deux livraisons simultanées du même événement : état final cohérent", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    const e = ev("customer.subscription.updated", sub(h.customer, "p_sm"), T0 + 1);
    await Promise.all([handleStripeEvent(deps(), e), handleStripeEvent(deps(), e), handleStripeEvent(deps(), e)]);
    expect(await row(h.householdId)).toMatchObject({ plan: "SOLO", status: "ACTIVE" });
  });

  it("historique des revenus : chaque changement de MRR est enregistré, jamais en double", async () => {
    const h = await home();
    await handleStripeEvent(deps(), ev("checkout.session.completed", { mode: "subscription", client_reference_id: h.householdId, customer: h.customer, subscription: `sub_${h.customer}` }));
    const created = ev("customer.subscription.created", sub(h.customer, "p_sm"), T0 + 1);
    await handleStripeEvent(deps(), created);
    await handleStripeEvent(deps(), created); // doublon : aucune ligne de plus
    await handleStripeEvent(deps(), ev("customer.subscription.updated", sub(h.customer, "p_fy"), T0 + 2));
    await handleStripeEvent(deps(), ev("invoice.payment_failed", { customer: h.customer }, T0 + 3)); // statut seul : MRR inchangé, pas de ligne
    await handleStripeEvent(deps(), ev("customer.subscription.deleted", sub(h.customer, "p_fy", { status: "canceled" }), T0 + 4));
    const rows = await admin.billingHistory.findMany({ where: { householdId: h.householdId }, orderBy: { at: "asc" } });
    expect(rows.map((r) => [r.fromPlan, r.toPlan, r.mrrBeforeCents, r.mrrAfterCents])).toEqual([
      ["FREE", "SOLO", 0, 990],
      ["SOLO", "FAMILLE", 990, 1658], // annuel : 19 900 / 12
      ["FAMILLE", "FREE", 1658, 0],
    ]);
    expect(rows.reduce((n, r) => n + r.mrrAfterCents - r.mrrBeforeCents, 0)).toBe(0); // somme des variations = MRR final
  });

  it("MRR estimé : mensuel, annuel ramené au mois, impayé toléré, gratuit = 0", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const s = (plan: "SOLO" | "FAMILLE", interval: string | null, status: "ACTIVE" | "PAST_DUE" | "CANCELED", end: Date | null = null) => ({ plan, status, interval, currentPeriodEnd: end });
    expect(mrrCents(s("SOLO", "month", "ACTIVE"), now)).toBe(990);
    expect(mrrCents(s("SOLO", "year", "ACTIVE"), now)).toBe(825); // 9 900 / 12
    expect(mrrCents(s("FAMILLE", null, "ACTIVE"), now)).toBe(1990);
    expect(mrrCents(s("SOLO", "month", "PAST_DUE", new Date("2026-10-20T00:00:00Z")), now)).toBe(990);
    expect(mrrCents(s("SOLO", "month", "PAST_DUE", new Date("2026-10-01T00:00:00Z")), now)).toBe(0);
    expect(mrrCents(s("SOLO", "month", "CANCELED"), now)).toBe(0);
    expect(mrrCents(null, now)).toBe(0);
  });

  it("offre effective : impayé toléré jusqu'à la fin de la période payée", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const future = new Date("2026-10-20T00:00:00Z");
    const past = new Date("2026-10-01T00:00:00Z");
    expect(effectivePlan("SOLO", "ACTIVE", null, now)).toBe("SOLO");
    expect(effectivePlan("SOLO", "TRIALING", null, now)).toBe("SOLO");
    expect(effectivePlan("SOLO", "PAST_DUE", future, now)).toBe("SOLO");
    expect(effectivePlan("SOLO", "PAST_DUE", past, now)).toBe("FREE");
    for (const s of ["CANCELED", "UNPAID", "INCOMPLETE"] as const) expect(effectivePlan("FAMILLE", s, future, now)).toBe("FREE");
  });
});
