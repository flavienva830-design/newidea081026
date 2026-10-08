import { NextResponse } from "next/server";
import { handleStripeEvent, verifyWebhook } from "@mon-agent-ia/billing";
import { dbService } from "@/lib/db";
import { env } from "@/lib/env";
import { priceCatalog } from "@/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 512 * 1024;

/**
 * Webhook Stripe. Sécurité : corps BRUT vérifié par signature (HMAC + tolérance d'horodatage) avant tout traitement ;
 * aucune session ni cookie n'est lu. Les réponses ne détaillent jamais la cause d'un refus.
 */
export async function POST(req: Request) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) return new NextResponse(null, { status: 503 });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return new NextResponse(null, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return new NextResponse(null, { status: 413 });

  let event;
  try {
    event = verifyWebhook(raw, req.headers.get("stripe-signature"), secret);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const r = await handleStripeEvent({ db: dbService(), catalog: priceCatalog() }, event);
    return NextResponse.json({ received: true, status: r.status });
  } catch {
    return new NextResponse(null, { status: 500 }); // Stripe réessaiera
  }
}
