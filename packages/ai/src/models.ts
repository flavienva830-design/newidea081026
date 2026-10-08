export type AiTaskName = "classify" | "extract" | "analyze" | "agent";

export type ModelConfig = { mini: string; full: string };

export const DEFAULT_MODELS: ModelConfig = { mini: "gpt-5-mini", full: "gpt-5" };

/** Prix en micro-euros par million de tokens. À renseigner depuis la grille officielle : aucune valeur n'est supposée ici. */
export type Pricing = Record<string, { inPerMTok: number; outPerMTok: number }>;

export function costMicros(pricing: Pricing | undefined, model: string, inputTokens: number, outputTokens: number): number {
  const p = pricing?.[model];
  if (!p) return 0;
  return Math.round((inputTokens * p.inPerMTok + outputTokens * p.outPerMTok) / 1_000_000);
}

export function parsePricing(json: string | undefined): Pricing | undefined {
  if (!json) return undefined;
  try {
    const raw = JSON.parse(json) as Pricing;
    for (const v of Object.values(raw)) if (!(v.inPerMTok >= 0) || !(v.outPerMTok >= 0)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}
