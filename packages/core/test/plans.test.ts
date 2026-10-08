import { describe, expect, it } from "vitest";
import { checkDocumentQuota, checkLetterQuota, checkProfileQuota, PLANS, usagePeriod } from "../src/plans.ts";

describe("plans & quotas", () => {
  it("tarifs conformes au brief", () => {
    expect(PLANS.FREE.priceCents.month).toBe(0);
    expect(PLANS.SOLO.priceCents.month).toBe(990);
    expect(PLANS.FAMILLE.priceCents.month).toBe(1990);
    expect(PLANS.FREE.documentsPerMonth).toBe(5);
    expect(PLANS.SOLO.documentsPerMonth).toBe(500);
    expect(PLANS.FAMILLE.profiles).toBe(5);
  });
  it("quota documents", () => {
    expect(checkDocumentQuota("FREE", 4)).toEqual({ allowed: true });
    expect(checkDocumentQuota("FREE", 5)).toEqual({ allowed: false, reason: "documents_quota", limit: 5 });
  });
  it("quota courriers : non inclus en gratuit", () => {
    expect(checkLetterQuota("FREE", 0)).toMatchObject({ allowed: false, reason: "letters_not_included" });
    expect(checkLetterQuota("SOLO", 59)).toEqual({ allowed: true });
    expect(checkLetterQuota("SOLO", 60)).toMatchObject({ allowed: false, limit: 60 });
  });
  it("quota profils", () => {
    expect(checkProfileQuota("SOLO", 1)).toMatchObject({ allowed: false, reason: "profiles_quota" });
    expect(checkProfileQuota("FAMILLE", 4)).toEqual({ allowed: true });
  });
  it("période d'usage", () => {
    expect(usagePeriod(new Date("2026-03-09T10:00:00Z"))).toBe("2026-03");
  });
});
