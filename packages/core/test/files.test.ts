import { describe, expect, it } from "vitest";
import { sanitizeDisplayName, sniffMime, storageKey, validateUpload } from "../src/files.ts";

const pdf = Buffer.from("%PDF-1.7\n...");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

describe("validation des fichiers", () => {
  it("reconnaît les types par leurs octets", () => {
    expect(sniffMime(pdf)).toBe("application/pdf");
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(jpg)).toBe("image/jpeg");
    expect(sniffMime(zip)).toContain("wordprocessingml");
    expect(sniffMime(Buffer.from("MZ\x90\x00"))).toBeNull(); // exécutable Windows
    expect(sniffMime(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });
  it("refuse vide, mauvais type, type déclaré trompeur", () => {
    expect(validateUpload(Buffer.alloc(0))).toEqual({ ok: false, reason: "empty" });
    expect(validateUpload(Buffer.from("hello"))).toEqual({ ok: false, reason: "unsupported_type" });
    expect(validateUpload(pdf, "image/png")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(validateUpload(pdf, "application/pdf")).toMatchObject({ ok: true, ext: "pdf" });
  });
  it("refuse les fichiers trop volumineux", () => {
    const big = Buffer.concat([pdf, Buffer.alloc(21 * 1024 * 1024)]);
    expect(validateUpload(big)).toEqual({ ok: false, reason: "too_large" });
  });
  it("clé de stockage sûre et imprévisible", () => {
    const h = "00000000-0000-7000-8000-000000000001";
    const k1 = storageKey(h, h, 1, "pdf");
    expect(k1).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/v1-[0-9a-f-]{36}\.pdf$/);
    expect(k1).not.toBe(storageKey(h, h, 1, "pdf"));
    expect(() => storageKey("../etc", h, 1, "pdf")).toThrow();
    expect(() => storageKey(h, h, 1, "p/df")).toThrow();
  });
  it("assainit le nom affiché (path traversal, caractères de contrôle)", () => {
    expect(sanitizeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayName("C:\\Users\\x\\facture.pdf")).toBe("facture.pdf");
    expect(sanitizeDisplayName("a\u0000b<c>.pdf")).toBe("abc.pdf");
    expect(sanitizeDisplayName("...")).toBe("document");
    expect(sanitizeDisplayName("x".repeat(500)).length).toBe(120);
  });
});
