import { NextResponse } from "next/server";
import { z } from "zod";
import { createCheckoutUrl, ensureCustomer } from "@mon-agent-ia/billing";
import { can } from "@mon-agent-ia/core";
import { withTenant } from "@mon-agent-ia/db";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { limiters } from "@/lib/limiters";
import { isSameOrigin } from "@/lib/same-origin";
import { billingConfigured, priceCatalog, stripeClient } from "@/server/billing";
import { currentPlan } from "@/server/plan";
import { householdIdFromCookieHeader, resolveActiveTenant } from "@/server/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ plan: z.enum(["SOLO", "FAMILLE"]), interval: z.enum(["month", "year"]) });
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { "cache-control": "no-store" } });

/** Ouvre une session de paiement Stripe pour le foyer. Réservé au propriétaire (billing:manage). */
export async function POST(req: Request) {
  const e = env();
  if (!isSameOrigin(req, e.APP_URL)) return json({ error: "Origine refusée." }, 403);
  const session = await auth().api.getSession({ headers: req.headers });
  if (!session?.user.emailVerified) return json({ error: "Connexion requise." }, 401);
  const tenant = await resolveActiveTenant(db(), session.user.id, householdIdFromCookieHeader(req.headers.get("cookie")));
  if (!tenant) return json({ error: "Connexion requise." }, 401);
  if (!can(tenant.role, "billing:manage")) return json({ error: "Seul le propriétaire du foyer peut gérer l'abonnement." }, 403);
  if (!billingConfigured()) return json({ error: "Le paiement n'est pas encore disponible." }, 503);
  const lim = await limiters().api.check(`billing:${session.user.id}`);
  if (!lim.allowed) return json({ error: "Trop de demandes. Réessayez dans un instant." }, 429);

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "Demande invalide." }, 422);

  try {
    const stripe = stripeClient();
    const state = await withTenant(db(), tenant, async (tx) => ({
      plan: await currentPlan(tx, tenant.householdId),
      billing: await tx.billingSubscription.findUnique({ where: { householdId: tenant.householdId }, select: { stripeCustomerId: true } }),
    }));
    // Déjà abonné : le changement d'offre passe par le portail (jamais deux abonnements en parallèle).
    if (state.plan !== "FREE") return json({ error: "Vous avez déjà un abonnement : utilisez « Gérer l'abonnement ».", code: "ALREADY_SUBSCRIBED" }, 409);

    let customerId = state.billing?.stripeCustomerId;
    if (!customerId) {
      customerId = await ensureCustomer(stripe, { householdId: tenant.householdId, email: session.user.email, name: session.user.name });
      await withTenant(db(), tenant, (tx) => tx.billingSubscription.upsert({ where: { householdId: tenant.householdId }, create: { householdId: tenant.householdId, stripeCustomerId: customerId!, plan: "FREE", status: "ACTIVE" }, update: {} }));
    }
    const url = await createCheckoutUrl(stripe, { customerId, householdId: tenant.householdId, plan: body.data.plan, interval: body.data.interval, catalog: priceCatalog(), appUrl: e.APP_URL });
    return json({ url });
  } catch {
    return json({ error: "Le paiement est momentanément indisponible. Réessayez." }, 503);
  }
}
