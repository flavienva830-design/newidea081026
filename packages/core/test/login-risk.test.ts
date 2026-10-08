import { describe, expect, it } from "vitest";
import { assessLoginRisk, ipPrefix, type KnownHistory } from "../src/login-risk.ts";

const now = new Date("2026-10-08T12:00:00Z");
const hist = (over: Partial<KnownHistory> = {}): KnownHistory => ({
  countries: new Set(["FR"]), deviceHashes: new Set(["d1"]), ipPrefixes: new Set(["1.2.3.0/24"]), recentFailures: 0, ...over,
});

describe("risque de connexion", () => {
  it("connexion habituelle : non suspecte", () => {
    const r = assessLoginRisk({ ipPrefix: "1.2.3.0/24", country: "FR", deviceHash: "d1", at: now }, hist(), false);
    expect(r).toMatchObject({ suspicious: false, stepUp: "none", score: 0 });
  });
  it("premier login : jamais suspect faute d'historique", () => {
    const r = assessLoginRisk({ ipPrefix: "9.9.9.0/24", country: "US", deviceHash: "x", at: now }, hist({ countries: new Set(), deviceHashes: new Set(), ipPrefixes: new Set() }), false);
    expect(r.suspicious).toBe(false);
  });
  it("nouveau pays + nouvel appareil : suspect, demande MFA si activée sinon email", () => {
    const ctx = { ipPrefix: "9.9.9.0/24", country: "US", deviceHash: "x", at: now };
    expect(assessLoginRisk(ctx, hist(), true)).toMatchObject({ suspicious: true, stepUp: "mfa" });
    expect(assessLoginRisk(ctx, hist(), false)).toMatchObject({ suspicious: true, stepUp: "email" });
  });
  it("voyage impossible", () => {
    const r = assessLoginRisk({ ipPrefix: "9.9.9.0/24", country: "JP", deviceHash: "d1", at: now },
      hist({ last: { country: "FR", at: new Date(now.getTime() - 3600_000) } }), false);
    expect(r.reasons).toContain("impossible_travel");
    expect(r.suspicious).toBe(true);
  });
  it("échecs répétés augmentent le score", () => {
    const base = { ipPrefix: "1.2.3.0/24", country: "FR", deviceHash: "d1", at: now };
    expect(assessLoginRisk(base, hist({ recentFailures: 3 }), false).reasons).toContain("recent_failures");
    expect(assessLoginRisk(base, hist({ recentFailures: 9 }), false).suspicious).toBe(true);
  });
  it("troncature d'IP", () => {
    expect(ipPrefix("203.0.113.57")).toBe("203.0.113.0/24");
    expect(ipPrefix("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::/48");
    expect(ipPrefix("n'importe quoi")).toBeNull();
  });
});
