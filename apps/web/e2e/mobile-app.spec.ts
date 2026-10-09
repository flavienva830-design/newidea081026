import { PDFDocument, StandardFonts } from "pdf-lib";
import { completeOnboarding, expect, signUpAndVerify, test, uniqueEmail } from "./helpers";

async function letterPdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  [
    "Madame, Monsieur, chez la société Nova, le tarif de votre abonnement internet passera de 29,99 €",
    "à 35,99 € par mois à compter du 01/12/2026. Vous pouvez résilier sans frais avant le 15 novembre 2026",
    "par courrier recommandé. Nous restons à votre disposition pour toute question concernant cette modification tarifaire.",
  ].forEach((l, i) => p.drawText(l, { x: 30, y: 800 - i * 16, size: 9, font: f }));
  return Buffer.from(await d.save());
}

test("téléphone : aucune page de l'application ne déborde horizontalement, avec des données réelles à l'écran", async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("ovf");
  await signUpAndVerify(page, request, email);
  await completeOnboarding(page);
  await request.post("/api/dev/plan", { data: { email, plan: "FAMILLE" } });
  await page.goto("/app/analyze");
  await page.locator('input[type="file"]').setInputFiles({ name: "courrier-nova.pdf", mimeType: "application/pdf", buffer: await letterPdf() });
  await page.getByText("Terminé").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/app", "/app/analyze", "/app/documents", "/app/deadlines", "/app/actions", "/app/savings", "/app/letters", "/app/family", "/app/settings/security", "/app/settings/billing", "/app/settings/data"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const r = await page.evaluate(() => {
      const w = window.innerWidth;
      // Éléments qui dépassent à droite : indiqués dans le message d'échec pour trouver le coupable sans relancer.
      const offenders = [...document.querySelectorAll("body *")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((x) => x.r.right > w + 1 && x.r.width > 0)
        .sort((a, b) => b.r.right - a.r.right)
        .slice(0, 3)
        .map((x) => `${x.el.tagName.toLowerCase()}.${String((x.el as HTMLElement).className).slice(0, 60)} (${Math.round(x.r.right)} px)`);
      return { scroll: document.documentElement.scrollWidth, w, offenders };
    });
    expect(r.scroll, `${path} déborde : ${r.offenders.join(" ; ")}`).toBeLessThanOrEqual(r.w);
  }
});
