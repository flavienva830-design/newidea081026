import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createIsolatedDb, type IsolatedDb } from "./helpers/isolated-db";

const adminUrl = process.env["TEST_ADMIN_URL"];
const serviceUrl = process.env["TEST_SERVICE_URL"];
if (process.env["CI"] && !(adminUrl && serviceUrl)) throw new Error("TEST_ADMIN_URL / TEST_SERVICE_URL requis en CI");
const run = adminUrl && serviceUrl ? describe : describe.skip;

/**
 * Indicateurs du portail d'administration sur une base ISOLÉE et un jeu de données déterministe (« maintenant » figé).
 * Chaque valeur attendue est calculée à la main dans le commentaire du jeu de données : si une définition change, ce test doit casser.
 */
const NOW = new Date("2026-10-08T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const after = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

type U = { key: string; ago: number; verified: boolean };
// 10 comptes, un foyer chacun (créé le même jour que le compte).
const USERS: U[] = [
  { key: "solo_m", ago: 100, verified: true },
  { key: "fam_y", ago: 60, verified: true },
  { key: "solo_pd", ago: 45, verified: true },
  { key: "pd_exp", ago: 40, verified: true },
  { key: "canceled", ago: 35, verified: true },
  { key: "late", ago: 25, verified: true },
  { key: "activ", ago: 20, verified: true },
  { key: "inactiv", ago: 15, verified: true },
  { key: "fresh", ago: 3, verified: true },
  { key: "unverif", ago: 2, verified: false },
];

run("portail admin : indicateurs (base isolée)", () => {
  let iso: IsolatedDb;
  let db: import("@mon-agent-ia/db").Db;
  const uid = (k: string) => `adm-${k}`;
  const hh: Record<string, string> = {};

  beforeAll(async () => {
    iso = await createIsolatedDb(adminUrl!, serviceUrl!);
    const { createDb } = await import("@mon-agent-ia/db");
    db = createDb(iso.url);

    for (const u of USERS) {
      hh[u.key] = randomUUID();
      const createdAt = ago(u.ago);
      await db.user.create({ data: { id: uid(u.key), name: u.key, email: `${u.key}@exemple.test`, emailVerified: u.verified, createdAt } });
      await db.household.create({ data: { id: hh[u.key]!, name: u.key, wrappedDek: Buffer.from("x"), createdAt } });
      await db.membership.create({ data: { householdId: hh[u.key]!, userId: uid(u.key), role: "OWNER", createdAt } });
    }

    // Abonnements : MRR attendu = 990 (solo_m) + 1658 (fam_y, 19900/12 arrondi) + 990 (solo_pd, impayé mais période en cours) = 3638.
    const sub = (k: string, plan: "SOLO" | "FAMILLE", status: "ACTIVE" | "PAST_DUE" | "CANCELED", interval: "month" | "year", end: Date | null) =>
      db.billingSubscription.create({ data: { householdId: hh[k]!, stripeCustomerId: `cus_${k}`, stripeSubscriptionId: `sub_${k}`, plan, status, interval, currentPeriodEnd: end } });
    await sub("solo_m", "SOLO", "ACTIVE", "month", after(NOW, 20));
    await sub("fam_y", "FAMILLE", "ACTIVE", "year", after(NOW, 200));
    await sub("solo_pd", "SOLO", "PAST_DUE", "month", after(NOW, 3));
    await sub("pd_exp", "SOLO", "PAST_DUE", "month", after(NOW, -2)); // impayé hors période : ne compte plus
    await sub("canceled", "FAMILLE", "CANCELED", "month", after(NOW, -12));

    // Historique : la somme des variations = MRR courant (3638) ; fenêtre de churn = 30 derniers jours.
    const hist = (k: string, at: Date, before: number, afterC: number, toPlan: "FREE" | "SOLO" | "FAMILLE", reason = "test") =>
      db.billingHistory.create({ data: { householdId: hh[k]!, at, fromPlan: before ? "SOLO" : "FREE", toPlan, fromStatus: "ACTIVE", toStatus: "ACTIVE", interval: "month", mrrBeforeCents: before, mrrAfterCents: afterC, reason } });
    await hist("solo_m", ago(100), 0, 990, "SOLO");
    await hist("fam_y", ago(70), 0, 990, "SOLO");
    await hist("fam_y", ago(5), 990, 1658, "FAMILLE", "upgrade annuel"); // +668 dans la fenêtre
    await hist("solo_pd", ago(20), 0, 990, "SOLO"); // nouveau payant dans la fenêtre
    await hist("pd_exp", ago(80), 0, 990, "SOLO");
    await hist("pd_exp", ago(35), 990, 0, "FREE"); // churn hors fenêtre
    await hist("canceled", ago(70), 0, 1990, "FAMILLE");
    await hist("canceled", ago(12), 1990, 0, "FREE"); // churn dans la fenêtre : −1990

    // Connexions : DAU {solo_m, fresh}=2, WAU +fam_y=3, MAU +solo_pd=4 (canceled à 40 j et les échecs sont exclus).
    const login = (k: string | null, daysAgo: number, success = true, extra: { suspicious?: boolean; riskReasons?: string[]; country?: string } = {}) =>
      db.loginEvent.create({ data: { userId: k ? uid(k) : null, emailHash: "h", success, method: "password", ipHash: "i", createdAt: ago(daysAgo), ...extra } });
    await login("solo_m", 0.5);
    await login("fresh", 0.2);
    await login("fresh", 0.3);
    await login("fam_y", 3);
    await login("solo_pd", 20);
    await login("canceled", 40);
    await login("activ", 0.1, false);
    await login(null, 0.2, false);
    await login("canceled", 10, false); // échec plus ancien que 7 j : hors « échecs 7 j »
    await login("fresh", 1, true, { suspicious: true, riskReasons: ["new_country"], country: "BR" });
    await login("fam_y", 9, true, { suspicious: true, riskReasons: ["new_device"] }); // suspect mais hors fenêtre 7 j

    // Documents (uploadedById = auteur). Activation : cohorte vérifiée créée il y a 7–37 j = canceled, late, activ, inactiv (4) ;
    // activés (document ≤ 7 j après l'inscription) = canceled (+1 j) et activ (+2 j) ; late (+10 j) non.
    const doc = (k: string, at: Date, kind: "INVOICE" | "TAX" | "CONTRACT" | "INSURANCE") =>
      db.document.create({ data: { householdId: hh[k]!, uploadedById: uid(k), source: "WEB_UPLOAD", kind, title: "doc", createdAt: at } });
    await doc("canceled", after(ago(35), 1), "INSURANCE"); // 34 j : hors 30 j
    await doc("activ", after(ago(20), 2), "INVOICE");
    await doc("late", after(ago(25), 10), "INVOICE");
    await doc("solo_m", ago(2), "INVOICE");
    await doc("solo_m", ago(2), "TAX");
    await doc("fam_y", ago(1), "CONTRACT");

    // Exécutions IA (30 j) : voir les attendus dans le test « activité IA ».
    const run_ = (k: string, daysAgo: number, task: "ANALYZE" | "LETTER", model: string, status: "OK" | "ERROR" | "INVALID_OUTPUT", latencyMs: number, inT: number, outT: number, cost: number) =>
      db.aiRun.create({ data: { householdId: hh[k]!, task, model, promptVersion: "v1", status, latencyMs, inputTokens: inT, outputTokens: outT, costMicros: BigInt(cost), createdAt: ago(daysAgo) } });
    await run_("solo_m", 2, "ANALYZE", "gpt-5-mini", "OK", 1000, 1000, 200, 8000);
    await run_("solo_m", 2, "ANALYZE", "gpt-5-mini", "OK", 2000, 1500, 300, 12000);
    await run_("fam_y", 1, "ANALYZE", "gpt-5-mini", "ERROR", 500, 0, 0, 0);
    await run_("fam_y", 1, "LETTER", "gpt-5", "OK", 4000, 800, 900, 40000);
    await run_("solo_m", 5, "ANALYZE", "gpt-5-mini", "INVALID_OUTPUT", 3000, 1200, 100, 4000);
    await run_("solo_m", 40, "ANALYZE", "gpt-5-mini", "OK", 9000, 5000, 500, 99999); // hors fenêtre

    // Facturation / Stripe.
    await db.stripeEvent.createMany({ data: [
      { id: "evt_ok", type: "invoice.paid", receivedAt: ago(1), processedAt: ago(1) },
      { id: "evt_err", type: "customer.subscription.updated", receivedAt: ago(1), processedAt: ago(1), error: "boom" },
      { id: "evt_stuck", type: "invoice.paid", receivedAt: new Date(NOW.getTime() - 3600_000) },
      { id: "evt_recent", type: "invoice.paid", receivedAt: new Date(NOW.getTime() - 60_000) },
    ] });

    // RGPD : demandes de suppression, retraits de consentement, exports, effacements.
    await db.deletionRequest.createMany({ data: [
      { userId: uid("inactiv"), status: "PENDING", scheduledFor: after(NOW, 20), createdAt: ago(10) },
      { userId: uid("fresh"), status: "PROCESSING", scheduledFor: after(NOW, -1), createdAt: ago(31) },
      { userId: uid("late"), status: "CANCELLED", scheduledFor: after(NOW, 5), createdAt: ago(8) },
    ] });
    await db.consent.createMany({ data: [
      { userId: uid("activ"), type: "AI_PROCESSING", version: "1", granted: false, createdAt: ago(3) },
      { userId: uid("late"), type: "AI_PROCESSING", version: "1", granted: false, createdAt: ago(29) },
      { userId: uid("fresh"), type: "AI_PROCESSING", version: "1", granted: false, createdAt: ago(45) }, // trop ancien
      { userId: uid("inactiv"), type: "AI_PROCESSING", version: "1", granted: true, createdAt: ago(2) }, // acceptation : ne compte pas
    ] });
    await db.auditLog.createMany({ data: [
      { action: "account.exported", createdAt: ago(2) }, { action: "account.exported", createdAt: ago(20) }, { action: "account.exported", createdAt: ago(40) },
      { action: "household.records_erased", createdAt: ago(5) }, { action: "account.deletion_requested", createdAt: ago(6) }, { action: "account.deletion_requested", createdAt: ago(50) },
    ] });
  });

  afterAll(async () => {
    await db?.$disconnect();
    await iso?.drop();
  });

  it("utilisateurs et activité (DAU / WAU / MAU)", async () => {
    const { getKpis } = await import("../src/server/admin/metrics");
    const k = await getKpis(db, NOW);
    expect(k.users).toEqual({ total: 10, verified: 9, new7d: 2, new30d: 5 });
    expect(k.active).toEqual({ dau: 2, wau: 3, mau: 4 });
    expect(k.documents).toEqual({ total: 6, last30d: 5 });
  });

  it("revenus : MRR estimé = 990 + 1658 + 990 ; ARR, ARPU, fusion par offre et périodicité", async () => {
    const { getKpis } = await import("../src/server/admin/metrics");
    const r = (await getKpis(db, NOW)).revenue;
    expect(r.mrrCents).toBe(3638);
    expect(r.arrCents).toBe(3638 * 12);
    expect(r.paying).toBe(3);
    expect(r.arpuCents).toBe(1213);
    expect([...r.byPlan].sort((a, b) => a.plan.localeCompare(b.plan))).toEqual([
      { plan: "FAMILLE", interval: "year", count: 1, mrrCents: 1658 },
      { plan: "SOLO", interval: "month", count: 2, mrrCents: 1980 },
    ]);
  });

  it("résiliations 30 j : taux de comptes et de revenu, calculés sur l'historique", async () => {
    const { getKpis } = await import("../src/server/admin/metrics");
    const c = (await getKpis(db, NOW)).churn;
    // Fenêtre : +990 (solo_pd), −1990 (canceled), +668 (fam_y) → net −332. Début de fenêtre : 3638 + 332 = 3970 € ; clients : 3 − 1 + 1 = 3.
    expect(c.churned).toBe(1);
    expect(c.logoRate).toBeCloseTo(1 / 3, 6);
    expect(c.revenueRate).toBeCloseTo(1990 / 3970, 6);
    expect(c.windowDays).toBe(30);
  });

  it("conversion (foyers créés < 90 j, payants maintenant) et activation (1er document ≤ 7 j par l'utilisateur)", async () => {
    const { getKpis } = await import("../src/server/admin/metrics");
    const k = await getKpis(db, NOW);
    // 9 foyers récents (solo_m a 100 j) ; payants : fam_y et solo_pd (grâce) — pd_exp (impayé expiré) et canceled non.
    expect(k.conversion.cohort).toBe(9);
    expect(k.conversion.paid).toBe(2);
    expect(k.conversion.rate).toBeCloseTo(2 / 9, 6);
    expect(k.activation).toEqual({ cohort: 4, activated: 2, rate: 0.5 });
  });

  it("séries : tous les jours présents (zéros compris), bornes incluses", async () => {
    const { rangeBounds, signupSeries, analysisSeries, aiCostSeries } = await import("../src/server/admin/metrics");
    const { from, to } = rangeBounds(NOW, 30);
    expect(from.toISOString()).toBe("2026-09-09T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-08T00:00:00.000Z");

    const signups = await signupSeries(db, from, to);
    expect(signups).toHaveLength(30);
    expect(signups[0]!.label).toBe("2026-09-09");
    expect(signups[29]!.label).toBe("2026-10-08");
    const by = Object.fromEntries(signups.map((p) => [p.label, p.value]));
    expect(signups.reduce((n, p) => n + p.value, 0)).toBe(5);
    expect(by["2026-09-13"]).toBe(1); // late
    expect(by["2026-10-05"]).toBe(1); // fresh
    expect(by["2026-10-07"]).toBe(0); // jour sans inscription, présent quand même

    const docs = await analysisSeries(db, from, to);
    expect(docs).toHaveLength(30);
    expect(docs.reduce((n, p) => n + p.value, 0)).toBe(5);
    expect(Object.fromEntries(docs.map((p) => [p.label, p.value]))["2026-10-06"]).toBe(2);

    const cost = await aiCostSeries(db, from, to); // centimes d'euro : 20 000 µ€ = 2 c ; 40 000 µ€ = 4 c ; 4 000 µ€ arrondi à 0
    const c = Object.fromEntries(cost.map((p) => [p.label, p.value]));
    expect(cost).toHaveLength(30);
    expect([c["2026-10-06"], c["2026-10-07"], c["2026-10-03"]]).toEqual([2, 4, 0]);
  });

  it("MRR dans le temps : base avant la fenêtre + variations jour par jour, et se termine sur le MRR courant", async () => {
    const { rangeBounds, mrrSeries, getKpis } = await import("../src/server/admin/metrics");
    const { from, to } = rangeBounds(NOW, 30);
    const s = await mrrSeries(db, from, to);
    const by = Object.fromEntries(s.map((p) => [p.label, p.value]));
    expect(s).toHaveLength(30);
    expect(by["2026-09-09"]).toBe(3970); // 990 + 990 + 1990 + (990 − 990)
    expect(by["2026-09-18"]).toBe(4960); // solo_pd s'abonne
    expect(by["2026-09-26"]).toBe(2970); // canceled résilie (−1990)
    expect(by["2026-10-03"]).toBe(3638); // fam_y passe à l'annuel Famille (+668)
    expect(s[29]!.value).toBe((await getKpis(db, NOW)).revenue.mrrCents);
  });

  it("activité IA : fenêtre, taux d'erreur, percentiles, coût par document, modèles et foyers les plus coûteux", async () => {
    const { rangeBounds, getAiStats } = await import("../src/server/admin/metrics");
    const a = await getAiStats(db, rangeBounds(NOW, 30).from);
    expect(a.runs).toBe(5); // l'exécution à 40 j est exclue
    expect(a.errors).toBe(2);
    expect(a.errorRate).toBeCloseTo(0.4, 6);
    expect(a.inputTokens).toBe(4500);
    expect(a.outputTokens).toBe(1500);
    expect(a.costMicros).toBe(64_000);
    expect(a.p50Ms).toBe(2000);
    expect(a.p95Ms).toBe(3800); // interpolation : 3000 + 0,8 × (4000 − 3000)
    expect(a.costPerDocumentMicros).toBe(4800); // coût d'analyse 24 000 µ€ / 5 documents
    expect(a.byModel).toEqual([
      { model: "gpt-5", task: "LETTER", runs: 1, costMicros: 40_000, errors: 0 },
      { model: "gpt-5-mini", task: "ANALYZE", runs: 4, costMicros: 24_000, errors: 2 },
    ]);
    expect(a.topHouseholds).toEqual([
      { householdId: hh["fam_y"], runs: 2, costMicros: 40_000 },
      { householdId: hh["solo_m"], runs: 3, costMicros: 24_000 },
    ]);
  });

  it("activité IA sans donnée : pas de division par zéro", async () => {
    const { getAiStats } = await import("../src/server/admin/metrics");
    const a = await getAiStats(db, new Date(NOW.getTime() + DAY));
    expect(a).toMatchObject({ runs: 0, errors: 0, errorRate: null, p50Ms: null, p95Ms: null, costPerDocumentMicros: null, byModel: [], topHouseholds: [] });
  });

  it("répartition des documents par type", async () => {
    const { documentsByKind } = await import("../src/server/admin/metrics");
    const k = await documentsByKind(db, ago(30));
    expect(Object.fromEntries(k.map((x) => [x.kind, x.count]))).toEqual({ INVOICE: 3, TAX: 1, CONTRACT: 1 });
    expect(k[0]).toEqual({ kind: "INVOICE", count: 3 });
  });

  it("abonnements : impayés (plus ancien d'abord), événements Stripe bloqués, répartition par statut", async () => {
    const { getBilling } = await import("../src/server/admin/metrics");
    const b = await getBilling(db, NOW);
    expect(b.pastDue.map((p) => p.owner?.email)).toEqual(["pd_exp@exemple.test", "solo_pd@exemple.test"]);
    expect(b.stuckEvents).toBe(2); // en erreur + non traité depuis plus de 10 min (pas celui d'il y a 1 min)
    expect(b.events).toHaveLength(4);
    expect(Object.fromEntries(b.byStatus.map((s) => [s.status, s.count]))).toEqual({ ACTIVE: 2, PAST_DUE: 2, CANCELED: 1 });
    expect(b.history).toHaveLength(8);
    expect(b.history[0]!.at.getTime()).toBeGreaterThanOrEqual(b.history[7]!.at.getTime());
  });

  it("RGPD : demandes en cours, retraits de consentement, exports et effacements sur 30 j", async () => {
    const { getPrivacyOverview } = await import("../src/server/admin/metrics");
    const p = await getPrivacyOverview(db, NOW);
    expect(p.requests.map((r) => [r.user.email, r.status])).toEqual([
      ["fresh@exemple.test", "PROCESSING"],
      ["inactiv@exemple.test", "PENDING"],
    ]);
    expect(p.withdrawals).toBe(2);
    expect(p.exports).toBe(2);
    expect(p.erasures).toBe(2);
  });

  it("sécurité : échecs et connexions inhabituelles sur 7 j", async () => {
    const { securitySummary } = await import("../src/server/admin/audit");
    const s = await securitySummary(db, NOW);
    expect(s.failed).toBe(2);
    expect(s.suspicious).toBe(1);
    expect(s.recent).toHaveLength(1);
    expect(s.recent[0]).toMatchObject({ country: "BR", riskReasons: ["new_country"], user: { email: "fresh@exemple.test" } });
  });

  it("recherche d'utilisateurs : insensible à la casse, 3 caractères minimum, jokers LIKE traités littéralement", async () => {
    const { searchUsers } = await import("../src/server/admin/users");
    const recent = await searchUsers(db, "");
    expect(recent).toHaveLength(10);
    expect(recent[0]!.email).toBe("unverif@exemple.test"); // le plus récent d'abord
    expect(recent.at(-1)!.email).toBe("solo_m@exemple.test");
    expect((await searchUsers(db, "a")).map((u) => u.id)).toEqual(recent.map((u) => u.id)); // < 3 caractères : aucun filtre (pas d'énumération par lettre)

    expect((await searchUsers(db, "FAM_Y")).map((u) => u.email)).toEqual(["fam_y@exemple.test"]);
    expect((await searchUsers(db, "%%%"))).toEqual([]); // « % » n'est pas un joker
    expect((await searchUsers(db, "fam_"))).toHaveLength(1); // « _ » non plus : « fam_ » ne correspond pas à « famXy » ni à « fam@... »

    const x = await db.user.create({ data: { id: "adm-famXy", name: "x", email: "famXy@exemple.test" } });
    try {
      expect((await searchUsers(db, "fam_y")).map((u) => u.email)).toEqual(["fam_y@exemple.test"]); // famXy exclu : « _ » est littéral
    } finally {
      await db.user.delete({ where: { id: x.id } });
    }

    const plans = Object.fromEntries((await searchUsers(db, "exemple.test", NOW)).map((u) => [u.email.split("@")[0], u.plan]));
    expect(plans).toMatchObject({ solo_m: "SOLO", fam_y: "FAMILLE", solo_pd: "SOLO", pd_exp: "FREE", canceled: "FREE", fresh: "FREE" });
  });

  it("fiche utilisateur : foyers, usage du mois, consentements les plus récents, aucune donnée de contenu", async () => {
    const { getUserDetail } = await import("../src/server/admin/users");
    expect(await getUserDetail(db, "inconnu", NOW)).toBeNull();
    await db.usageCounter.create({ data: { householdId: hh["fam_y"]!, period: "2026-10", documents: 7, lettersGenerated: 1, aiCostMicros: BigInt(64_000) } });
    await db.consent.createMany({ data: [
      { userId: uid("fam_y"), type: "AI_PROCESSING", version: "1", granted: true, createdAt: ago(30) },
      { userId: uid("fam_y"), type: "AI_PROCESSING", version: "1", granted: false, createdAt: ago(1) },
    ] });
    const d = (await getUserDetail(db, uid("fam_y"), NOW))!;
    expect(d.user.email).toBe("fam_y@exemple.test");
    expect(d.households).toHaveLength(1);
    expect(d.households[0]).toMatchObject({ role: "OWNER", documents: 1, usage: { documents: 7, lettersGenerated: 1, aiCostMicros: 64_000 } });
    expect(d.households[0]!.household.billing).toMatchObject({ plan: "FAMILLE", status: "ACTIVE", interval: "year" });
    expect(d.consents).toEqual([expect.objectContaining({ type: "AI_PROCESSING", granted: false })]); // le plus récent gagne
    expect(JSON.stringify(d)).not.toMatch(/wrappedDek|totpSecret|"password"\s*:|passwordHash/i);
  });
});
