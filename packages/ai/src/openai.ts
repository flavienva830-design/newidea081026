import OpenAI from "openai";
import type { LlmProvider, ProviderRequest, ProviderResponse } from "./types.ts";

type ResponsesClient = Pick<OpenAI, "responses">;

/**
 * Fournisseur OpenAI (API Responses).
 *  - `store: false` : la réponse n'est pas conservée côté OpenAI via l'API (sinon conservation par défaut).
 *  - Aucun outil, aucune recherche web : le modèle ne peut qu'écrire du JSON.
 *  - Les erreurs ne reprennent jamais le contenu de la requête.
 * La conservation zéro (ZDR) et la résidence UE se négocient par contrat avec le fournisseur ; ce code ne les garantit pas.
 */
export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";
  private client: ResponsesClient;

  constructor(opts: { apiKey?: string; baseURL?: string; client?: ResponsesClient; timeoutMs?: number }) {
    this.client =
      opts.client ??
      new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: opts.timeoutMs ?? 55_000, maxRetries: 1 });
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const started = Date.now();
    const content = req.parts.map((p) => {
      if (p.type === "text") return { type: "input_text" as const, text: p.text };
      if (p.type === "image") return { type: "input_image" as const, detail: "auto" as const, image_url: `data:${p.mime};base64,${p.base64}` };
      return { type: "input_file" as const, filename: "document.pdf", file_data: `data:application/pdf;base64,${p.base64}` };
    });

    const res = await this.client.responses.create(
      {
        model: req.model,
        instructions: req.system,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: req.schemaName, schema: req.jsonSchema, strict: true } },
        max_output_tokens: req.maxOutputTokens,
        store: false,
        safety_identifier: req.userRef,
        ...(req.reasoningEffort ? { reasoning: { effort: req.reasoningEffort } } : {}),
      },
      { signal: req.signal },
    );

    if (res.status && res.status !== "completed") throw new Error(`réponse ${res.status}`);
    let json: unknown;
    try {
      json = JSON.parse(res.output_text);
    } catch {
      throw new Error("sortie non JSON");
    }
    return {
      json,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      model: res.model ?? req.model,
      latencyMs: Date.now() - started,
    };
  }
}
