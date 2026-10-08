export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mime: "image/jpeg" | "image/png"; base64: string }
  | { type: "pdf"; base64: string };

export type ProviderRequest = {
  model: string;
  system: string;
  parts: ContentPart[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Identifiant pseudonymisé (HMAC) transmis au fournisseur pour la détection d'abus : jamais un email ni un nom. */
  userRef: string;
  reasoningEffort?: "minimal" | "low" | "medium";
  signal?: AbortSignal;
};

export type ProviderResponse = {
  json: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
  latencyMs: number;
};

/** Fournisseur d'IA interchangeable. Aucune implémentation ne doit journaliser ni conserver le contenu. */
export interface LlmProvider {
  readonly name: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}

export class AnalysisError extends Error {
  constructor(
    public readonly code: "INVALID_OUTPUT" | "PROVIDER_ERROR" | "UNSUPPORTED" | "TOO_LARGE" | "EMPTY",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}
