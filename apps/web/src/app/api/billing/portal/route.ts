import { NextResponse } from "next/server";
import { createPortalUrl } from "@mon-agent-ia/billing";
import { can } from "@mon-agent-ia/core";
import { withTenant } from "@mon-agent-ia/db";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isSameOrigin } from "@/lib/same-origin";
import { billingConfigured, stripeClient } from "@/server/billing";
import { resolveTenant } from "@/server/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { "cache-control": "no-store" } });

/** Portail client Stripe : changement d'offre, moyen de paiement, factures, résiliation. */
export async function POST(req: Request) {
  const e = env();
  if (!isSameOrigin(req, e.APP_URL)) return json({ error: "Origine refusée." }, 403);
  const session = await auth().api.getSession({ headers: req.headers });
  if (!session?.user.emailVerified) return json({ error: "Connexion requise." }, 401);
  const tenant = await resolveTenant(db(), session.user.id);
  if (!tenant) return json({ error: "Connexion requise." }, 401);
  if (!can(tenant.role, "billing:manage")) return json({ error: "Seul le propriétaire du foyer peut gérer l'abonnement." }, 403);
  if (!billingConfigured()) return json({ error: "Le paiement n'est pas encore disponible." }, 503);

  const b = await withTenant(db(), tenant, (tx) => tx.billingSubscription.findUnique({ where: { householdId: tenant.householdId }, select: { stripeCustomerId: true } }));
  if (!b) return json({ error: "Aucun abonnement à gérer." }, 404);
  try {
    return json({ url: await createPortalUrl(stripeClient(), { customerId: b.stripeCustomerId, appUrl: e.APP_URL }) });
  } catch {
    return json({ error: "Le portail est momentanément indisponible." }, 503);
  }
}
