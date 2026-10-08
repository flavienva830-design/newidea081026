import "server-only";
import { FakeProvider, OpenAIProvider, parsePricing, type LlmProvider, type ModelConfig, type Pricing } from "@mon-agent-ia/ai";
import { env } from "@/lib/env";

export type AiRuntime = { provider: LlmProvider; models: ModelConfig; pricing: Pricing | undefined };

/** Fournisseur d'IA selon l'environnement. « fake » n'est possible qu'en APP_ENV=dev (validé au démarrage). */
export function aiRuntime(): AiRuntime {
  const e = env();
  const kind = e.AI_PROVIDER ?? (e.OPENAI_API_KEY ? "openai" : "fake");
  const g = globalThis as unknown as { __ai?: AiRuntime };
  if (g.__ai) return g.__ai;
  if (kind === "openai" && !e.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY manquant");
  if (kind === "fake" && e.APP_ENV !== "dev") throw new Error("Fournisseur d'IA factice interdit hors développement");
  g.__ai = {
    provider: kind === "fake" ? new FakeProvider() : new OpenAIProvider({ apiKey: e.OPENAI_API_KEY }),
    models: { mini: e.AI_MODEL_MINI, full: e.AI_MODEL_FULL },
    pricing: parsePricing(e.AI_PRICING_JSON),
  };
  return g.__ai;
}
