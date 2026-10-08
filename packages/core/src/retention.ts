import { z } from "zod";

/**
 * POLITIQUE DE RÉTENTION MINIMALE
 *
 *  - Les fichiers, leur texte, les courriers générés et tout extrait de document ne sont JAMAIS persistés
 *    (ni base de données, ni stockage objet, ni file de tâches, ni cache, ni journaux, ni supervision d'erreurs).
 *  - Le contenu vit en mémoire le temps d'une analyse, dans la requête qui l'a reçu, puis est oublié.
 *  - Seules subsistent des données structurées courtes, validées par `PersistableAnalysis`, que l'utilisateur
 *    peut consulter et supprimer.
 */
export const RETENTION = {
  files: "never",
  fullText: "never",
  generatedLetters: "never",
  structuredRecord: "until_user_deletes",
} as const;

const oneLine = (max: number) =>
  z.string().trim().min(1).max(max).refine((v) => !/[\r\n\u2028\u2029]/.test(v), "une seule ligne");

// Identifiants qu'on ne conserve jamais : ils n'ont aucune utilité pour l'agent et aggravent un incident.
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/;
const LONG_DIGITS = /\d(?:[ .-]?\d){11,}/; // carte bancaire, NIR, n° de sécurité sociale…
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(?:\+33|0033|0)\s?[1-9](?:[ .-]?\d{2}){4}/;

/** Plafond d'analyse : les champs conservés sont de toute façon bien plus courts, et cela borne le coût des expressions régulières. */
const SCAN_LIMIT = 2_000;

export function containsSensitiveIdentifier(v: string): boolean {
  const s = v.length > SCAN_LIMIT ? v.slice(0, SCAN_LIMIT) : v;
  return IBAN.test(s) || LONG_DIGITS.test(s) || (s.includes("@") && EMAIL.test(s)) || PHONE.test(s);
}

const safeText = (max: number) => oneLine(max).refine((v) => !containsSensitiveIdentifier(v), "identifiant sensible interdit");

const cents = z.number().int().min(0).max(1_000_000_000);

const KINDS = ["UNKNOWN", "INVOICE", "CONTRACT", "TAX", "INSURANCE", "HEALTH", "BANK_STATEMENT", "UTILITY", "TELECOM", "OFFICIAL_LETTER", "PAYSLIP", "OTHER"] as const;

/**
 * Seul format autorisé à être écrit en base à l'issue d'une analyse.
 * `.strict()` : toute clé inattendue (text, summary, content…) fait échouer la validation.
 */
export const PersistableAnalysis = z
  .object({
    kind: z.enum(KINDS),
    title: safeText(120),
    organization: safeText(120).nullable(),
    amountCents: cents.nullable(),
    documentDate: z.date().nullable(),
    urgencyScore: z.number().int().min(0).max(100),
    tags: z.array(safeText(30)).max(8),
    deadlines: z
      .array(
        z
          .object({
            kind: z.enum(["PAYMENT", "RENEWAL", "CANCELLATION_NOTICE", "TAX_FILING", "RESPONSE_REQUIRED", "OTHER"]),
            title: safeText(160),
            dueDate: z.date(),
            amountCents: cents.nullable(),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(10),
    savings: z
      .array(
        z
          .object({
            kind: z.enum(["FORGOTTEN_SUBSCRIPTION", "DUPLICATE", "PRICE_INCREASE", "COSTLY_INSURANCE", "UNSUITED_PLAN", "FEE", "OTHER"]),
            title: safeText(160),
            rationale: safeText(300),
            monthlyCents: cents,
            annualCents: cents,
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(10),
    actions: z
      .array(
        z
          .object({
            type: z.enum(["CANCEL_CONTRACT", "CONTEST", "REQUEST_REFUND", "FOLLOW_UP", "REPLY_REQUIRED", "PAY_BEFORE", "REVIEW_DOCUMENT", "OTHER"]),
            title: safeText(160),
            rationale: safeText(300),
            priority: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export type PersistableAnalysis = z.infer<typeof PersistableAnalysis>;

const SENSITIVE_KEYS = /^(text|content|body|html|raw|prompt|completion|message|summary|extract|password|token|secret|authorization|cookie|email|iban|filename|file|attachment|ocr)/i;

/**
 * Nettoyage défensif avant tout journal ou envoi à un outil de supervision : les clés « contenu » sont masquées
 * et toute chaîne longue (susceptible d'être un extrait de document) est remplacée par sa longueur.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[profondeur]";
  if (typeof value === "string") return value.length > 80 ? `[texte:${value.length}]` : containsSensitiveIdentifier(value) ? "[identifiant]" : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (value instanceof Error) return { name: value.name }; // jamais le message : il peut citer une donnée
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? "[masqué]" : scrub(v, depth + 1)]));
  }
  return value;
}

const MASK_PATTERNS: RegExp[] = [
  /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
  /[^\s@]+@[^\s@]+\.[^\s@]+/g,
  /(?:\+33|0033|0)\s?[1-9](?:[ .-]?\d{2}){4}/g,
  /\d(?:[ .-]?\d){11,}/g,
];

/** Masque les identifiants sensibles dans un texte destiné à l'affichage (résumé) : jamais d'IBAN ni de carte à l'écran. */
export function maskSensitiveIdentifiers(text: string): string {
  const bounded = text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text;
  return MASK_PATTERNS.reduce((t, re) => t.replace(re, "[masqué]"), bounded);
}
