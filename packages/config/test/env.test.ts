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
  TURNSTILE_SECRET_KEY: "t", SENTRY_DSN: "https://x@sentry.io/1",
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
  it("la boîte d'envoi de test est interdite hors dev", () => {
    expect(loadEnv({ ...dev, E2E_OUTBOX: "1" }).E2E_OUTBOX).toBe("1");
    expect(() => loadEnv({ ...prod, E2E_OUTBOX: "1" })).toThrow(/E2E_OUTBOX/);
    expect(() => loadEnv({ ...dev, APP_ENV: "staging", E2E_OUTBOX: "1" })).toThrow(/E2E_OUTBOX/);
  });
  it("le fournisseur d'IA factice est réservé au développement", () => {
    expect(loadEnv({ ...dev, AI_PROVIDER: "fake" }).AI_PROVIDER).toBe("fake");
    expect(() => loadEnv({ ...prod, AI_PROVIDER: "fake" })).toThrow(/AI_PROVIDER/);
    expect(loadEnv({ ...prod, AI_PROVIDER: "openai" }).AI_MODEL_MINI).toBe("gpt-5-mini");
  });
  it("production : tout est obligatoire", () => {
    expect(loadEnv(prod).APP_ENV).toBe("production");
    expect(() => loadEnv({ ...prod, STRIPE_SECRET_KEY: undefined })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => loadEnv({ ...dev, NODE_ENV: "production" })).not.toThrow(); // next start en local/CI reste en APP_ENV=dev
    expect(() => loadEnv({ ...prod, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
  });
  it("staging est aussi strict que la production", () => {
    expect(() => loadEnv({ ...dev, APP_ENV: "staging" })).toThrow(/obligatoire/);
    expect(loadEnv({ ...prod, APP_ENV: "staging", APP_URL: "https://staging.monagentia.com" }).APP_ENV).toBe("staging");
  });
  it("production : HTTPS obligatoire, secrets non triviaux, rôles DB distincts", () => {
    expect(() => loadEnv({ ...prod, APP_URL: "http://monagentia.com" })).toThrow(/HTTPS/);
    expect(() => loadEnv({ ...prod, AUTH_SECRET: "changeme".padEnd(40, "x") })).toThrow(/faible/);
    expect(() => loadEnv({ ...prod, DATABASE_SERVICE_URL: prod.DATABASE_URL })).toThrow(/rôles séparés/);
    expect(() => loadEnv({ ...prod, HIBP_ENABLED: "false" })).toThrow(/HIBP_ENABLED/);
  });
});
