import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, RETENTION_POLICY, formatRetention } from "../src/retention-policy.ts";

describe("politique de conservation", () => {
  it("formate les durées de façon lisible", () => {
    expect(formatRetention(7)).toBe("7 jours");
    expect(formatRetention(1)).toBe("1 jour");
    expect(formatRetention(30)).toBe("30 jours");
    expect(formatRetention(90)).toBe("3 mois");
    expect(formatRetention(180)).toBe("6 mois");
    expect(formatRetention(365)).toBe("12 mois");
    expect(formatRetention(390)).toBe("13 mois");
    expect(formatRetention(730)).toBe("24 mois");
  });

  it("chaque catégorie purgée est présentée une fois, avec sa raison (rien d'oublié dans le portail ni la doc)", () => {
    const listed = RETENTION_POLICY.flatMap((p) => p.keys);
    expect([...listed].sort()).toEqual(Object.keys(RETENTION_DAYS).sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const p of RETENTION_POLICY) {
      expect(p.label.length).toBeGreaterThan(5);
      expect(p.why.length).toBeGreaterThan(15);
    }
  });

  it("le journal d'audit n'est jamais conservé moins de 12 mois (plancher de la base)", () => {
    expect(RETENTION_DAYS.auditLogs).toBeGreaterThanOrEqual(365);
  });
});
