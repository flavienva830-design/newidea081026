import { describe, expect, it } from "vitest";
import { authorizeStaff, type StaffUser } from "../src/staff.ts";

const now = new Date("2026-10-08T12:00:00Z");
const fresh = new Date("2026-10-08T11:00:00Z");
const u = (over: Partial<StaffUser> = {}): StaffUser => ({ staffRole: "ADMIN", bannedAt: null, emailVerified: true, twoFactorEnabled: true, ...over });
const base = { min: "SUPPORT" as const, requireMfa: true, sessionCreatedAt: fresh, now };

describe("accès au portail d'administration", () => {
  it("accepte le personnel vérifié avec double authentification", () => {
    expect(authorizeStaff(u(), base)).toEqual({ ok: true, role: "ADMIN" });
    expect(authorizeStaff(u({ staffRole: "SUPPORT" }), base)).toEqual({ ok: true, role: "SUPPORT" });
  });
  it("refuse tout ce qui n'est pas du personnel actif, sans le distinguer (404)", () => {
    for (const user of [u({ staffRole: "NONE" }), u({ bannedAt: now }), u({ emailVerified: false })]) expect(authorizeStaff(user, base)).toEqual({ ok: false, reason: "not_staff" });
  });
  it("exige la double authentification hors développement seulement", () => {
    expect(authorizeStaff(u({ twoFactorEnabled: false }), base)).toEqual({ ok: false, reason: "mfa_required" });
    expect(authorizeStaff(u({ twoFactorEnabled: false }), { ...base, requireMfa: false })).toMatchObject({ ok: true });
  });
  it("le support ne peut pas faire d'actions d'administrateur", () => {
    expect(authorizeStaff(u({ staffRole: "SUPPORT" }), { ...base, min: "ADMIN" })).toEqual({ ok: false, reason: "insufficient" });
    expect(authorizeStaff(u(), { ...base, min: "ADMIN" })).toMatchObject({ ok: true });
  });
  it("les actions sensibles exigent une connexion récente", () => {
    const old = new Date("2026-10-08T05:00:00Z");
    expect(authorizeStaff(u(), { ...base, sessionCreatedAt: old, maxSessionAgeMs: 4 * 3600_000 })).toEqual({ ok: false, reason: "stale" });
    expect(authorizeStaff(u(), { ...base, sessionCreatedAt: old })).toMatchObject({ ok: true }); // lecture : pas de limite
  });
});
