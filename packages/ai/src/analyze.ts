import { randomBytes } from "node:crypto";
import { ANALYZE_PROMPT_VERSION, analyzeSystemPrompt, wrapDocument } from "./prompts/analyze.ts";
import { DEFAULT_MODELS, costMicros, type ModelConfig, type Pricing } from "./models.ts";
import { toPersistable, type Sanitized } from "./sanitize.ts";
import { ModelAnalysis, strictJsonSchema } from "./schemas.ts";
import { AnalysisError, type ContentPart, type LlmProvider } from "./types.ts";

export type RunLog = {
  task: "ANALYZE";
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs: number;
  status: "OK" | "INVALID_OUTPUT" | "ERROR";
};

export type AnalysisOutcome = Sanitized & { runs: RunLog[]; escalated: boolean; model: string };

export type AnalyzeDeps = {
  provider: LlmProvider;
  models?: ModelConfig;
  pricing?: Pricing;
  now?: () => Date;
  /** Autorise le passage au modèle complet quand la confiance est faible ou le risque élevé. */
  escalate?: boolean;
};

export class AnalysisFailure extends AnalysisError {
  constructor(code: AnalysisError["code"], message: string, public readonly runs: RunLog[]) {
    super(code, message);
    this.name = "AnalysisFailure";
  }
}

const SCHEMA = strictJsonSchema();

/** Escalade vers le modèle complet : doute de l'extraction, urgence forte, instructions suspectes ou document illisible. */
export function needsEscalation(a: Sanitized, hadVisionOnly: boolean, rawHighRisk: boolean): boolean {
  return a.confidence < 0.6 || a.persistable.urgencyScore >= 70 || rawHighRisk || (hadVisionOnly && a.persistable.kind === "UNKNOWN");
}

/**
 * Analyse un document déjà extrait EN MÉMOIRE. Aucun accès réseau autre que le fournisseur d'IA,
 * aucune écriture : la persistance est le travail de l'appelant, et uniquement du résultat `persistable`.
 */
export async function analyzeDocument(deps: AnalyzeDeps, input: { parts: ContentPart[]; userRef: string }): Promise<AnalysisOutcome> {
  const models = deps.models ?? DEFAULT_MODELS;
  const now = (deps.now ?? (() => new Date()))();
  const runs: RunLog[] = [];

  const boundary = randomBytes(9).toString("hex");
  const system = analyzeSystemPrompt({ today: now.toISOString().slice(0, 10), boundary });
  const parts: ContentPart[] = input.parts.map((p) => (p.type === "text" ? { type: "text", text: wrapDocument(p.text, boundary) } : p));
  const visionOnly = input.parts.every((p) => p.type !== "text");

  const attempt = async (model: string): Promise<{ raw: ModelAnalysis } | { raw: null }> => {
    const started = Date.now();
    let res;
    try {
      res = await deps.provider.complete({
        model, system, parts, schemaName: "document_analysis", jsonSchema: SCHEMA,
        maxOutputTokens: 4000, userRef: input.userRef, reasoningEffort: "low",
      });
    } catch {
      runs.push({ task: "ANALYZE", model, promptVersion: ANALYZE_PROMPT_VERSION, inputTokens: 0, outputTokens: 0, costMicros: 0, latencyMs: Date.now() - started, status: "ERROR" });
      throw new AnalysisFailure("PROVIDER_ERROR", "Le service d'analyse est momentanément indisponible.", runs);
    }
    const parsed = ModelAnalysis.safeParse(res.json);
    runs.push({
      task: "ANALYZE", model: res.model, promptVersion: ANALYZE_PROMPT_VERSION,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      costMicros: costMicros(deps.pricing, res.model, res.inputTokens, res.outputTokens),
      latencyMs: res.latencyMs, status: parsed.success ? "OK" : "INVALID_OUTPUT",
    });
    return parsed.success ? { raw: parsed.data } : { raw: null };
  };

  let first = await attempt(models.mini);
  if (!first.raw) first = await attempt(models.full); // une seule réparation, avec le modèle complet
  if (!first.raw) throw new AnalysisFailure("INVALID_OUTPUT", "L'analyse n'a pas pu être produite de façon fiable.", runs);

  let raw = first.raw;
  let result = toPersistable(raw, now);
  let model = runs[runs.length - 1]!.model;
  let escalated = false;

  const highRisk = (r: ModelAnalysis) => r.risks.some((x) => x.severity === "high");
  if (deps.escalate !== false && model !== models.full && needsEscalation(result, visionOnly, highRisk(raw))) {
    const second = await attempt(models.full).catch(() => null); // l'escalade est un bonus : un échec garde le résultat initial
    if (second?.raw) {
      raw = second.raw;
      result = toPersistable(raw, now);
      model = runs[runs.length - 1]!.model;
      escalated = true;
    }
  }
  return { ...result, runs, escalated, model };
}
