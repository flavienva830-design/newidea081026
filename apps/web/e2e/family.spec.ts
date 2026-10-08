import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Browser, Page } from "@playwright/test";
import { completeOnboarding, expect, lastLink, PASSWORD, signUpAndVerify, test, uniqueEmail } from "./helpers";

/** Chaque navigateur de test présente sa propre adresse IP : les limiteurs de débit par IP restent actifs sans se gêner entre tests. */
const fakeIp = () => `10.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

/** Un second navigateur (cookies séparés) : le propriétaire et l'invité sont connectés en même temps. */
async function otherBrowser(browser: Browser, baseURL: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  return ctx.newPage();
}

async function junkFile() {
  return { name: "note.pdf", mimeType: "application/pdf", buffer: Buffer.from("ceci n'est pas un vrai PDF") };
}

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

/** Propriétaire connecté, onboardé et passé en offre Famille. */
async function familyOwner(page: Page, request: Parameters<typeof signUpAndVerify>[1], name: string) {
  const email = uniqueEmail("owner");
  await signUpAndVerify(page, request, email, name);
  await completeOnboarding(page);
  const up = await request.post("/api/dev/plan", { data: { email, plan: "FAMILLE" } });
  expect(up.ok()).toBe(true);
  return email;
}

async function inviteFromUi(page: Page, email: string, role: "READ" | "WRITE" | "ADMIN") {
  await page.fill("#invite-email", email);
  await page.selectOption("#invite-role", role);
  await page.getByRole("button", { name: "Envoyer l'invitation", exact: true }).click();
  await expect(page.getByText("Invitation envoyée. Elle est valable 7 jours.")).toBeVisible();
}

test("famille : inviter, rejoindre, changer de foyer, lecture seule, changer le rôle puis retirer", async ({ page, request, browser, baseURL }) => {
  test.setTimeout(180_000);

  // 1. Le propriétaire (offre Famille) ouvre l'espace Famille : la rubrique n'est plus « Bientôt ».
  await familyOwner(page, request, "Alice Martin");
  await page.goto("/app/family");
  await expect(page.getByRole("heading", { level: 1, name: "Famille" })).toBeVisible();
  const familyLink = page.getByRole("navigation", { name: "Navigation de l'application" }).getByRole("link", { name: /Famille/ });
  await expect(familyLink).toHaveAttribute("href", "/app/family");
  await expect(familyLink).not.toContainText("Bientôt");
  await expect(page.getByRole("heading", { name: "Foyer de Alice Martin" })).toBeVisible();
  await expect(page.getByLabel("Rôle de Alice Martin")).toHaveCount(0); // jamais de sélecteur sur son propre rôle

  // 2. Elle invite deux adresses (rôle lecture seule) : même réponse, que l'adresse ait un compte ou non.
  const guestEmail = uniqueEmail("guest");
  await inviteFromUi(page, guestEmail, "READ");
  await expect(page.getByText(guestEmail)).toBeVisible(); // dans « Invitations en attente »
  const strangerEmail = uniqueEmail("stranger");
  await inviteFromUi(page, strangerEmail, "READ"); // même message de succès
  await page.fill("#invite-email", guestEmail);
  await page.getByRole("button", { name: "Envoyer l'invitation", exact: true }).click();
  await expect(page.getByText("Une invitation est déjà en attente pour cette adresse")).toBeVisible();
  // révoquer la seconde : la place est libérée
  await page.getByRole("button", { name: `Révoquer l'invitation de ${strangerEmail}` }).click();
  await expect(page.getByText(strangerEmail)).toHaveCount(0);

  // 3. L'invité crée son compte, puis ouvre le lien reçu par email.
  const link = await lastLink(request, guestEmail, /invite/i);
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  const guest = await otherBrowser(browser, baseURL!);
  await signUpAndVerify(guest, request, guestEmail, "Bruno Durand");
  await completeOnboarding(guest);
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: /Rejoindre « Foyer de Alice Martin »/ })).toBeVisible();
  await expect(guest.getByText("Lecture seule").first()).toBeVisible();
  await guest.getByRole("button", { name: "Rejoindre le foyer" }).click();
  await guest.waitForURL(/\/app\/family/);

  // 4. Le foyer actif a basculé sur le foyer rejoint ; en lecture seule, aucune commande d'écriture.
  await expect(guest.getByRole("button", { name: /Foyer actif : Foyer de Alice Martin/ })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Foyer de Alice Martin" })).toBeVisible();
  await expect(guest.getByText(/votre rôle : lecture seule/)).toBeVisible();
  for (const name of [/Envoyer l.invitation/, "Ajouter le profil", "Renommer", /Retirer/, /Archiver/, /Renvoyer/, /Révoquer/]) {
    await expect(guest.getByRole("button", { name })).toHaveCount(0);
  }
  await expect(guest.getByRole("heading", { name: "Inviter une personne" })).toHaveCount(0);
  await expect(guest.getByText("Seuls les propriétaires et les administrateurs")).toBeVisible();
  await guest.goto("/app/analyze");
  await expect(guest.getByText(/lecture seule/)).toBeVisible();
  await expect(guest.getByRole("button", { name: "Choisir des fichiers" })).toHaveCount(0);
  // côté serveur aussi : l'API d'analyse (foyer actif lu depuis le cookie, rôle lu en base) refuse l'écriture
  const denied = await guest.request.post("/api/analyze", { multipart: { file: await junkFile() }, headers: { origin: baseURL! } });
  expect(denied.status()).toBe(403);

  // 5. Il change de foyer avec le sélecteur : dans le sien il est propriétaire (offre gratuite : proposition de passer à Famille).
  await guest.goto("/app");
  await guest.getByRole("button", { name: /Foyer actif/ }).click();
  await guest.getByRole("button", { name: /^Foyer de Bruno Durand/ }).click();
  await expect(guest.getByRole("button", { name: /Foyer actif : Foyer de Bruno Durand/ })).toBeVisible();
  await guest.goto("/app/family");
  await expect(guest.getByRole("heading", { name: "Foyer de Bruno Durand" })).toBeVisible();
  await expect(guest.getByText("Partagez ce foyer avec vos proches")).toBeVisible();
  await expect(guest.getByRole("link", { name: "Voir l'abonnement" })).toBeVisible();
  const own = await guest.request.post("/api/analyze", { multipart: { file: await junkFile() }, headers: { origin: baseURL! } });
  expect(own.status()).toBe(415); // dans son foyer il peut analyser : le fichier est seulement invalide
  // retour dans le foyer partagé : la préférence est conservée d'une page à l'autre
  await guest.getByRole("button", { name: /Foyer actif/ }).click();
  await guest.getByRole("button", { name: /^Foyer de Alice Martin/ }).click();
  await expect(guest.getByRole("button", { name: /Foyer actif : Foyer de Alice Martin/ })).toBeVisible();
  await guest.goto("/app/documents");
  await expect(guest.getByRole("button", { name: /Foyer actif : Foyer de Alice Martin/ })).toBeVisible();

  // 6. Le propriétaire voit le nouveau membre, change son rôle (lecture + écriture), puis le retire.
  await page.goto("/app/family");
  await expect(page.getByText("Bruno Durand")).toBeVisible();
  await expect(page.getByText(guestEmail)).toHaveCount(1); // devenu membre : n'est plus une invitation en attente
  await page.getByLabel("Rôle de Bruno Durand").selectOption("WRITE");
  await expect(page.getByText("Rôle mis à jour.")).toBeVisible();
  await guest.goto("/app/family");
  await expect(guest.getByText(/votre rôle : lecture et écriture/)).toBeVisible();
  await guest.goto("/app/analyze");
  await expect(guest.getByRole("button", { name: "Choisir des fichiers" })).toBeVisible(); // l'écriture est désormais permise

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Retirer Bruno Durand du foyer" }).click();
  await expect(page.getByText("Bruno Durand")).toHaveCount(0);

  // 7. L'ancien membre retombe sur son propre foyer (le cookie ne donne aucun accès) ; l'ancien lien ne marche plus.
  const after = await guest.request.post("/api/analyze", { multipart: { file: await junkFile() }, headers: { origin: baseURL! } });
  expect(after.status()).toBe(415); // son foyer à lui, pas celui dont il a été retiré (403 s'il y avait encore accès en lecture)
  await guest.goto("/app/family");
  await expect(guest.getByRole("heading", { name: "Foyer de Bruno Durand" })).toBeVisible();
  await expect(guest.getByRole("button", { name: /Foyer actif/ })).toHaveCount(0); // un seul foyer : plus de sélecteur
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "Invitation introuvable ou expirée" })).toBeVisible();
});

test("invitation d'une personne sans compte : connexion, inscription, retour sur l'invitation, puis foyer partagé actif", async ({ page, request, browser, baseURL }) => {
  test.setTimeout(180_000);
  await familyOwner(page, request, "Alice Martin");
  await page.goto("/app/family");
  const guestEmail = uniqueEmail("newcomer");
  await inviteFromUi(page, guestEmail, "WRITE");
  const link = await lastLink(request, guestEmail, /invite/i);
  const token = link.split("/invite/")[1]!;

  // Anonyme : redirigé vers la connexion (le lien d'invitation est conservé), avec explication et lien d'inscription.
  const guest = await otherBrowser(browser, baseURL!);
  const res = await guest.goto(link);
  await guest.waitForURL(/\/login\?next=/);
  expect(new URL(guest.url()).searchParams.get("next")).toBe(`/invite/${token}`);
  await expect(guest.getByText("invité(e) à rejoindre un foyer")).toBeVisible();
  expect(res?.status()).toBeLessThan(400);
  const signup = guest.getByRole("link", { name: "Créer mon espace" });
  await expect(signup).toHaveAttribute("href", `/signup?next=${encodeURIComponent(`/invite/${token}`)}`);

  // Inscription avec l'adresse invitée : après la confirmation de l'email, retour direct sur l'invitation.
  await signup.click();
  await expect(guest.getByText("invité(e) à rejoindre un foyer")).toBeVisible();
  await guest.fill("#name", "Chloé Bernard");
  await guest.fill("#email", guestEmail);
  await guest.fill("#password", PASSWORD);
  await guest.check('input[type="checkbox"]');
  await guest.click('button[type="submit"]');
  await expect(guest.getByText("Vérifiez votre boîte mail")).toBeVisible();
  await guest.goto(await lastLink(request, guestEmail, /confirm/i));
  await guest.waitForURL(/\/invite\//);
  await expect(guest.getByRole("heading", { name: /Rejoindre « Foyer de Alice Martin »/ })).toBeVisible();
  await expect(guest.getByText("Lecture et écriture").first()).toBeVisible();
  await guest.getByRole("button", { name: "Rejoindre le foyer" }).click();

  // Compte pas encore configuré : l'assistant de bienvenue travaille sur SON foyer, jamais sur le foyer rejoint.
  await guest.waitForURL(/\/app\/onboarding/);
  await completeOnboarding(guest);
  // Une fois la configuration terminée, le foyer partagé est le foyer actif.
  await expect(guest.getByRole("button", { name: /Foyer actif : Foyer de Alice Martin/ })).toBeVisible();
  await guest.goto("/app/family");
  await expect(guest.getByText(/votre rôle : lecture et écriture/)).toBeVisible();
  await expect(guest.getByText("Chloé Bernard").first()).toBeVisible();

  // Une page d'invitation ne s'indexe pas, n'est pas mise en cache et applique la CSP à nonce.
  const again = await guest.goto(link);
  expect(again?.headers()["content-security-policy"]).toMatch(/nonce-/);
  expect(again?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  await expect(guest.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(guest.getByRole("heading", { name: "Invitation introuvable ou expirée" })).toBeVisible(); // lien à usage unique
});

test("invitation : mauvaise adresse refusée sans la divulguer ; jeton invalide, inconnu ou mal formé : message générique", async ({ page, request, browser, baseURL }) => {
  test.setTimeout(150_000);
  await familyOwner(page, request, "Alice Martin");
  await page.goto("/app/family");
  const invitedEmail = uniqueEmail("invited");
  await inviteFromUi(page, invitedEmail, "READ");
  const link = await lastLink(request, invitedEmail, /invite/i);

  const other = await otherBrowser(browser, baseURL!);
  const otherEmail = uniqueEmail("other");
  await signUpAndVerify(other, request, otherEmail, "Carole Autre");
  await completeOnboarding(other);
  await other.goto(link);
  await expect(other.getByRole("heading", { name: "Invitation destinée à une autre adresse" })).toBeVisible();
  await expect(other.getByText(invitedEmail)).toHaveCount(0); // l'adresse invitée n'est jamais révélée
  await expect(other.getByText("Foyer de Alice Martin")).toHaveCount(0);
  await expect(other.getByRole("button", { name: "Rejoindre le foyer" })).toHaveCount(0);

  for (const bad of [`/invite/${"a".repeat(43)}`, "/invite/n-importe-quoi", `/invite/${"A1_-".repeat(10)}`]) {
    await other.goto(bad);
    await expect(other.getByRole("heading", { name: "Invitation introuvable ou expirée" })).toBeVisible();
  }
  // Rien n'a changé pour le propriétaire : l'invitation est toujours en attente.
  await page.goto("/app/family");
  await expect(page.getByText(invitedEmail)).toBeVisible();
});

test("documents : « Pour qui est ce document ? » rattache l'analyse à un profil, visible dans la liste", async ({ page, request }) => {
  test.setTimeout(120_000);
  await familyOwner(page, request, "Alice Martin");

  // Un seul profil (soi-même) : pas de question inutile.
  await page.goto("/app/analyze");
  await expect(page.getByLabel(/Pour qui est ce document/)).toHaveCount(0);

  await page.goto("/app/family");
  await page.fill("#profile-name", "Léa");
  await page.selectOption("#profile-relation", "CHILD");
  await page.getByRole("button", { name: "Ajouter le profil" }).click();
  await expect(page.getByText("Profil ajouté.")).toBeVisible();
  await expect(page.getByText("Enfant · sans compte")).toBeVisible();

  await page.goto("/app/analyze");
  await page.getByLabel(/Pour qui est ce document/).selectOption({ label: "Léa" });
  await page.locator('input[type="file"]').setInputFiles({ name: "courrier.pdf", mimeType: "application/pdf", buffer: await letterPdf() });
  await expect(page.getByText("Terminé")).toBeVisible();
  await expect(page.getByText("pour Léa")).toBeVisible();

  await page.goto("/app/documents");
  await expect(page.getByText(/Pour Léa/)).toBeVisible();

  // Un profil inexistant ou d'un autre foyer est refusé par l'API (jamais d'attribution inter-foyers).
  const bad = await page.request.post("/api/analyze", {
    multipart: { file: await junkFile(), profileId: "00000000-0000-4000-8000-000000000000" },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).code).toBe("PROFILE");
  const malformed = await page.request.post("/api/analyze", { multipart: { file: await junkFile(), profileId: "pas-un-uuid" }, headers: { origin: new URL(page.url()).origin } });
  expect(malformed.status()).toBe(422);
});
