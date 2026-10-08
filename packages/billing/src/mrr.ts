import { PLANS, type PlanTier } from "@mon-agent-ia/core/plans";

export type BillingStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" | "UNPAID";

/** Offre réellement accordée : abonnement actif, en essai, ou impayé encore dans la période payée. */
export function effectivePlan(plan: PlanTier, status: BillingStatus, periodEnd: Date | null, now: Date): PlanTier {
  const active = status === "ACTIVE" || status === "TRIALING" || (status === "PAST_DUE" && (periodEnd?.getTime() ?? 0) > now.getTime());
  return active ? plan : "FREE";
}

export type SubscriptionState = { plan: PlanTier; status: BillingStatus; interval: string | null; currentPeriodEnd: Date | null };

/**
 * Revenu mensuel récurrent (centimes) d'un abonnement : prix catalogue ramené au mois (annuel / 12).
 * C'est une ESTIMATION : remises, coupons, taxes et devises ne sont pas pris en compte (Stripe reste la référence comptable).
 */
export function mrrCents(sub: SubscriptionState | null | undefined, now: Date): number {
  if (!sub) return 0;
  const eff = effectivePlan(sub.plan, sub.status, sub.currentPeriodEnd, now);
  if (eff === "FREE") return 0;
  const price = PLANS[eff].priceCents;
  return sub.interval === "year" ? Math.round(price.year / 12) : price.month;
}
