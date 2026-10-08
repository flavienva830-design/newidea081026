import { describe, expect, it } from "vitest";
import { OpenAIProvider } from "../src/openai.ts";
import { strictJsonSchema } from "../src/schemas.ts";
import type { ProviderRequest } from "../src/types.ts";

type Captured = { body: Record<string, any>; opts: unknown };
function client(response: Record<string, unknown> | Error, cap: Captured[]) {
  return {
    responses: {
      create: async (body: Record<string, any>, opts: unknown) => {
        cap.push({ body, opts });
        if (response instanceof Error) throw response;
        return response;
      },
    },
  } as never;
}
const req = (parts: ProviderRequest["parts"]): ProviderRequest => ({
  model: "gpt-5-mini", system: "SYS", parts, schemaName: "document_analysis", jsonSchema: strictJsonSchema(), maxOutputTokens: 4000, userRef: "ref123", reasoningEffort: "low",
});
const OK = { status: "completed", output_text: '{"a":1}', model: "gpt-5-mini-2025-08-07", usage: { input_tokens: 111, output_tokens: 22 } };

describe("fournisseur OpenAI", () => {
  it("n'enregistre rien chez le fournisseur et n'active aucun outil", async () => {
    const cap: Captured[] = [];
    const p = new OpenAIProvider({ client: client(OK, cap) });
    const r = await p.complete(req([{ type: "text", text: "doc" }]));
    const b = cap[0]!.body;
    expect(b["store"]).toBe(false);
    expect(b["tools"]).toBeUndefined();
    expect(b["tool_choice"]).toBeUndefined();
    expect(b["safety_identifier"]).toBe("ref123");
    expect(b["instructions"]).toBe("SYS");
    expect(b["text"].format).toMatchObject({ type: "json_schema", strict: true, name: "document_analysis" });
    expect(b["max_output_tokens"]).toBe(4000);
    expect(b["reasoning"]).toEqual({ effort: "low" });
    expect(r).toMatchObject({ json: { a: 1 }, inputTokens: 111, outputTokens: 22, model: "gpt-5-mini-2025-08-07" });
  });

  it("transmet texte, image et PDF dans le bon format", async () => {
    const cap: Captured[] = [];
    const p = new OpenAIProvider({ client: client(OK, cap) });
    await p.complete(req([{ type: "text", text: "t" }, { type: "image", mime: "image/png", base64: "QUJD" }, { type: "pdf", base64: "UERG" }]));
    const c = cap[0]!.body["input"][0].content;
    expect(c[0]).toEqual({ type: "input_text", text: "t" });
    expect(c[1]).toMatchObject({ type: "input_image", image_url: "data:image/png;base64,QUJD" });
    expect(c[2]).toMatchObject({ type: "input_file", file_data: "data:application/pdf;base64,UERG" });
  });

  it("refuse une réponse incomplète ou non JSON", async () => {
    const inc = new OpenAIProvider({ client: client({ ...OK, status: "incomplete" }, []) });
    await expect(inc.complete(req([{ type: "text", text: "x" }]))).rejects.toThrow("incomplete");
    const bad = new OpenAIProvider({ client: client({ ...OK, output_text: "pas du json" }, []) });
    await expect(bad.complete(req([{ type: "text", text: "x" }]))).rejects.toThrow("sortie non JSON");
  });

  it("les erreurs ne contiennent pas le contenu du document", async () => {
    const p = new OpenAIProvider({ client: client({ ...OK, output_text: "Voici le document: IBAN FR76…" }, []) });
    const err = (await p.complete(req([{ type: "text", text: "IBAN FR76 SECRET" }])).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain("FR76");
  });
});
