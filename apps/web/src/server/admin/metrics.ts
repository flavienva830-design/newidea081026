import { mrrCents } from "@mon-agent-ia/billing";
import { Prisma, type Db } from "@mon-agent-ia/db";

/**
 * Indicateurs du portail d'administration. Toutes les requêtes sont en LECTURE SEULE sur le rôle de service,
 * ne portent que sur des agrégats ou des métadonnées, et ne touchent jamais à un contenu (il n'en existe pas).
 * Les définitions sont volontairement simples et affichées telles quelles à l'écran.
 */

export type RangeDays = 7 | 30 | 90;
export const parseRange = (v: string | string[] | undefined): RangeDays => (v === "7" ? 7 : v === "90" ? 90 : 30);

export type Point = { label: string; value: number };

const DAY = 86_400_000;
export const startOfDayUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function rangeBounds(now: Date, days: number) {
  const to = startOfDayUtc(now);
  return { from: addDays(to, -(days - 1)), to };
}

type DayRow = { day: Date; n: number };
const toPoints = (rows: DayRow[]): Point[] => rows.map((r) => ({ label: iso(r.day), value: Number(r.n) }));

/** Série quotidienne complète (jours sans événement = 0). `source` doit sélectionner (day date, n int) groupés par jour. */
async function daily(db: Db, from: Date, to: Date, source: Prisma.Sql): Promise<Point[]> {
  const rows = await db.$queryRaw<DayRow[]>`
    SELECT d::date AS day, COALESCE(c.n, 0)::int AS n
      FROM generate_series(${from}::timestamp, ${to}::timestamp, interval '1 day') AS d
      LEFT JOIN (${source}) c ON c.day = d::date
     ORDER BY d`;
  return toPoints(rows);
}

export const signupSeries = (db: Db, from: Date, to: Date) =>
  daily(db, from, to, Prisma.sql`SELECT date_trunc('day', "createdAt")::date AS day, count(*)::int AS n FROM users WHERE "createdAt" >= ${from}::timestamp GROUP BY 1`);

export const analysisSeries = (db: Db, from: Date, to: Date) =>
  daily(db, from, to, Prisma.sql`SELECT date_trunc('day', "createdAt")::date AS day, count(*)::int AS n FROM documents WHERE "createdAt" >= ${from}::timestamp GROUP BY 1`);

/** Coût IA par jour, en centimes d'euro (les coûts sont stockés en micro-euros). */
export const aiCostSeries = (db: Db, from: Date, to: Date) =>
  daily(db, from, to, Prisma.sql`SELECT date_trunc('day', "createdAt")::date AS day, round(sum("costMicros") / 10000.0)::int AS n FROM ai_runs WHERE "createdAt" >= ${from}::timestamp GROUP BY 1`);

/** MRR dans le temps : somme cumulée des variations enregistrées dans l'historique (voir BillingHistory). */
export async function mrrSeries(db: Db, from: Date, to: Date): Promise<Point[]> {
  const baseRows = await db.$queryRaw<{ base: number }[]>`SELECT COALESCE(sum("mrrAfterCents" - "mrrBeforeCents"), 0)::int AS base FROM billing_history WHERE "at" < ${from}::timestamp`;
  const base = baseRows[0]?.base ?? 0;
  const deltas = await daily(db, from, to, Prisma.sql`SELECT date_trunc('day', "at")::date AS day, sum("mrrAfterCents" - "mrrBeforeCents")::int AS n FROM billing_history WHERE "at" >= ${from}::timestamp GROUP BY 1`);
  let acc = Number(base);
  return deltas.map((p) => ({ label: p.label, value: (acc += p.value) }));
}

export type Kpis = {
  users: { total: number; verified: number; new7d: number; new30d: number };
  active: { dau: number; wau: number; mau: number };
  revenue: { mrrCents: number; arrCents: number; paying: number; arpuCents: number; byPlan: { plan: "SOLO" | "FAMILLE"; interval: string; count: number; mrrCents: number }[] };
  churn: { churned: number; logoRate: number | null; revenueRate: number | null; windowDays: number };
  conversion: { cohort: number; paid: number; rate: number | null };
  activation: { cohort: number; activated: number; rate: number | null };
  documents: { total: number; last30d: number };
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export async function getKpis(db: Db, now: Date): Promise<Kpis> {
  const d1 = addDays(now, -1), d7 = addDays(now, -7), d30 = addDays(now, -30), d90 = addDays(now, -90);
  const [userRows, activeRows, activeSubs, graceSubs, histRows, convRows, actRows, docRows] = await Promise.all([
    db.$queryRaw<{ total: number; verified: number; n7: number; n30: number }[]>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE "emailVerified")::int AS verified,
             count(*) FILTER (WHERE "createdAt" >= ${d7}::timestamp)::int AS n7, count(*) FILTER (WHERE "createdAt" >= ${d30}::timestamp)::int AS n30
        FROM users`,
    db.$queryRaw<{ dau: number; wau: number; mau: number }[]>`
      SELECT count(DISTINCT "userId") FILTER (WHERE "createdAt" >= ${d1}::timestamp)::int AS dau,
             count(DISTINCT "userId") FILTER (WHERE "createdAt" >= ${d7}::timestamp)::int AS wau,
             count(DISTINCT "userId")::int AS mau
        FROM login_events WHERE success AND "userId" IS NOT NULL AND "createdAt" >= ${d30}::timestamp`,
    db.billingSubscription.groupBy({ by: ["plan", "interval"], where: { plan: { not: "FREE" }, status: { in: ["ACTIVE", "TRIALING"] } }, _count: { _all: true } }),
    db.billingSubscription.groupBy({ by: ["plan", "interval"], where: { plan: { not: "FREE" }, status: "PAST_DUE", currentPeriodEnd: { gt: now } }, _count: { _all: true } }),
    db.$queryRaw<{ churned: number; churned_mrr: number; new_paying: number; net: number }[]>`
      SELECT count(*) FILTER (WHERE "mrrBeforeCents" > 0 AND "mrrAfterCents" = 0)::int AS churned,
             COALESCE(sum("mrrBeforeCents") FILTER (WHERE "mrrBeforeCents" > 0 AND "mrrAfterCents" = 0), 0)::int AS churned_mrr,
             count(*) FILTER (WHERE "mrrBeforeCents" = 0 AND "mrrAfterCents" > 0)::int AS new_paying,
             COALESCE(sum("mrrAfterCents" - "mrrBeforeCents"), 0)::int AS net
        FROM billing_history WHERE "at" >= ${d30}::timestamp`,
    db.$queryRaw<{ cohort: number; paid: number }[]>`
      SELECT count(*)::int AS cohort,
             count(*) FILTER (WHERE b.plan <> 'FREE' AND (b.status IN ('ACTIVE', 'TRIALING') OR (b.status = 'PAST_DUE' AND b."currentPeriodEnd" > ${now}::timestamp)))::int AS paid
        FROM households h LEFT JOIN billing_subscriptions b ON b."householdId" = h.id
       WHERE h."createdAt" >= ${d90}::timestamp`,
    // Activation : parmi les comptes vérifiés créés il y a 7 à 37 jours, part ayant analysé (lui-même) un document dans les 7 jours suivant l'inscription.
    db.$queryRaw<{ cohort: number; activated: number }[]>`
      SELECT count(*)::int AS cohort,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM documents d WHERE d."uploadedById" = u.id AND d."createdAt" <= u."createdAt" + interval '7 days'))::int AS activated
        FROM users u WHERE u."emailVerified" AND u."createdAt" BETWEEN ${addDays(now, -37)}::timestamp AND ${d7}::timestamp`,
    db.$queryRaw<{ total: number; last30: number }[]>`SELECT count(*)::int AS total, count(*) FILTER (WHERE "createdAt" >= ${d30}::timestamp)::int AS last30 FROM documents`,
  ]);

  const merged = new Map<string, { plan: "SOLO" | "FAMILLE"; interval: string; count: number }>();
  for (const g of [...activeSubs, ...graceSubs]) {
    const interval = g.interval ?? "month";
    const key = `${g.plan}/${interval}`;
    const cur = merged.get(key) ?? { plan: g.plan as "SOLO" | "FAMILLE", interval, count: 0 };
    cur.count += g._count._all;
    merged.set(key, cur);
  }
  const byPlan = [...merged.values()].map((g) => ({ ...g, mrrCents: mrrCents({ plan: g.plan, status: "ACTIVE", interval: g.interval, currentPeriodEnd: null }, now) * g.count }));
  const mrr = byPlan.reduce((n, g) => n + g.mrrCents, 0);
  const paying = byPlan.reduce((n, g) => n + g.count, 0);
  const h = histRows[0]!;
  const customersStart = paying - h.new_paying + h.churned;
  const mrrStart = mrr - h.net;
  const u = userRows[0]!;

  return {
    users: { total: u.total, verified: u.verified, new7d: u.n7, new30d: u.n30 },
    active: activeRows[0] ?? { dau: 0, wau: 0, mau: 0 },
    revenue: { mrrCents: mrr, arrCents: mrr * 12, paying, arpuCents: paying ? Math.round(mrr / paying) : 0, byPlan },
    churn: { churned: h.churned, logoRate: ratio(h.churned, customersStart), revenueRate: ratio(h.churned_mrr, mrrStart), windowDays: 30 },
    conversion: { cohort: convRows[0]!.cohort, paid: convRows[0]!.paid, rate: ratio(convRows[0]!.paid, convRows[0]!.cohort) },
    activation: { cohort: actRows[0]!.cohort, activated: actRows[0]!.activated, rate: ratio(actRows[0]!.activated, actRows[0]!.cohort) },
    documents: { total: docRows[0]!.total, last30d: docRows[0]!.last30 },
  };
}

export type AiStats = {
  runs: number; errors: number; errorRate: number | null; inputTokens: number; outputTokens: number; costMicros: number;
  p50Ms: number | null; p95Ms: number | null;
  costPerDocumentMicros: number | null;
  byModel: { model: string; task: string; runs: number; costMicros: number; errors: number }[];
  topHouseholds: { householdId: string; runs: number; costMicros: number }[];
};

export async function getAiStats(db: Db, from: Date): Promise<AiStats> {
  const [tot, byModel, top, docs] = await Promise.all([
    db.$queryRaw<{ runs: number; errors: number; input: bigint; output: bigint; cost: bigint; p50: number | null; p95: number | null; analyze_cost: bigint }[]>`
      SELECT count(*)::int AS runs, count(*) FILTER (WHERE status <> 'OK')::int AS errors,
             COALESCE(sum("inputTokens"), 0)::bigint AS input, COALESCE(sum("outputTokens"), 0)::bigint AS output, COALESCE(sum("costMicros"), 0)::bigint AS cost,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95,
             COALESCE(sum("costMicros") FILTER (WHERE task = 'ANALYZE'), 0)::bigint AS analyze_cost
        FROM ai_runs WHERE "createdAt" >= ${from}::timestamp`,
    db.$queryRaw<{ model: string; task: string; runs: number; cost: bigint; errors: number }[]>`
      SELECT model, task::text AS task, count(*)::int AS runs, COALESCE(sum("costMicros"), 0)::bigint AS cost, count(*) FILTER (WHERE status <> 'OK')::int AS errors
        FROM ai_runs WHERE "createdAt" >= ${from}::timestamp GROUP BY 1, 2 ORDER BY cost DESC, runs DESC LIMIT 20`,
    db.$queryRaw<{ id: string; runs: number; cost: bigint }[]>`
      SELECT "householdId"::text AS id, count(*)::int AS runs, COALESCE(sum("costMicros"), 0)::bigint AS cost
        FROM ai_runs WHERE "createdAt" >= ${from}::timestamp AND "householdId" IS NOT NULL GROUP BY 1 ORDER BY cost DESC, runs DESC LIMIT 10`,
    db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM documents WHERE "createdAt" >= ${from}::timestamp`,
  ]);
  const t = tot[0]!;
  return {
    runs: t.runs, errors: t.errors, errorRate: ratio(t.errors, t.runs),
    inputTokens: Number(t.input), outputTokens: Number(t.output), costMicros: Number(t.cost),
    p50Ms: t.p50 === null ? null : Math.round(Number(t.p50)), p95Ms: t.p95 === null ? null : Math.round(Number(t.p95)),
    costPerDocumentMicros: docs[0]!.n > 0 ? Math.round(Number(t.analyze_cost) / docs[0]!.n) : null,
    byModel: byModel.map((m) => ({ model: m.model, task: m.task, runs: m.runs, costMicros: Number(m.cost), errors: m.errors })),
    topHouseholds: top.map((h) => ({ householdId: h.id, runs: h.runs, costMicros: Number(h.cost) })),
  };
}

export type DocKind = { kind: string; count: number };
export async function documentsByKind(db: Db, from: Date): Promise<DocKind[]> {
  const g = await db.document.groupBy({ by: ["kind"], where: { createdAt: { gte: from } }, _count: { _all: true }, orderBy: { _count: { kind: "desc" } } });
  return g.map((x) => ({ kind: x.kind, count: x._count._all }));
}

export async function getBilling(db: Db, now: Date) {
  const [pastDue, history, events, stuck, byStatus] = await Promise.all([
    db.billingSubscription.findMany({
      where: { status: "PAST_DUE" }, orderBy: { currentPeriodEnd: "asc" }, take: 50,
      select: { householdId: true, plan: true, interval: true, currentPeriodEnd: true, household: { select: { memberships: { where: { role: "OWNER" }, take: 1, select: { user: { select: { id: true, email: true } } } } } } },
    }),
    db.billingHistory.findMany({ orderBy: { at: "desc" }, take: 50 }),
    db.stripeEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 50, select: { id: true, type: true, receivedAt: true, processedAt: true, error: true } }),
    db.stripeEvent.count({ where: { OR: [{ error: { not: null } }, { processedAt: null, receivedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }] } }),
    db.billingSubscription.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    pastDue: pastDue.map((p) => ({ householdId: p.householdId, plan: p.plan, interval: p.interval, periodEnd: p.currentPeriodEnd, owner: p.household.memberships[0]?.user ?? null })),
    history, events, stuckEvents: stuck, byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
  };
}

export async function getPrivacyOverview(db: Db, now: Date) {
  const d30 = addDays(now, -30);
  const [requests, withdrawals, exports_, erasures] = await Promise.all([
    db.deletionRequest.findMany({ where: { status: { in: ["PENDING", "PROCESSING"] } }, orderBy: { scheduledFor: "asc" }, take: 100, select: { id: true, status: true, scheduledFor: true, createdAt: true, user: { select: { id: true, email: true } } } }),
    db.consent.count({ where: { granted: false, createdAt: { gte: d30 } } }),
    db.auditLog.count({ where: { action: "account.exported", createdAt: { gte: d30 } } }),
    db.auditLog.count({ where: { action: { in: ["household.records_erased", "account.deletion_requested"] }, createdAt: { gte: d30 } } }),
  ]);
  return { requests, withdrawals, exports: exports_, erasures };
}
