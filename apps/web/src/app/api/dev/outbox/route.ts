import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { readOutbox } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/** Boîte d'envoi de test pour les E2E. Répond 404 partout sauf si APP_ENV=dev ET E2E_OUTBOX=1 (validé au démarrage). */
export function GET(req: Request) {
  const e = env();
  if (e.APP_ENV !== "dev" || e.E2E_OUTBOX !== "1") return new NextResponse(null, { status: 404 });
  const to = new URL(req.url).searchParams.get("to");
  if (!to) return NextResponse.json({ error: "to requis" }, { status: 400 });
  return NextResponse.json({ mails: readOutbox(to) });
}
