import type { PlanTier } from "@mon-agent-ia/core/plans";

export type Interval = "month" | "year";
export type PaidPlan = Exclude<PlanTier, "FREE">;
export type PriceCatalog = Record<PaidPlan, Record<Interval, string>>;

export function priceFor(catalog: PriceCatalog, plan: PaidPlan, interval: Interval): string {
  const id = catalog[plan]?.[interval];
  if (!id) throw new Error(`Prix Stripe manquant pour ${plan}/${interval}`);
  return id;
}

/** Retrouve l'offre à partir d'un identifiant de prix Stripe ; `null` si le prix est inconnu (ne jamais deviner). */
export function planForPrice(catalog: PriceCatalog, priceId: string | null | undefined): { plan: PaidPlan; interval: Interval } | null {
  if (!priceId) return null;
  for (const plan of ["SOLO", "FAMILLE"] as const) {
    for (const interval of ["month", "year"] as const) if (catalog[plan]?.[interval] === priceId) return { plan, interval };
  }
  return null;
}
