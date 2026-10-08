import { AnalysisError, AnalysisFailure, analyzeDocument, extractContent, type AnalysisOutcome } from "@mon-agent-ia/ai";
import { PLANS, hmac, usagePeriod } from "@mon-agent-ia/core";
import { withTenant, type Db } from "@mon-agent-ia/db";
import type { AiRuntime } from "./ai";
import { audit } from "./audit";
import { persistAnalysis, type PersistResult } from "./analysis-store";
import { hasConsent } from "./consent";
import { currentPlan } from "./plan";
import { addAiCost, consumeDocumentQuota, refundDocumentQuota } from "./quota";
import type { ActiveTenant } from "./tenant";

export type AnalyzeError = { code: "CONSENT" | "QUOTA" | "UNSUPPORTED" | "TOO_LARGE" | "EMPTY" | "INVALID_OUTPUT" | "PROVIDER_ERROR" | "FORBIDDEN" | "PROFILE"; message: string };
export type AnalyzeResult = { ok: true; outcome: AnalysisOutcome; saved: PersistResult } | { ok: false; error: AnalyzeError };

export type AnalyzeDeps = { db: Db; ai: AiRuntime; pepper: string; now?: () => Date };

const MESSAGES: Record<AnalyzeError["code"], string> = {
  CONSENT: "Pour analyser vos documents, vous devez autoriser leur traitement. Vous pouvez le faire dans Paramètres > Mes données.",
  QUOTA: "Vous avez atteint le nombre de documents inclus dans votre offre ce mois-ci.",
  UNSUPPORTED: "Ce fichier n'est pas pris en charge (PDF, JPEG, PNG ou Word).",
  TOO_LARGE: "Ce fichier est trop volumineux.",
  EMPTY: "Aucun texte exploitable n'a été trouvé dans ce document.",
  INVALID_OUTPUT: "L'analyse n'a pas pu être produite de façon fiable. Réessayez avec un document plus net.",
  PROVIDER_ERROR: "Le service d'analyse est momentanément indisponible. Réessayez dans un instant.",
  FORBIDDEN: "Vous n'avez pas le droit d'ajouter des documents dans ce foyer.",
  PROFILE: "Ce profil n'existe pas dans ce foyer.",
};
const fail = (code: AnalyzeError["code"]): AnalyzeResult => ({ ok: false, error: { code, message: MESSAGES[code] } });

/**
 * Analyse un fichier REÇU EN MÉMOIRE puis écrit l'enregistrement minimal.
 *  1. extraction locale (validation du type réel, limites) — rien n'est consommé si le fichier est invalide ;
 *  2. quota atomique ;
 *  3. analyse IA ;
 *  4. persistance de `outcome.persistable` seulement ;
 *  5. traçabilité (tokens, coût, latence — jamais le contenu).
 * Les octets ne sont ni écrits sur disque, ni journalisés, ni mis en file : ils sortent de la portée à la fin de l'appel.
 */
export async function analyzeUpload(
  deps: AnalyzeDeps,
  tenant: ActiveTenant,
  file: { bytes: Uint8Array; declaredMime?: string },
  options: { /** Personne concernée par le document (facultatif) : un profil ACTIF du foyer actif, sinon refus. */ profileId?: string | null } = {},
): Promise<AnalyzeResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const period = usagePeriod(now);

  if (!["OWNER", "ADMIN", "WRITE"].includes(tenant.role)) return fail("FORBIDDEN");
  if (!(await hasConsent(db, tenant.userId, ["SENSITIVE_DATA_PROCESSING", "AI_PROCESSING"]))) return fail("CONSENT");

  // Personne concernée : la RLS isole les lignes par foyer mais ne contrôle pas une clé étrangère. Sans cette vérification
  // explicite, un document du foyer A pourrait référencer le profil d'un foyer B (IDOR) : on exige un profil actif du foyer actif.
  let profileId: string | null = null;
  if (options.profileId) {
    const owned = await withTenant(db, tenant, (tx) =>
      tx.profile.findFirst({ where: { id: options.profileId!, householdId: tenant.householdId, archivedAt: null }, select: { id: true } }),
    );
    if (!owned) return fail("PROFILE");
    profileId = owned.id;
  }

  // 1. Extraction locale.
  let parts;
  try {
    parts = (await extractContent(file.bytes, file.declaredMime)).parts;
  } catch (e) {
    return fail(e instanceof AnalysisError && e.code !== "PROVIDER_ERROR" && e.code !== "INVALID_OUTPUT" ? e.code : "UNSUPPORTED");
  }

  // 2. Quota atomique.
  const plan = await withTenant(db, tenant, (tx) => currentPlan(tx, tenant.householdId));
  const granted = await withTenant(db, tenant, (tx) => consumeDocumentQuota(tx, tenant.householdId, period, PLANS[plan].documentsPerMonth));
  if (!granted) return fail("QUOTA");

  // 3. Analyse IA.
  let outcome: AnalysisOutcome;
  const userRef = hmac(tenant.householdId, deps.pepper).slice(0, 32);
  try {
    outcome = await analyzeDocument({ provider: deps.ai.provider, models: deps.ai.models, pricing: deps.ai.pricing, now: () => now }, { parts, userRef });
  } catch (e) {
    const runs = e instanceof AnalysisFailure ? e.runs : [];
    await withTenant(db, tenant, async (tx) => {
      await refundDocumentQuota(tx, tenant.householdId, period); // l'utilisateur n'a rien reçu : on ne lui compte pas le document
      for (const r of runs) {
        await tx.aiRun.create({ data: { householdId: tenant.householdId, task: "ANALYZE", model: r.model, promptVersion: r.promptVersion, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costMicros: BigInt(r.costMicros), latencyMs: r.latencyMs, status: r.status } });
      }
      if (runs.length) await addAiCost(tx, tenant.householdId, period, BigInt(runs.reduce((n, r) => n + r.costMicros, 0)));
    });
    const code = e instanceof AnalysisError ? e.code : "PROVIDER_ERROR";
    return fail(code === "INVALID_OUTPUT" ? "INVALID_OUTPUT" : "PROVIDER_ERROR");
  }

  // 4 + 5. Enregistrement minimal et traçabilité, en une transaction.
  const saved = await withTenant(db, tenant, async (tx) => {
    const res = await persistAnalysis(tx, { householdId: tenant.householdId, userId: tenant.userId, source: "WEB_UPLOAD", now, profileId }, outcome);
    for (const r of outcome.runs) {
      await tx.aiRun.create({ data: { householdId: tenant.householdId, documentId: res.documentId, task: "ANALYZE", model: r.model, promptVersion: r.promptVersion, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costMicros: BigInt(r.costMicros), latencyMs: r.latencyMs, status: r.status } });
    }
    await addAiCost(tx, tenant.householdId, period, BigInt(outcome.runs.reduce((n, r) => n + r.costMicros, 0)));
    return res;
  });
  await audit(db, { actorId: tenant.userId, householdId: tenant.householdId, action: "document.analyzed", targetType: "document", targetId: saved.documentId, metadata: { kind: outcome.persistable.kind, deadlines: saved.deadlines, savings: saved.savings, escalated: outcome.escalated, dropped: outcome.dropped } }, deps.pepper);

  return { ok: true, outcome, saved };
}
