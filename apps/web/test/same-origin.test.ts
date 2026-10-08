import { describe, expect, it } from "vitest";
import { isSameOrigin } from "../src/lib/same-origin";

const req = (origin?: string) => new Request("https://app.test/api/analyze", { method: "POST", headers: origin ? { origin } : {} });

describe("protection CSRF des routes d'API", () => {
  it("accepte l'origine de l'application", () => expect(isSameOrigin(req("https://app.test"), "https://app.test")).toBe(true));
  it("refuse une autre origine, un sous-domaine, un autre port ou un schéma différent", () => {
    for (const o of ["https://evil.test", "https://app.test.evil.test", "https://sub.app.test", "https://app.test:8443", "http://app.test"]) expect(isSameOrigin(req(o), "https://app.test")).toBe(false);
  });
  it("refuse l'absence d'en-tête Origin et les valeurs invalides", () => {
    expect(isSameOrigin(req(), "https://app.test")).toBe(false);
    expect(isSameOrigin(req("null"), "https://app.test")).toBe(false);
    expect(isSameOrigin(req("https://app.test"), "pas une url")).toBe(false);
  });
});
