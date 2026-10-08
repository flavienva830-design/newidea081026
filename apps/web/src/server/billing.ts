import "server-only";
import { createStripe, type PriceCatalog } from "@mon-agent-ia/billing";
import { env } from "@/lib/env";

type StripeClient = ReturnType<typeof createStripe>;
const g = globalThis as unknown as { __stripe?: StripeClient };

export function stripeClient(): StripeClient {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY manquant");
  return (g.__stripe ??= createStripe(key));
}

export function priceCatalog(): PriceCatalog {
  const e = env();
  return {
    SOLO: { month: e.STRIPE_PRICE_SOLO_MONTH ?? "", year: e.STRIPE_PRICE_SOLO_YEAR ?? "" },
    FAMILLE: { month: e.STRIPE_PRICE_FAMILLE_MONTH ?? "", year: e.STRIPE_PRICE_FAMILLE_YEAR ?? "" },
  };
}

export const billingConfigured = () => {
  const e = env();
  return Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_PRICE_SOLO_MONTH && e.STRIPE_PRICE_SOLO_YEAR && e.STRIPE_PRICE_FAMILLE_MONTH && e.STRIPE_PRICE_FAMILLE_YEAR);
};
