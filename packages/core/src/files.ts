export const ALLOWED_TYPES = {
  "application/pdf": { ext: "pdf", max: 20 * 1024 * 1024 },
  "image/jpeg": { ext: "jpg", max: 15 * 1024 * 1024 },
  "image/png": { ext: "png", max: 15 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", max: 15 * 1024 * 1024 },
} as const;
export type AllowedMime = keyof typeof ALLOWED_TYPES;

/** Détecte le vrai type par les octets d'en-tête : on ne fait JAMAIS confiance au Content-Type ni à l'extension. */
export function sniffMime(buf: Uint8Array): AllowedMime | null {
  const b = Buffer.from(buf.subarray(0, 8));
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  // DOCX = archive ZIP (PK\x03\x04). La structure interne est vérifiée par le worker avant analyse.
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return null;
}

export type FileCheck = { ok: true; mime: AllowedMime; ext: string } | { ok: false; reason: "empty" | "too_large" | "unsupported_type" | "type_mismatch" };

export function validateUpload(buf: Uint8Array, declaredMime?: string): FileCheck {
  if (buf.length === 0) return { ok: false, reason: "empty" };
  const mime = sniffMime(buf);
  if (!mime) return { ok: false, reason: "unsupported_type" };
  const rule = ALLOWED_TYPES[mime];
  if (buf.length > rule.max) return { ok: false, reason: "too_large" };
  if (declaredMime && declaredMime !== mime) return { ok: false, reason: "type_mismatch" };
  return { ok: true, mime, ext: rule.ext };
}

/** Nom d'origine assaini, pour affichage uniquement. */
export function sanitizeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/^\.+/, "").trim();
  return (clean || "document").slice(0, 120);
}
