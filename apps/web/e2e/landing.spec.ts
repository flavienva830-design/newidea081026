import { expect, test } from "./helpers";

test("la landing s'affiche, sans erreur console, et mène à l'inscription", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("administratif");
  await expect(page.getByRole("link", { name: /Commencer/ }).first()).toBeVisible();
  await page.getByRole("link", { name: /Commencer gratuitement/ }).click();
  await expect(page).toHaveURL(/\/signup/);
  expect(errors).toEqual([]);
});

test("pas de défilement horizontal", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("les tarifs basculent en annuel", async ({ page }) => {
  await page.goto("/#tarifs");
  await expect(page.getByText("9,90").first()).toBeVisible();
  await page.getByRole("button", { name: /Annuel/ }).click();
  await expect(page.getByText("99 €").first()).toBeVisible();
});

test("les pages légales existent", async ({ request }) => {
  for (const p of ["/mentions-legales", "/confidentialite", "/cgv"]) expect((await request.get(p)).status()).toBe(200);
});

test("en-têtes de sécurité présents", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-powered-by"]).toBeUndefined();
});
