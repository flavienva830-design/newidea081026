import { describe, expect, it, vi } from "vitest";
import { safeNext } from "../src/lib/safe-next";
import { MIN_PASSWORD, passwordStrength } from "../src/lib/password";
import { clientInfo, verifyTurnstile } from "../src/server/security";

describe("safeNext (open redirect)", () => {
  it.each([
    ["/app", "/app"],
    ["/app/settings/security?x=1", "/app/settings/security?x=1"],
    ["//evil.com", "/app"],
    ["https://evil.com", "/app"],
    ["javascript:alert(1)", "/app"],
    ["/\\evil.com", "/app"],
    ["/app\n/evil", "/app"],
    [null, "/app"],
    [undefined, "/app"],
    ["", "/app"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNext(input as string | null | undefined)).toBe(expected);
  });
});

describe("force du mot de passe", () => {
  it("trop court en dessous du minimum", () => {
    expect(passwordStrength("Abc1!").label).toBe("Trop court");
    expect(passwordStrength("a".repeat(MIN_PASSWORD - 1)).score).toBeLessThanOrEqual(1);
  });
  it("progresse avec longueur et variété", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abcdefghijkl").score).toBeLessThan(passwordStrength("Abcdefghijkl1!xyz").score);
    expect(passwordStrength("Phrase-de-passe-solide-2026!").label).toBe("Excellent");
  });
});

describe("clientInfo", () => {
  it("préfère les en-têtes Vercel et prend la première IP", () => {
    const h = new Headers({ "x-forwarded-for": "9.9.9.9", "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8", "x-vercel-ip-country": "fr", "user-agent": "UA" });
    expect(clientInfo(h)).toEqual({ ip: "1.2.3.4", country: "FR", userAgent: "UA" });
  });
  it("valeurs par défaut sûres", () => {
    expect(clientInfo(new Headers())).toEqual({ ip: "unknown", country: null, userAgent: null });
  });
});

describe("Turnstile", () => {
  const ok = () => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  it("sans clé configurée : ne bloque pas (dev)", async () => {
    expect(await verifyTurnstile(undefined, undefined, "1.1.1.1")).toBe(true);
  });
  it("clé configurée mais pas de jeton : refus", async () => {
    expect(await verifyTurnstile(null, "secret", "1.1.1.1")).toBe(false);
    expect(await verifyTurnstile("x".repeat(3000), "secret", "1.1.1.1")).toBe(false);
  });
  it("jeton valide / invalide", async () => {
    expect(await verifyTurnstile("tok", "secret", "1.1.1.1", ok as unknown as typeof fetch)).toBe(true);
    const bad = () => Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 200 }));
    expect(await verifyTurnstile("tok", "secret", "1.1.1.1", bad as unknown as typeof fetch)).toBe(false);
  });
  it("échec fermé : erreur réseau ou HTTP 500 => refus", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("réseau"));
    expect(await verifyTurnstile("tok", "secret", "1.1.1.1", boom as unknown as typeof fetch)).toBe(false);
    const e500 = () => Promise.resolve(new Response("", { status: 500 }));
    expect(await verifyTurnstile("tok", "secret", "1.1.1.1", e500 as unknown as typeof fetch)).toBe(false);
  });
});
