import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { LIMITS, extractContent } from "../src/extract.ts";
import { JPG, PNG, makeBlankPdf, makeDocx, makePdf } from "./helpers.ts";

const LONG = Array.from({ length: 12 }, (_, i) => `Ligne ${i} : votre abonnement passera de 29,99 EUR a 35,99 EUR par mois le 01/12/2026.`);

describe("extraction en mémoire", () => {
  it("PDF avec texte : texte natif, aucun envoi du fichier", async () => {
    const r = await extractContent(await makePdf(LONG), "application/pdf");
    expect(r.method).toBe("native_text");
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]).toMatchObject({ type: "text" });
    expect((r.parts[0] as { text: string }).text).toContain("29,99");
    expect(r.pageCount).toBe(1);
  });

  it("PDF sans texte (scan) : transmis au modèle de vision", async () => {
    const r = await extractContent(await makeBlankPdf());
    expect(r.method).toBe("vision");
    expect(r.parts[0]).toMatchObject({ type: "pdf" });
  });

  it("images JPEG et PNG : vision", async () => {
    expect((await extractContent(PNG, "image/png")).parts[0]).toMatchObject({ type: "image", mime: "image/png" });
    expect((await extractContent(JPG)).parts[0]).toMatchObject({ type: "image", mime: "image/jpeg" });
  });

  it("DOCX : texte extrait, entités décodées, balises retirées", async () => {
    const r = await extractContent(makeDocx(["Facture <EDF> & Cie", "Total : 84,20 €"]));
    expect(r.method).toBe("docx_text");
    const t = (r.parts[0] as { text: string }).text;
    expect(t).toContain("Facture <EDF> & Cie");
    expect(t).toContain("84,20 €");
    expect(t).not.toContain("<w:");
  });

  it("DOCX : refuse une archive piégée (trop d'entrées ou trop volumineuse)", async () => {
    const many: Record<string, Uint8Array> = { "word/document.xml": strToU8("<w:p/>") };
    for (let i = 0; i < LIMITS.maxDocxEntries + 5; i++) many[`f${i}.txt`] = strToU8("x");
    await expect(extractContent(zipSync(many))).rejects.toMatchObject({ code: "TOO_LARGE" });
    const big = zipSync({ "word/document.xml": strToU8("<w:p/>"), "big.bin": new Uint8Array(LIMITS.maxDocxUncompressed + 1024) });
    await expect(extractContent(big)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("DOCX invalide ou vide", async () => {
    await expect(extractContent(zipSync({ "autre.txt": strToU8("x") }))).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(extractContent(makeDocx([]))).rejects.toMatchObject({ code: "EMPTY" });
    await expect(extractContent(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("refuse les types inconnus et les types déclarés trompeurs", async () => {
    await expect(extractContent(strToU8("MZ exécutable"))).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(extractContent(await makePdf(LONG), "image/png")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("PDF trop long ou corrompu", async () => {
    await expect(extractContent(await makePdf(["x"], LIMITS.maxPdfPages + 1))).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(extractContent(strToU8("%PDF-1.7 corrompu"))).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("tronque le texte très long", async () => {
    const huge = Array.from({ length: 40 }, () => "mot ".repeat(2000));
    const r = await extractContent(makeDocx(huge));
    expect(r.truncated).toBe(true);
    expect((r.parts[0] as { text: string }).text.length).toBeLessThanOrEqual(LIMITS.maxTextChars);
  });
});
