import { completeOnboarding, expect, signUpAndVerify, test, uniqueEmail } from "./helpers";

test("mes données : export JSON sans secret, retrait de consentement, suppression programmée puis annulée", async ({ page, request }) => {
  const email = uniqueEmail("rgpd");
  await signUpAndVerify(page, request, email);
  await completeOnboarding(page);
  await page.goto("/app/settings/data");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Télécharger l'archive" }).click()]);
  const path = await download.path();
  const fs = await import("node:fs/promises");
  const json = JSON.parse(await fs.readFile(path!, "utf8"));
  expect(json.account.email).toBe(email);
  expect(json.consents.length).toBeGreaterThanOrEqual(4);
  const raw = JSON.stringify(json);
  for (const secret of ["password", "token", "secret", "backupCodes", "wrappedDek"]) expect(raw.toLowerCase()).not.toContain(`"${secret}"`);

  await page.getByRole("button", { name: "Retirer" }).nth(1).click(); // retrait du consentement IA
  await expect(page.getByRole("button", { name: "Accorder" })).toBeVisible();
  await page.goto("/app/analyze");
  await page.locator('input[type="file"]').setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await expect(page.getByText(/autoriser leur traitement/)).toBeVisible();

  await page.goto("/app/settings/data");
  await page.getByPlaceholder("Tapez SUPPRIMER").fill("SUPPRIMER");
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  await expect(page.getByText(/Suppression programmée le/)).toBeVisible();
  await page.getByRole("button", { name: "Annuler la suppression" }).click();
  await expect(page.getByPlaceholder("Tapez SUPPRIMER")).toBeVisible();
});
