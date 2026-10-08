import { NextResponse } from "next/server";
import { z } from "zod";
import { createDb } from "@mon-agent-ia/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Bascule d'offre pour les tests E2E uniquement. Répond 404 partout sauf si APP_ENV=dev ET E2E_OUTBOX=1
 * (jamais en staging ni en production : validé au démarrage). Utilise le rôle de service, uniquement dans ce cas.
 */
export async function POST(req: Request) {
  const e = env();
  if (e.APP_ENV !== "dev" || e.E2E_OUTBOX !== "1" || !e.DATABASE_SERVICE_URL) return new NextResponse(null, { status: 404 });
  const body = z.object({ email: z.email(), plan: z.enum(["FREE", "SOLO", "FAMILLE"]) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalide" }, { status: 400 });
  const db = createDb(e.DATABASE_SERVICE_URL);
  try {
    const user = await db.user.findUnique({ where: { email: body.data.email }, select: { memberships: { select: { householdId: true }, take: 1 } } });
    const householdId = user?.memberships[0]?.householdId;
    if (!householdId) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    await db.billingSubscription.upsert({
      where: { householdId },
      create: { householdId, stripeCustomerId: `cus_e2e_${householdId}`, plan: body.data.plan, status: "ACTIVE" },
      update: { plan: body.data.plan, status: "ACTIVE" },
    });
    return NextResponse.json({ ok: true });
  } finally {
    await db.$disconnect();
  }
}
