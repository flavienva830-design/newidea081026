import Stripe from "stripe";
import { priceFor, type Interval, type PaidPlan, type PriceCatalog } from "./catalog.ts";

export function createStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "Mon Agent IA" } });
}

/** Crée (ou retrouve, grâce à la clé d'idempotence) le client Stripe d'un foyer. */
export async function ensureCustomer(stripe: Stripe, h: { householdId: string; email: string; name: string }): Promise<string> {
  const c = await stripe.customers.create(
    { email: h.email, name: h.name, metadata: { householdId: h.householdId }, preferred_locales: ["fr"] },
    { idempotencyKey: `customer:${h.householdId}` },
  );
  return c.id;
}

export async function createCheckoutUrl(
  stripe: Stripe,
  opts: { customerId: string; householdId: string; plan: PaidPlan; interval: Interval; catalog: PriceCatalog; appUrl: string },
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: opts.customerId,
    client_reference_id: opts.householdId,
    line_items: [{ price: priceFor(opts.catalog, opts.plan, opts.interval), quantity: 1 }],
    subscription_data: { metadata: { householdId: opts.householdId } },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    customer_update: { address: "auto", name: "auto" },
    locale: "fr",
    success_url: `${opts.appUrl}/app/settings/billing?checkout=success`,
    cancel_url: `${opts.appUrl}/app/settings/billing?checkout=cancel`,
  });
  if (!session.url) throw new Error("Session de paiement sans URL");
  return session.url;
}

export async function createPortalUrl(stripe: Stripe, opts: { customerId: string; appUrl: string }): Promise<string> {
  const s = await stripe.billingPortal.sessions.create({ customer: opts.customerId, return_url: `${opts.appUrl}/app/settings/billing` });
  return s.url;
}

/** Vérifie la signature d'un webhook (HMAC + tolérance d'horodatage). Lève une erreur si invalide. */
export function verifyWebhook(rawBody: string, signature: string | null, secret: string): Stripe.Event {
  if (!signature) throw new Error("signature absente");
  return Stripe.webhooks.constructEvent(rawBody, signature, secret, 300);
}
