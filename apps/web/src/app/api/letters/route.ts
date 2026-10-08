import { NextResponse } from "next/server";
import { scrub } from "@mon-agent-ia/core";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { limiters } from "@/lib/limiters";
import { isSameOrigin } from "@/lib/same-origin";
import { aiRuntime } from "@/server/ai";
import { generateLetter, type LetterError } from "@/server/letter-service";
import { householdIdFromCookieHeader, resolveActiveTenant } from "@/server/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024;
const STATUS: Record<LetterError["code"], number> = { FORBIDDEN: 403, CONSENT: 403, UPGRADE: 402, QUOTA: 402, NOT_FOUND: 404, INVALID: 422, INVALID_OUTPUT: 422, PROVIDER_ERROR: 503 };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** Rédige un courrier. Rien n'est conservé : le texte n'existe que dans cette réponse. */
export async function POST(req: Request) {
  const e = env();
  if (!isSameOrigin(req, e.APP_URL)) return json({ error: "Origine refusée." }, 403);
  const session = await auth().api.getSession({ headers: req.headers });
  if (!session?.user.emailVerified) return json({ error: "Connexion requise." }, 401);
  const tenant = await resolveActiveTenant(db(), session.user.id, householdIdFromCookieHeader(req.headers.get("cookie")));
  if (!tenant) return json({ error: "Connexion requise." }, 401);

  const lim = await limiters().api.check(`letters:${session.user.id}`);
  if (!lim.allowed) return json({ error: `Trop de demandes. Réessayez dans ${lim.retryAfterSec} s.` }, 429);

  const len = Number(req.headers.get("content-length"));
  if (!Number.isFinite(len) || len <= 0 || len > MAX_BYTES) return json({ error: "Requête invalide." }, 413);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }

  try {
    const r = await generateLetter({ db: db(), ai: aiRuntime(), pepper: e.HASH_PEPPER }, tenant, body);
    if (!r.ok) return json({ error: r.error.message, code: r.error.code }, STATUS[r.error.code]);
    return json({ ok: true, subject: r.subject, text: r.text, disclaimer: r.disclaimer });
  } catch (err) {
    console.error("[letters] échec", JSON.stringify(scrub(err)));
    return json({ error: "Une erreur est survenue." }, 500);
  }
}
