import { describe, expect, it } from "vitest";
import { decryptField, encryptField, generateDek, hmac, open, parseKek, randomToken, safeEqual, seal, unwrapDek, wrapDek } from "../src/crypto.ts";
import { randomBytes } from "node:crypto";

const kek = { version: 1, key: randomBytes(32) };
const H1 = "00000000-0000-7000-8000-000000000001";
const H2 = "00000000-0000-7000-8000-000000000002";

describe("chiffrement d'enveloppe", () => {
  it("aller-retour d'un champ", () => {
    const dek = generateDek();
    const blob = encryptField("Facture EDF 84,20 €", dek, H1, "document_text", "d1");
    expect(blob.toString("utf8")).not.toContain("EDF");
    expect(decryptField(blob, dek, H1, "document_text", "d1")).toBe("Facture EDF 84,20 €");
  });
  it("chiffrés différents pour un même clair (IV aléatoire)", () => {
    const dek = generateDek();
    expect(encryptField("a", dek, H1, "f", "1").equals(encryptField("a", dek, H1, "f", "1"))).toBe(false);
  });
  it("détecte toute altération", () => {
    const dek = generateDek();
    const blob = encryptField("secret", dek, H1, "f", "1");
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 1;
    expect(() => decryptField(blob, dek, H1, "f", "1")).toThrow("Déchiffrement impossible");
  });
  it("refuse un chiffré déplacé vers un autre foyer, champ ou ligne (AAD)", () => {
    const dek = generateDek();
    const blob = encryptField("secret", dek, H1, "f", "1");
    expect(() => decryptField(blob, dek, H2, "f", "1")).toThrow();
    expect(() => decryptField(blob, dek, H1, "g", "1")).toThrow();
    expect(() => decryptField(blob, dek, H1, "f", "2")).toThrow();
  });
  it("mauvaise clé refusée", () => {
    const blob = encryptField("secret", generateDek(), H1, "f", "1");
    expect(() => decryptField(blob, generateDek(), H1, "f", "1")).toThrow();
  });
  it("format invalide / trop court / mauvaise version", () => {
    const key = generateDek();
    expect(() => open(Buffer.alloc(5), key, "x")).toThrow("Format chiffré invalide");
    const blob = seal("x", key, "x");
    blob[0] = 9;
    expect(() => open(blob, key, "x")).toThrow("Format chiffré invalide");
  });
  it("exige des clés de 32 octets", () => {
    expect(() => seal("x", Buffer.alloc(16), "x")).toThrow();
    expect(() => parseKek(Buffer.alloc(8).toString("base64"))).toThrow();
    expect(parseKek(randomBytes(32).toString("base64"), 3).version).toBe(3);
  });
  it("wrap/unwrap de la DEK liés au foyer", () => {
    const dek = generateDek();
    const w = wrapDek(dek, kek, H1);
    expect(unwrapDek(w, kek, H1).equals(dek)).toBe(true);
    expect(() => unwrapDek(w, kek, H2)).toThrow();
  });
  it("hmac déterministe, dépend du poivre", () => {
    expect(hmac("a@b.fr", "p1")).toBe(hmac("a@b.fr", "p1"));
    expect(hmac("a@b.fr", "p1")).not.toBe(hmac("a@b.fr", "p2"));
  });
  it("safeEqual et jetons", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken(16).length).toBeGreaterThanOrEqual(21);
  });
});
