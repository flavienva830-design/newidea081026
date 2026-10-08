import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { loadEnv } from "../src/index.ts";

const dev = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  AUTH_SECRET: "a".repeat(40) + "Zq9",
  KEK_BASE64: randomBytes(32).toString("base64"),
  HASH_PEPPER: "p".repeat(32) + "X1",
};
const prod = {
  ...dev,
  APP_ENV: "production",
  APP_URL: "https://monagentia.com",
  DATABASE_SERVICE_URL: "postgresql://s:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  RESEND_API_KEY: "re_x", EMAIL_FROM: "Mon Agent IA <no-reply@monagentia.com>",
  STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x", OPENAI_API_KEY: "sk-x",
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", TURNSTILE_SECRET_KEY: "t", SENTRY_DSN: "https://x@sentry.io/1",
};

describe("validation de l'environnement", () => {
  it("accepte une configuration de développement minimale", () => {
    const env = loadEnv(dev);
    expect(env.APP_ENV).toBe("dev");
    expect(env.KEK_VERSION).toBe(1);
  });
  it("refuse une clé maître de mauvaise taille", () => {
    expect(() => loadEnv({ ...dev, KEK_BASE64: "abcd" })).toThrow(/KEK_BASE64/);
  });
  it("refuse un secret trop court sans jamais l'afficher", () => {
    try {
      loadEnv({ ...dev, AUTH_SECRET: "trop-court" });
      throw new Error("aurait dû échouer");
    } catch (e) {
      expect((e as Error).message).toMatch(/AUTH_SECRET/);
      expect((e as Error).message).not.toContain("trop-court");
    }
  });
  it("production : tout est obligatoire", () => {
    expect(loadEnv(prod).APP_ENV).toBe("production");
    expect(() => loadEnv({ ...prod, STRIPE_SECRET_KEY: undefined })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => loadEnv({ ...prod, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
  });
  it("production : HTTPS obligatoire, secrets non triviaux, rôles DB distincts", () => {
    expect(() => loadEnv({ ...prod, APP_URL: "http://monagentia.com" })).toThrow(/HTTPS/);
    expect(() => loadEnv({ ...prod, AUTH_SECRET: "changeme".padEnd(40, "x") })).toThrow(/faible/);
    expect(() => loadEnv({ ...prod, DATABASE_SERVICE_URL: prod.DATABASE_URL })).toThrow(/rôles séparés/);
  });
});
