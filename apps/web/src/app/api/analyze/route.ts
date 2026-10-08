import { NextResponse } from "next/server";
import { scrub } from "@mon-agent-ia/core";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { limiters } from "@/lib/limiters";
import { isSameOrigin } from "@/lib/same-origin";
import { aiRuntime } from "@/server/ai";
import { analyzeUpload, type AnalyzeError } from "@/server/analyze-service";
import { resolveTenant } from "@/server/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 21 * 1024 * 1024; // un peu plus que la plus grande limite par type (20 Mo), enveloppe multipart comprise
const STATUS: Record<AnalyzeError["code"], number> = { QUOTA: 402, FORBIDDEN: 403, TOO_LARGE: 413, UNSUPPORTED: 415, EMPTY: 422, INVALID_OUTPUT: 422, PROVIDER_ERROR: 503 };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Reçoit UN fichier, l'analyse en mémoire et renvoie le résultat. Le contenu n'est ni écrit, ni journalisé, ni mis en file.
 */
export async function POST(req: Request) {
  const e = env();
  if (!isSameOrigin(req, e.APP_URL)) return json({ error: "Origine refusée." }, 403);

  const session = await auth().api.getSession({ headers: req.headers });
  if (!session?.user.emailVerified) return json({ error: "Connexion requise." }, 401);
  const tenant = await resolveTenant(db(), session.user.id);
  if (!tenant) return json({ error: "Connexion requise." }, 401);

  const lim = await limiters().upload.check(`upload:${tenant.householdId}`);
  if (!lim.allowed) return json({ error: `Trop de documents d'un coup. Réessayez dans ${lim.retryAfterSec} s.` }, 429);

  // Taille connue d'avance et bornée : on refuse sans lire le corps (anti-épuisement de mémoire).
  const len = Number(req.headers.get("content-length"));
  if (!Number.isFinite(len) || len <= 0) return json({ error: "Taille du fichier requise." }, 411);
  if (len > MAX_BYTES) return json({ error: "Ce fichier est trop volumineux." }, 413);

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return json({ error: "Requête invalide." }, 400);
  }
  if (!file) return json({ error: "Aucun fichier reçu." }, 400);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await analyzeUpload({ db: db(), ai: aiRuntime(), pepper: e.HASH_PEPPER }, tenant, { bytes } /* le type réel est détecté par les octets : le type déclaré par le navigateur n'est pas fiable */);
    if (!r.ok) return json({ error: r.error.message, code: r.error.code }, STATUS[r.error.code]);
    return json({
      ok: true,
      documentId: r.saved.documentId,
      record: r.outcome.persistable,
      display: r.outcome.display,
      saved: r.saved,
      escalated: r.outcome.escalated,
    });
  } catch (err) {
    // Jamais le message d'erreur brut : il pourrait citer une donnée du document.
    console.error("[analyze] échec", JSON.stringify(scrub(err)));
    return json({ error: "Une erreur est survenue." }, 500);
  }
}
