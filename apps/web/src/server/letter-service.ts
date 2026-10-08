import { AnalysisError, LETTER_KINDS, composeLetter, draftLooksSafe, generateLetterDraft, type LetterKind } from "@mon-agent-ia/ai";
import { PLANS, hmac, usagePeriod } from "@mon-agent-ia/core";
import { withTenant, type Db } from "@mon-agent-ia/db";
import { z } from "zod";
import type { AiRuntime } from "./ai";
import { audit } from "./audit";
import { currentPlan } from "./plan";
import { addAiCost, consumeLetterQuota, refundLetterQuota } from "./quota";
import type { ActiveTenant } from "./tenant";

const text = (max: number) => z.string().trim().max(max);

export const LetterRequest = z.object({
  kind: z.enum(LETTER_KINDS),
  actionId: z.uuid().optional(),
  organization: text(120).optional(),
  topic: text(160).optional(),
  note: text(800).optional(),
  sender: z.object({ fullName: text(80).min(2), address: text(300).min(5), city: text(60).min(2), reference: text(60).optional() }),
});
export type LetterRequest = z.infer<typeof LetterRequest>;

export type LetterError = { code: "FORBIDDEN" | "UPGRADE" | "QUOTA" | "NOT_FOUND" | "INVALID" | "INVALID_OUTPUT" | "PROVIDER_ERROR"; message: string };
export type LetterResult = { ok: true; subject: string; text: string; disclaimer: string } | { ok: false; error: LetterError };

const MESSAGES: Record<LetterError["code"], string> = {
  FORBIDDEN: "Vous n'avez pas le droit de rédiger des courriers dans ce foyer.",
  UPGRADE: "La rédaction de courriers est incluse dans les offres Solo et Famille.",
  QUOTA: "Vous avez atteint le nombre de courriers inclus dans votre offre ce mois-ci.",
  NOT_FOUND: "Cette action est introuvable.",
  INVALID: "Précisez l'organisme et l'objet du courrier.",
  INVALID_OUTPUT: "Le courrier n'a pas pu être rédigé de façon fiable. Réessayez.",
  PROVIDER_ERROR: "Le service de rédaction est momentanément indisponible. Réessayez dans un instant.",
};
const fail = (code: LetterError["code"]): LetterResult => ({ ok: false, error: { code, message: MESSAGES[code] } });

const DISCLAIMER = "Brouillon généré par IA : relisez-le attentivement avant de l'envoyer. Ce n'est pas un conseil juridique. Rien n'est conservé par Mon Agent IA.";
const FORMAL_NOTICE_WARNING = " Pour une mise en demeure, privilégiez un envoi en recommandé avec accusé de réception et, en cas de doute, demandez conseil à un professionnel du droit.";

/**
 * Rédige un courrier SANS RIEN CONSERVER : le texte n'est ni stocké ni journalisé ; seuls un compteur d'usage et la
 * trace technique de l'appel IA (tokens, coût) sont écrits. L'identité de l'utilisateur n'est jamais transmise au modèle.
 */
export async function generateLetter(deps: { db: Db; ai: AiRuntime; pepper: string; now?: () => Date }, tenant: ActiveTenant, raw: unknown): Promise<LetterResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const period = usagePeriod(now);

  if (!["OWNER", "ADMIN", "WRITE"].includes(tenant.role)) return fail("FORBIDDEN");
  const parsed = LetterRequest.safeParse(raw);
  if (!parsed.success) return fail("INVALID");
  const req = parsed.data;

  // Contexte : à partir d'une action (organisme, objet, dates) ou saisi par l'utilisateur.
  let organization = req.organization || null;
  let topic = req.topic || "";
  let rationale: string | null = null;
  let amountCents: number | null = null;
  let dates: string[] = [];
  if (req.actionId) {
    const ctx = await withTenant(db, tenant, async (tx) => {
      const a = await tx.recommendedAction.findUnique({ where: { id: req.actionId! }, select: { title: true, rationale: true, document: { select: { organization: true, amountCents: true, deadlines: { select: { dueDate: true }, orderBy: { dueDate: "asc" }, take: 3 } } } } });
      return a;
    });
    if (!ctx) return fail("NOT_FOUND"); // inconnue ou d'un autre foyer : même réponse
    organization = organization ?? ctx.document?.organization ?? null;
    topic = topic || ctx.title;
    rationale = ctx.rationale;
    amountCents = ctx.document?.amountCents ?? null;
    dates = ctx.document?.deadlines.map((d) => d.dueDate.toISOString().slice(0, 10)) ?? [];
  }
  if (!topic) return fail("INVALID");

  const plan = await withTenant(db, tenant, (tx) => currentPlan(tx, tenant.householdId));
  const limit = PLANS[plan].lettersPerMonth;
  if (limit === 0) return fail("UPGRADE");
  const granted = await withTenant(db, tenant, (tx) => consumeLetterQuota(tx, tenant.householdId, period, limit));
  if (!granted) return fail("QUOTA");

  try {
    const { draft, run } = await generateLetterDraft(
      { provider: deps.ai.provider, models: deps.ai.models, pricing: deps.ai.pricing },
      { kind: req.kind as LetterKind, organization, topic, rationale, amountCents, dates, userNote: req.note ?? null, userRef: hmac(tenant.householdId, deps.pepper).slice(0, 32) },
    );
    if (!draftLooksSafe(draft)) throw new AnalysisError("INVALID_OUTPUT", "brouillon refusé");
    const letter = composeLetter(draft, { sender: req.sender, recipient: organization, date: now });
    await withTenant(db, tenant, async (tx) => {
      await tx.aiRun.create({ data: { householdId: tenant.householdId, task: "LETTER", model: run.model, promptVersion: run.promptVersion, inputTokens: run.inputTokens, outputTokens: run.outputTokens, costMicros: BigInt(run.costMicros), latencyMs: run.latencyMs, status: "OK" } });
      await addAiCost(tx, tenant.householdId, period, BigInt(run.costMicros));
    });
    await audit(db, { actorId: tenant.userId, householdId: tenant.householdId, action: "letter.generated", metadata: { kind: req.kind, fromAction: !!req.actionId } }, deps.pepper);
    return { ok: true, subject: letter.subject, text: letter.text, disclaimer: DISCLAIMER + (req.kind === "FORMAL_NOTICE" ? FORMAL_NOTICE_WARNING : "") };
  } catch (e) {
    await withTenant(db, tenant, (tx) => refundLetterQuota(tx, tenant.householdId, period)); // rien livré : le courrier n'est pas décompté
    const code = e instanceof AnalysisError && e.code === "INVALID_OUTPUT" ? "INVALID_OUTPUT" : "PROVIDER_ERROR";
    return fail(code);
  }
}
