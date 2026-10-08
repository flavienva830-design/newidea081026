import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Chiffrement d'enveloppe.
 *  - KEK  (clé maître, 32 octets) : fournie par l'environnement / KMS, versionnée pour la rotation.
 *  - DEK  (clé de données, 32 octets) : une par foyer, stockée chiffrée par la KEK (Household.wrappedDek).
 *  - Contenus : AES-256-GCM avec la DEK ; l'AAD lie chaque chiffré à son contexte
 *    (foyer + champ), ce qui empêche de déplacer un chiffré d'un foyer à un autre.
 *
 * Format binaire : [version:1][iv:12][tag:16][ciphertext...]
 */
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

export type Kek = { version: number; key: Buffer };

function assertKey(key: Buffer, label: string) {
  if (key.length !== 32) throw new Error(`${label} doit faire 32 octets`);
}

export function parseKek(base64: string, version = 1): Kek {
  const key = Buffer.from(base64, "base64");
  assertKey(key, "KEK");
  return { version, key };
}

export function seal(plaintext: Uint8Array | string, key: Buffer, aad: string): Buffer {
  assertKey(key, "clé");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function open(blob: Uint8Array, key: Buffer, aad: string): Buffer {
  assertKey(key, "clé");
  const b = Buffer.from(blob);
  if (b.length < 1 + IV_LEN + TAG_LEN || b[0] !== VERSION) throw new Error("Format chiffré invalide");
  const iv = b.subarray(1, 1 + IV_LEN);
  const tag = b.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = b.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    // Message volontairement générique : ne révèle ni la cause ni le contenu.
    throw new Error("Déchiffrement impossible");
  }
}

export function generateDek(): Buffer {
  return randomBytes(32);
}

export function wrapDek(dek: Buffer, kek: Kek, householdId: string): Buffer {
  return seal(dek, kek.key, `dek:${householdId}`);
}

export function unwrapDek(wrapped: Uint8Array, kek: Kek, householdId: string): Buffer {
  return open(wrapped, kek.key, `dek:${householdId}`);
}

/** Chiffre un champ d'un foyer. `field` = ex. "document_text" ; `recordId` lie le chiffré à sa ligne. */
export function encryptField(plaintext: string | Uint8Array, dek: Buffer, householdId: string, field: string, recordId: string): Buffer {
  return seal(plaintext, dek, `${householdId}:${field}:${recordId}`);
}

export function decryptField(blob: Uint8Array, dek: Buffer, householdId: string, field: string, recordId: string): string {
  return open(blob, dek, `${householdId}:${field}:${recordId}`).toString("utf8");
}

/** HMAC-SHA256 hex : pseudonymisation (ip, email) et hash de jetons. */
export function hmac(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Jeton aléatoire URL-safe (invitations, liens). Seul son hash est stocké. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
