import { z } from "zod";

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "doit être une clé de 32 octets encodée en base64");

const url = z.string().url();

/**
 * Variables d'environnement validées au démarrage (échec immédiat, jamais de valeur dans les messages d'erreur).
 * En production, les secrets de sécurité sont obligatoires ; en dev/test certains ont une valeur de repli explicite.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["dev", "staging", "production"]).default("dev"),
  APP_URL: url.default("http://localhost:3000"),

  // Base de données : trois rôles distincts (voir packages/db/prisma/migrations/*_rls_and_roles).
  DATABASE_URL: url, // mai_app : soumis à la RLS
  DATABASE_SERVICE_URL: url.optional(), // mai_service : worker, webhooks, admin
  DATABASE_ADMIN_URL: url.optional(), // propriétaire : migrations uniquement

  REDIS_URL: url.optional(),

  // Secrets de sécurité
  AUTH_SECRET: z.string().min(32, "au moins 32 caractères"),
  KEK_BASE64: base64Key32, // clé maître de chiffrement d'enveloppe
  KEK_VERSION: z.coerce.number().int().positive().default(1),
  HASH_PEPPER: z.string().min(32), // HMAC email / IP

  // Services externes (obligatoires en production, voir superRefine)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  // Vérification des mots de passe compromis (HIBP, k-anonymat). Ne peut être désactivée qu'hors production.
  HIBP_ENABLED: z.enum(["true", "false"]).default("true"),
  // IA. « fake » : fournisseur déterministe, uniquement en APP_ENV=dev. Par défaut : openai si une clé existe, sinon fake (dev).
  AI_PROVIDER: z.enum(["openai", "fake"]).optional(),
  AI_MODEL_MINI: z.string().default("gpt-5-mini"),
  AI_MODEL_FULL: z.string().default("gpt-5"),
  /** JSON : {"gpt-5-mini":{"inPerMTok":…,"outPerMTok":…}} en micro-euros par million de tokens, d'après la grille officielle. */
  AI_PRICING_JSON: z.string().optional(),
  // Boîte d'envoi de test (E2E) : n'existe qu'en APP_ENV=dev, jamais en staging ni en production.
  E2E_OUTBOX: z.literal("1").optional(),
});

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_SERVICE_URL",
  "REDIS_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "SENTRY_DSN",
] as const;

const WEAK = /^(changeme|password|secret|test|dev|example|xxxx+)/i;

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Uniquement les noms et raisons : jamais les valeurs.
    const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  const env = parsed.data;
  const problems: string[] = [];
  if (env.AI_PROVIDER === "fake" && env.APP_ENV !== "dev") problems.push("- AI_PROVIDER: « fake » est réservé à APP_ENV=dev");
  if (env.E2E_OUTBOX && env.APP_ENV !== "dev") problems.push("- E2E_OUTBOX: autorisé uniquement avec APP_ENV=dev");

  // Exigences strictes dès qu'on n'est plus en développement (staging et production tournent tous deux avec NODE_ENV=production).
  if (env.APP_ENV !== "dev") {
    for (const k of REQUIRED_IN_PRODUCTION) if (!env[k]) problems.push(`- ${k}: obligatoire en production`);
    for (const k of ["AUTH_SECRET", "HASH_PEPPER"] as const) if (WEAK.test(env[k])) problems.push(`- ${k}: valeur faible ou d'exemple`);
    if (!env.APP_URL.startsWith("https://")) problems.push("- APP_URL: HTTPS obligatoire hors développement");
    if (env.HIBP_ENABLED !== "true") problems.push("- HIBP_ENABLED: ne peut pas être désactivé hors développement");
    if (env.DATABASE_SERVICE_URL && env.DATABASE_SERVICE_URL === env.DATABASE_URL)
      problems.push("- DATABASE_SERVICE_URL: doit différer de DATABASE_URL (rôles séparés)");
  }
  if (problems.length) throw new Error(`Configuration invalide :\n${problems.join("\n")}`);
  return env;
}
