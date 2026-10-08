import { PDFDocument, StandardFonts } from "pdf-lib";
import { completeOnboarding, expect, signUpAndVerify, test, uniqueEmail } from "./helpers";

async function letterPdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  [
    "Madame, Monsieur, chez la société Nova, le tarif de votre abonnement internet passera de 29,99 €",
    "à 35,99 € par mois à compter du 01/12/2026. Vous pouvez résilier sans frais avant le 15 novembre 2026.",
    "Nous restons à votre disposition pour toute question concernant cette modification tarifaire.",
  ].forEach((l, i) => p.drawText(l, { x: 30, y: 800 - i * 16, size: 9, font: f }));
  return Buffer.from(await d.save());
}

test("courriers : réservé aux offres payantes ; l'API refuse l'anonyme et le inter-sites", async ({ page, request, baseURL }) => {
  await signUpAndVerify(page, request, uniqueEmail("letter"));
  await completeOnboarding(page);
  await page.goto("/app/letters");
  await expect(page.getByText("incluse dans les offres Solo et Famille")).toBeVisible();

  const anon = await request.post("/api/letters", { data: {}, headers: { origin: baseURL! } });
  expect(anon.status()).toBe(401);
  const cross = await request.post("/api/letters", { data: {}, headers: { origin: "https://evil.example" } });
  expect(cross.status()).toBe(403);
});

test("courriers : de l'analyse à la lettre prête à télécharger (offre Solo)", async ({ page, request }) => {
  const email = uniqueEmail("solo");
  await signUpAndVerify(page, request, email);
  await completeOnboarding(page);
  // Passage en offre Solo par la boîte de test : l'abonnement réel sera géré par Stripe.
  const up = await request.post("/api/dev/plan", { data: { email, plan: "SOLO" } });
  expect(up.ok()).toBe(true);

  await page.goto("/app/analyze");
  await page.locator('input[type="file"]').setInputFiles({ name: "courrier.pdf", mimeType: "application/pdf", buffer: await letterPdf() });
  await expect(page.getByText("Terminé")).toBeVisible();

  await page.goto("/app/actions");
  await page.getByRole("link", { name: "Préparer le courrier" }).first().click();
  await expect(page.getByRole("heading", { name: "Courriers" })).toBeVisible();
  await expect(page.locator("#org")).toHaveValue("Nova");

  await page.fill("#addr", "12 rue des Lilas\n75011 Paris");
  await page.fill("#city", "Paris");
  await page.fill("#ref", "CONTRAT-7788");
  await page.getByRole("button", { name: "Rédiger le courrier" }).click();

  const textarea = page.locator("#letter-text");
  await expect(textarea).toBeVisible();
  const value = await textarea.inputValue();
  expect(value).toContain("Camille Martin");
  expect(value).toContain("12 rue des Lilas");
  expect(value).toContain("CONTRAT-7788");
  expect(value).toContain("À l'attention de Nova");
  expect(value).not.toMatch(/\[\[/);
  await expect(page.getByText("pas un conseil juridique")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Télécharger en PDF" }).click()]);
  expect(download.suggestedFilename()).toBe("courrier.pdf");
});
