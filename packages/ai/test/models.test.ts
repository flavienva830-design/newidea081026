import { describe, expect, it } from "vitest";
import { costMicros, parsePricing } from "../src/models.ts";

describe("tarification", () => {
  it("calcule le coût en micro-euros, 0 sans grille", () => {
    const p = { m: { inPerMTok: 1_000_000, outPerMTok: 4_000_000 } };
    expect(costMicros(p, "m", 2_000_000, 500_000)).toBe(4_000_000);
    expect(costMicros(p, "autre", 1000, 1000)).toBe(0);
    expect(costMicros(undefined, "m", 1000, 1000)).toBe(0);
  });
  it("lit la grille depuis le JSON et rejette les valeurs invalides", () => {
    expect(parsePricing('{"m":{"inPerMTok":1,"outPerMTok":2}}')).toEqual({ m: { inPerMTok: 1, outPerMTok: 2 } });
    expect(parsePricing('{"m":{"inPerMTok":-1,"outPerMTok":2}}')).toBeUndefined();
    expect(parsePricing("pas du json")).toBeUndefined();
    expect(parsePricing(undefined)).toBeUndefined();
  });
});
