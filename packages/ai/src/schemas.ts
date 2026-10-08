import { z } from "zod";

const KINDS = ["UNKNOWN", "INVOICE", "CONTRACT", "TAX", "INSURANCE", "HEALTH", "BANK_STATEMENT", "UTILITY", "TELECOM", "OFFICIAL_LETTER", "PAYSLIP", "OTHER"] as const;

/** Format que le modèle doit produire. Dates en ISO (AAAA-MM-JJ), montants en centimes. */
export const ModelAnalysis = z.object({
  kind: z.enum(KINDS),
  title: z.string(),
  organization: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  documentDate: z.string().nullable(),
  urgencyScore: z.number().int(),
  confidence: z.number(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  risks: z.array(z.object({ label: z.string(), severity: z.enum(["low", "medium", "high"]) })),
  tags: z.array(z.string()),
  deadlines: z.array(
    z.object({
      kind: z.enum(["PAYMENT", "RENEWAL", "CANCELLATION_NOTICE", "TAX_FILING", "RESPONSE_REQUIRED", "OTHER"]),
      title: z.string(),
      dueDate: z.string(),
      amountCents: z.number().int().nullable(),
      confidence: z.number(),
    }),
  ),
  savings: z.array(
    z.object({
      kind: z.enum(["FORGOTTEN_SUBSCRIPTION", "DUPLICATE", "PRICE_INCREASE", "COSTLY_INSURANCE", "UNSUITED_PLAN", "FEE", "OTHER"]),
      title: z.string(),
      rationale: z.string(),
      monthlyCents: z.number().int(),
      annualCents: z.number().int(),
      confidence: z.number(),
    }),
  ),
  actions: z.array(
    z.object({
      type: z.enum(["CANCEL_CONTRACT", "CONTEST", "REQUEST_REFUND", "FOLLOW_UP", "REPLY_REQUIRED", "PAY_BEFORE", "REVIEW_DOCUMENT", "OTHER"]),
      title: z.string(),
      rationale: z.string(),
      priority: z.number().int(),
    }),
  ),
});
export type ModelAnalysis = z.infer<typeof ModelAnalysis>;

type Json = Record<string, unknown>;

/** Schéma JSON compatible « strict » : tous les champs requis, aucun champ additionnel. */
export function strictJsonSchema(): Json {
  const s = z.toJSONSchema(ModelAnalysis, { target: "draft-7" }) as Json;
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const o = n as Json;
      if (o["type"] === "object" && o["properties"]) {
        o["additionalProperties"] = false;
        o["required"] = Object.keys(o["properties"] as Json);
      }
      delete o["$schema"];
      Object.values(o).forEach(walk);
    }
  };
  walk(s);
  return s;
}
