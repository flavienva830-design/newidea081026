import { describe, expect, it } from "vitest";
import { planForPrice, priceFor, type PriceCatalog } from "../src/catalog.ts";

const C: PriceCatalog = { SOLO: { month: "p_sm", year: "p_sy" }, FAMILLE: { month: "p_fm", year: "p_fy" } };

describe("catalogue de prix", () => {
  it("retrouve l'offre et la période depuis un prix", () => {
    expect(planForPrice(C, "p_sm")).toEqual({ plan: "SOLO", interval: "month" });
    expect(planForPrice(C, "p_fy")).toEqual({ plan: "FAMILLE", interval: "year" });
  });
  it("prix inconnu, vide ou absent : null (jamais de devinette)", () => {
    expect(planForPrice(C, "p_autre")).toBeNull();
    expect(planForPrice(C, "")).toBeNull();
    expect(planForPrice(C, undefined)).toBeNull();
  });
  it("prix manquant : erreur explicite", () => {
    expect(priceFor(C, "SOLO", "year")).toBe("p_sy");
    expect(() => priceFor({ ...C, SOLO: { month: "", year: "" } }, "SOLO", "month")).toThrow("Prix Stripe manquant");
  });
});
