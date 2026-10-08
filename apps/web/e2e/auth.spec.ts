import { PASSWORD, completeOnboarding, expect, lastLink, signUpAndVerify, test, totp, uniqueEmail } from "./helpers";

test("parcours complet : inscription, vérification email, onboarding, tableau de bord", async ({ page, request }) => {
  const email = uniqueEmail();
  await signUpAndVerify(page, request, email);
  await completeOnboarding(page);
  await expect(page.getByRole("heading", { name: /Bonjour Camille/ })).toBeVisible();
  await expect(page.getByText("Aucune action pour le moment")).toBeVisible();
  // L'onboarding terminé n'est plus accessible.
  await page.goto("/app/onboarding");
  await expect(page).toHaveURL(/\/app$/);
});

test("zone privée inaccessible sans session, avec redirection interne uniquement", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
  await page.goto("/login?next=//evil.example.com");
  await page.fill("#email", "inconnu@example.test");
  await page.fill("#password", "mauvais-mot-de-passe-123");
  await page.click('button[type="submit"]');
  await expect(page.getByText("Identifiants incorrects.")).toBeVisible();
  expect(new URL(page.url()).hostname).toBe("localhost");
});

test("connexion refusée avec un mauvais mot de passe, message identique pour un compte inconnu", async ({ page, request }) => {
  const email = uniqueEmail("wrong");
  await signUpAndVerify(page, request, email);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "mauvais-mot-de-passe-123");
  await page.click('button[type="submit"]');
  const known = await page.getByRole("alert").innerText();
  await page.fill("#email", uniqueEmail("ghost"));
  await page.click('button[type="submit"]');
  await expect(page.getByRole("alert")).toHaveText(known); // pas d'énumération de comptes
});

test("double authentification : activation, puis défi TOTP à la connexion", async ({ page, request }) => {
  const email = uniqueEmail("mfa");
  await signUpAndVerify(page, request, email);
  await completeOnboarding(page);

  await page.goto("/app/settings/security");
  await page.getByRole("button", { name: "Activer" }).click();
  await page.fill("#mfa-pw", PASSWORD);
  await page.getByRole("button", { name: "Continuer" }).click();
  const manual = await page.getByText(/Clé manuelle/).innerText();
  const secret = manual.split(":")[1]!.trim();
  await page.fill("#mfa-code", totp(secret));
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByText("Double authentification activée.")).toBeVisible();
  await expect(page.locator("ul.font-mono li")).toHaveCount(10);
  await page.getByRole("button", { name: "J'ai enregistré mes codes" }).click();

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/login/);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "Double authentification" })).toBeVisible();
  await page.fill("#code", "000000");
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Code invalide ou expiré.")).toBeVisible();
  await page.fill("#code", totp(secret, Date.now() + 1000));
  await page.getByRole("button", { name: "Valider" }).click();
  await page.waitForURL(/\/app$/);
});

test("lien de connexion par email", async ({ page, request }) => {
  const email = uniqueEmail("magic");
  await signUpAndVerify(page, request, email);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/login/);
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Recevoir un lien de connexion" }).click();
  await expect(page.getByText("Consultez vos emails")).toBeVisible();
  await page.goto(await lastLink(request, email, /lien de connexion/i));
  await page.waitForURL(/\/app$/);
});

test("réinitialisation du mot de passe", async ({ page, request }) => {
  const email = uniqueEmail("reset");
  await signUpAndVerify(page, request, email);
  await page.context().clearCookies();
  await page.goto("/forgot-password");
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByText("Vérifiez vos emails")).toBeVisible();
  await page.goto(await lastLink(request, email, /Réinitialisation/i));
  const next = "Nouvelle-phrase-de-passe-2026!";
  await page.fill("#pw", next);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForURL(/\/login/);
  await page.fill("#email", email);
  await page.fill("#password", next);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app/);
});
