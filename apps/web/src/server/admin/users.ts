import { effectivePlan } from "@mon-agent-ia/billing";
import type { Db } from "@mon-agent-ia/db";
import { usagePeriod } from "@mon-agent-ia/core";
import { escapeLike } from "./like";

export type UserRow = {
  id: string; email: string; name: string; createdAt: Date; emailVerified: boolean; twoFactorEnabled: boolean;
  bannedAt: Date | null; staffRole: string; plan: string; lastLoginAt: Date | null;
};

/**
 * Recherche d'utilisateurs : minimum 3 caractères (pas d'énumération par lettre), 25 résultats.
 * Le terme est échappé : « % » et « _ » sont des caractères ordinaires, jamais des jokers (Prisma ne les neutralise pas).
 */
export async function searchUsers(db: Db, q: string, now = new Date()): Promise<UserRow[]> {
  const term = q.trim().slice(0, 100);
  const rows = await db.user.findMany({
    where: term.length >= 3 ? { email: { contains: escapeLike(term), mode: "insensitive" } } : {},
    orderBy: { createdAt: "desc" }, take: 25,
    select: {
      id: true, email: true, name: true, createdAt: true, emailVerified: true, twoFactorEnabled: true, bannedAt: true, staffRole: true, lastLoginAt: true,
      memberships: { take: 3, select: { household: { select: { billing: { select: { plan: true, status: true, currentPeriodEnd: true } } } } } },
    },
  });
  return rows.map(({ memberships, ...u }) => {
    // Offre réellement accordée (même règle que l'accès et le MRR) : un impayé hors période ou un abonnement résilié = Gratuit.
    const plans = memberships.map((m) => m.household.billing).filter((b) => b !== null).map((b) => effectivePlan(b.plan, b.status, b.currentPeriodEnd, now));
    const paid = plans.find((p) => p !== "FREE");
    return { ...u, plan: paid ?? "FREE" };
  });
}

export async function getUserDetail(db: Db, id: string, now: Date) {
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, createdAt: true, emailVerified: true, twoFactorEnabled: true, bannedAt: true, staffRole: true, onboardedAt: true, deletionRequestedAt: true, timezone: true, locale: true,
      memberships: { select: { role: true, createdAt: true, household: { select: { id: true, name: true, createdAt: true, billing: { select: { plan: true, status: true, interval: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } } } } } },
      loginEvents: { orderBy: { createdAt: "desc" }, take: 10, select: { createdAt: true, success: true, method: true, country: true, suspicious: true, riskReasons: true } },
      supportNotes: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, body: true, createdAt: true, authorId: true } },
      deletionRequests: { orderBy: { createdAt: "desc" }, take: 3, select: { status: true, scheduledFor: true, createdAt: true } },
    },
  });
  if (!user) return null;
  const consents = await db.consent.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, select: { type: true, granted: true, createdAt: true } });
  const latest = new Map<string, { granted: boolean; at: Date }>();
  for (const c of consents) if (!latest.has(c.type)) latest.set(c.type, { granted: c.granted, at: c.createdAt });
  const period = usagePeriod(now);
  const households = await Promise.all(
    user.memberships.map(async (m) => {
      const [usage, documents] = await Promise.all([
        db.usageCounter.findUnique({ where: { householdId_period: { householdId: m.household.id, period } }, select: { documents: true, lettersGenerated: true, aiCostMicros: true } }),
        db.document.count({ where: { householdId: m.household.id } }),
      ]);
      return { ...m, usage: usage ? { ...usage, aiCostMicros: Number(usage.aiCostMicros) } : null, documents };
    }),
  );
  return { user, households, consents: [...latest.entries()].map(([type, v]) => ({ type, ...v })) };
}
