import type { APIRequestContext, Page } from "@playwright/test";
import { PASSWORD, completeOnboarding, expect, signUpAndVerify, test, uniqueEmail } from "./helpers";

const setRole = async (request: APIRequestContext, email: string, role: "NONE" | "SUPPORT" | "ADMIN") => {
  const r = await request.post("/api/dev/staff", { data: { email, role } });
  expect(r.ok()).toBe(true);
};
const login = async (page: Page, email: string) => {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
};

test("portail d'administration : inexistant pour un utilisateur ordinaire, ouvert à l'équipe, pages principales", async ({ page, request }) => {
  const email = uniqueEmail("staff");
  await signUpAndVerify(page, request, email);
  await completeOnboarding(page);

  // Utilisateur ordinaire : le portail n'existe pas (404, pas « accès refusé »), y compris les sous-pages.
  for (const path of ["/admin", "/admin/users", "/admin/audit"]) expect((await page.goto(path))?.status()).toBe(404);

  await setRole(request, email, "ADMIN");
  expect((await page.goto("/admin"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Vue d'ensemble" })).toBeVisible();
  await expect(page.getByText("Revenu mensuel récurrent")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link")).toHaveCount(6);
  await expect(page.locator("summary", { hasText: "Voir le tableau" }).first()).toBeVisible(); // chaque graphique a sa vue tableau

  for (const [path, title] of [["/admin/billing", "Abonnements et revenus"], ["/admin/ai", "Activité IA"], ["/admin/audit", "Journal d'audit"], ["/admin/privacy", "RGPD"], ["/admin/users", "Utilisateurs"]] as const) {
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  }
  // Période : paramètre inconnu retombe sur 30 jours, sans erreur.
  expect((await page.goto("/admin?range=n-importe-quoi"))?.status()).toBe(200);
  await page.goto("/admin?range=7");
  await expect(page.getByRole("link", { name: "7 jours" })).toHaveAttribute("aria-current", "page");

  // Retrait du rôle : effet immédiat (le rôle est relu en base à chaque requête, pas mémorisé dans la session).
  await setRole(request, email, "NONE");
  expect((await page.goto("/admin"))?.status()).toBe(404);
});

test("support : consulte et annote, ne peut ni suspendre ni accéder aux pages réservées aux administrateurs", async ({ page, request }) => {
  const target = uniqueEmail("cible");
  const agent = uniqueEmail("support");
  await signUpAndVerify(page, request, target);
  await page.context().clearCookies();
  await signUpAndVerify(page, request, agent);
  await setRole(request, agent, "SUPPORT");

  // L'accueil du portail redirige vers les utilisateurs ; menu réduit.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link")).toHaveCount(1);
  for (const path of ["/admin/audit", "/admin/billing", "/admin/ai", "/admin/privacy"]) expect((await page.goto(path))?.status()).toBe(404);

  // Recherche : moins de 3 caractères = pas de filtre ; un « % » ne sert pas de joker.
  await page.goto("/admin/users?q=%25%25%25");
  await expect(page.getByText("Aucun utilisateur.")).toBeVisible();
  await page.goto("/admin/users");
  await page.getByLabel("Adresse email").fill(target);
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByText(/1 résultat/)).toBeVisible();
  await page.getByRole("link", { name: target }).click();
  await expect(page.getByRole("heading", { name: target })).toBeVisible();

  // Fiche : ni action de suspension, ni contenu de document ; les notes sont possibles.
  await expect(page.getByText("Votre rôle ne permet que la consultation et les notes.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Suspendre le compte" })).toHaveCount(0);
  await page.getByLabel("Nouvelle note").fill("Appel entrant : question sur la facture");
  await page.getByRole("button", { name: "Ajouter la note" }).click();
  await expect(page.getByText("Appel entrant : question sur la facture")).toBeVisible();
});

test("administrateur : suspension d'un compte (connexion impossible), journal d'audit, réactivation", async ({ page, request }) => {
  const target = uniqueEmail("suspendu");
  const admin = uniqueEmail("admin");
  await signUpAndVerify(page, request, target);
  await completeOnboarding(page);
  await page.context().clearCookies();
  await signUpAndVerify(page, request, admin);
  await completeOnboarding(page);
  await setRole(request, admin, "ADMIN");

  await page.goto(`/admin/users?q=${encodeURIComponent(target)}`);
  await page.getByRole("link", { name: target }).click();
  await expect(page.getByRole("heading", { name: target })).toBeVisible();

  // Le motif est obligatoire : sans lui, les boutons restent inactifs.
  await expect(page.getByRole("button", { name: "Suspendre le compte" })).toBeDisabled();
  await page.getByLabel("Motif (obligatoire)").fill("fraude suspectée (test)");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Suspendre le compte" }).click();
  await expect(page.getByText("Compte suspendu et sessions fermées.")).toBeVisible();
  await expect(page.getByText(/Suspendu le/)).toBeVisible();

  // Journal : l'action est tracée avec son motif, jamais avec un contenu.
  await page.goto("/admin/audit?action=admin.user.ban");
  const row = page.locator("tr", { hasText: "admin.user.ban" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("fraude suspectée (test)");

  // La personne suspendue ne peut plus ouvrir de session, même avec le bon mot de passe.
  await page.context().clearCookies();
  await login(page, target);
  await expect(page.getByText(/compte est suspendu/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // Réactivation par l'administrateur, puis la personne se reconnecte.
  await page.context().clearCookies();
  await login(page, admin);
  await page.waitForURL(/\/app$/);
  await page.goto(`/admin/users?q=${encodeURIComponent(target)}`);
  await page.getByRole("link", { name: target }).click();
  await page.getByLabel("Motif (obligatoire)").fill("vérifié, fausse alerte");
  await page.getByRole("button", { name: "Réactiver le compte" }).click();
  await expect(page.getByText("Compte réactivé.")).toBeVisible();

  await page.context().clearCookies();
  await login(page, target);
  await page.waitForURL(/\/app$/);
});

test("téléphone : aucune page du portail ne déborde horizontalement et le menu reste accessible", async ({ page, request }) => {
  const email = uniqueEmail("mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpAndVerify(page, request, email);
  await completeOnboarding(page);
  await setRole(request, email, "ADMIN");

  for (const path of ["/admin", "/admin?range=90", "/admin/users", "/admin/billing", "/admin/ai", "/admin/audit", "/admin/privacy"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(scroll, `${path} déborde (${scroll} px pour ${inner} px)`).toBeLessThanOrEqual(inner);
  }
  // Menu mobile : présent, et la page courante est signalée.
  await page.goto("/admin/users");
  const nav = page.getByRole("navigation", { name: /Administration/ });
  await expect(nav.getByRole("link", { name: "Utilisateurs" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Journal d'audit" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Journal d'audit" })).toBeVisible();
});
