import { NextResponse } from "next/server";
import { z } from "zod";
import { createDb } from "@mon-agent-ia/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Attribution d'un rôle d'équipe pour les tests E2E uniquement : 404 partout sauf APP_ENV=dev ET E2E_OUTBOX=1
 * (validé au démarrage, jamais en staging ni en production). En production, utiliser `pnpm --filter @mon-agent-ia/db staff`.
 */
export async function POST(req: Request) {
  const e = env();
  if (e.APP_ENV !== "dev" || e.E2E_OUTBOX !== "1" || !e.DATABASE_SERVICE_URL) return new NextResponse(null, { status: 404 });
  const body = z.object({ email: z.email(), role: z.enum(["NONE", "SUPPORT", "ADMIN"]) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalide" }, { status: 400 });
  const db = createDb(e.DATABASE_SERVICE_URL);
  try {
    const r = await db.user.updateMany({ where: { email: body.data.email }, data: { staffRole: body.data.role } });
    return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "introuvable" }, { status: 404 });
  } finally {
    await db.$disconnect();
  }
}
