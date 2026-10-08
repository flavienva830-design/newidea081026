import { describe, expect, it } from "vitest";
import { getDocumentProxy, extractText } from "unpdf";
import { letterToPdf, winAnsiSafe } from "../src/lib/letter-pdf";

describe("PDF de courrier", () => {
  it("convertit la typographie non supportée sans planter", () => {
    expect(winAnsiSafe("« Bonjour » — l’été… 12 €")).toContain("l'été...");
    expect(winAnsiSafe("日本語")).toBe("???");
    expect(winAnsiSafe("é à ç œ")).toContain("é à ç");
  });

  it("produit un PDF lisible, avec accents, retours à la ligne et plusieurs pages", async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Ligne ${i} : résiliation de l’abonnement, montant 35,99 €.`).join("\n");
    const pdf = await letterToPdf(`Objet : Résiliation\n\n${long}\n\n${"mot".repeat(200)}`);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    expect(doc.numPages).toBeGreaterThan(2);
    const { text } = await extractText(doc, { mergePages: true });
    expect(text).toContain("Résiliation");
    expect(text).toContain("35,99 €");
  });

  it("texte vide : un PDF valide d'une page", async () => {
    const doc = await getDocumentProxy(new Uint8Array(await letterToPdf("")));
    expect(doc.numPages).toBe(1);
  });
});
