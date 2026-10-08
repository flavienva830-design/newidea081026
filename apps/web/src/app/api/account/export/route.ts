import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { limiters } from "@/lib/limiters";
import { isSameOrigin } from "@/lib/same-origin";
import { audit } from "@/server/audit";
import { buildExport } from "@/server/export";
import { clientInfo } from "@/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Télécharge toutes les données personnelles (JSON). POST + Origin vérifiée : un lien externe ne peut pas le déclencher. */
export async function POST(req: Request) {
  const e = env();
  if (!isSameOrigin(req, e.APP_URL)) return NextResponse.json({ error: "Origine refusée." }, { status: 403 });
  const session = await auth().api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const lim = await limiters().api.check(`export:${session.user.id}`);
  if (!lim.allowed) return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429 });

  const data = await buildExport(db(), session.user.id);
  await audit(db(), { actorId: session.user.id, action: "account.exported", ip: clientInfo(req.headers).ip }, e.HASH_PEPPER);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="mes-donnees-mon-agent-ia.json"', "cache-control": "no-store" },
  });
}
