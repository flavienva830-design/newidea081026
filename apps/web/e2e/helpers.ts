import { createHmac } from "node:crypto";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Chaque test se présente avec sa propre adresse IP (en-tête transmis par un proxy) : les limiteurs de débit par IP
 * (fonctionnalité de sécurité, volontairement active en E2E) ne se déclenchent pas entre tests indépendants.
 */
export const test = base.extend({
  extraHTTPHeaders: async ({}, use, testInfo) => {
    const n = (testInfo.workerIndex * 7919 + testInfo.testId.length * 104729 + Date.now()) >>> 0;
    await use({ "x-forwarded-for": `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${(n & 255) || 1}` });
  },
});
export { expect };

export const PASSWORD = "Phrase-de-passe-solide-2026!";
export const uniqueEmail = (p = "e2e") => `${p}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;

/** Dernier lien reçu par email (boîte d'envoi de test, active uniquement avec APP_ENV=dev + E2E_OUTBOX=1). */
export async function lastLink(request: APIRequestContext, to: string, subjectPart: RegExp): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`);
    if (res.ok()) {
      const { mails } = (await res.json()) as { mails: { subject: string; text: string }[] };
      const m = [...mails].reverse().find((x) => subjectPart.test(x.subject));
      const url = m?.text.match(/https?:\/\/\S+/)?.[0];
      if (url) return url;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Aucun email « ${subjectPart} » pour ${to}`);
}

/** TOTP (RFC 6238, SHA-1, 6 chiffres, 30 s). */
export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secretBase32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

export async function signUpAndVerify(page: Page, request: APIRequestContext, email: string, name = "Camille Martin") {
  await page.goto("/signup");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.check('input[type="checkbox"]');
  await page.click('button[type="submit"]');
  await expect(page.getByText("Vérifiez votre boîte mail")).toBeVisible();
  await page.goto(await lastLink(request, email, /confirm/i));
  await page.waitForURL(/\/app\/onboarding/);
}

export async function completeOnboarding(page: Page) {
  await page.getByText("Traitement de données sensibles").click();
  await page.getByText("Analyse par intelligence artificielle").click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByText("Faisons connaissance")).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByText("Votre foyer.")).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByText("Tout est prêt.")).toBeVisible();
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();
  await page.waitForURL(/\/app$/);
}
