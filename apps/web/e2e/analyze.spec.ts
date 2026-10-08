import { PDFDocument, StandardFonts } from "pdf-lib";
import { completeOnboarding, expect, signUpAndVerify, test, uniqueEmail } from "./helpers";

async function letterPdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  [
    "Madame, Monsieur, chez la société Nova, le tarif de votre abonnement internet passera de 29,99 €",
    "à 35,99 € par mois à compter du 01/12/2026. Vous pouvez résilier sans frais avant le 15 novembre 2026",
    "par courrier recommandé. Votre IBAN FR76 3000 6000 0112 3456 7890 189 sera prélevé. Contact : marie.durand@example.fr",
    "Nous restons à votre disposition pour toute question concernant cette modification tarifaire.",
  ].forEach((l, i) => p.drawText(l, { x: 30, y: 800 - i * 16, size: 9, font: f }));
  return Buffer.from(await d.save());
}

test("analyse d'un document : résultat, échéances, actions, économies, puis suppression", async ({ page, request }) => {
  await signUpAndVerify(page, request, uniqueEmail("doc"));
  await completeOnboarding(page);

  await page.getByRole("link", { name: "Analyser", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Analyser un document" })).toBeVisible();
  await expect(page.getByText("n'est ni enregistré ni conservé")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({ name: "courrier-nova.pdf", mimeType: "application/pdf", buffer: await letterPdf() });
  await expect(page.getByText(/J'ai détecté 72\s€ d'économies potentielles par an/)).toBeVisible();
  await expect(page.getByText("Terminé")).toBeVisible();
  // Les identifiants sensibles n'apparaissent jamais à l'écran.
  const body = await page.locator("main").innerText();
  expect(body).not.toContain("FR76");
  expect(body).not.toContain("marie.durand");

  await page.goto("/app/actions");
  await expect(page.getByText("Demander un geste commercial")).toBeVisible();
  await page.getByRole("button", { name: "Accepter" }).first().click();
  await expect(page.getByText("acceptée")).toBeVisible();

  await page.goto("/app/deadlines");
  await expect(page.getByText("Date limite de résiliation")).toBeVisible();
  await expect(page.getByText(/15 novembre 2026/)).toBeVisible();

  await page.goto("/app/savings");
  await expect(page.getByText("Hausse de 6,00 € par mois")).toBeVisible();

  await page.goto("/app");
  await expect(page.getByText("Documents analysés")).toBeVisible();
  
  await page.goto("/app/documents");
  await expect(page.getByText("Courrier opérateur")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByText("Aucun document analysé")).toBeVisible();
  await page.goto("/app/deadlines");
  await expect(page.getByText("Aucune échéance à venir")).toBeVisible();
});

test("fichier non pris en charge : message clair, aucune trace", async ({ page, request }) => {
  await signUpAndVerify(page, request, uniqueEmail("bad"));
  await completeOnboarding(page);
  await page.goto("/app/analyze");
  await page.locator('input[type="file"]').setInputFiles({ name: "note.pdf", mimeType: "application/pdf", buffer: Buffer.from("ceci n'est pas un vrai PDF") });
  await expect(page.getByText("pas pris en charge")).toBeVisible();
  await page.goto("/app/documents");
  await expect(page.getByText("Aucun document analysé")).toBeVisible();
});

test("l'API d'analyse refuse les requêtes inter-sites et anonymes", async ({ request, baseURL }) => {
  const file = { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") };
  const noOrigin = await request.post("/api/analyze", { multipart: { file } });
  expect(noOrigin.status()).toBe(403);
  const cross = await request.post("/api/analyze", { multipart: { file }, headers: { origin: "https://evil.example" } });
  expect(cross.status()).toBe(403);
  const anon = await request.post("/api/analyze", { multipart: { file }, headers: { origin: baseURL! } });
  expect(anon.status()).toBe(401);
});
