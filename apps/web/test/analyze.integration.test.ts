import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { FakeProvider, type LlmProvider, type ProviderRequest } from "@mon-agent-ia/ai";
import { createDb, withTenant, type Db } from "@mon-agent-ia/db";

const adminUrl = process.env["TEST_ADMIN_URL"];
const appUrl = process.env["TEST_APP_URL"];
if (process.env["CI"] && !(adminUrl && appUrl)) throw new Error("TEST_ADMIN_URL / TEST_APP_URL requis en CI");
const run = adminUrl && appUrl ? describe : describe.skip;

const NOW = new Date("2026-10-08T10:00:00Z");
const PEPPER = "p".repeat(40);

async function pdf(lines: string[]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  lines.forEach((l, i) => p.drawText(l, { x: 30, y: 800 - i * 16, size: 9, font: f }));
  return d.save();
}
const letter = (canary: string, org = "Nova") => [
  `Madame, Monsieur, chez la société ${org}, le tarif de votre abonnement internet passera de 29,99 €`,
  `à 35,99 € par mois à compter du 01/12/2026. Vous pouvez résilier sans frais avant le 15 novembre 2026.`,
  `Référence interne ${canary}. Votre IBAN FR76 3000 6000 0112 3456 7890 189 sera prélevé. Contact: marie.durand@example.fr`,
  `Nous restons à votre disposition pour toute question concernant cette modification tarifaire de votre forfait.`,
];
const eur = (l: string[]) => l;

class Failing implements LlmProvider {
  name = "failing";
  async complete(_: ProviderRequest): Promise<never> { throw new Error("panne"); }
}

run("analyse d'un document : persistance minimale, quotas, isolation", () => {
  let admin: Db;
  let app: Db;
  let analyzeUpload: typeof import("../src/server/analyze-service").analyzeUpload;
  const ai = { provider: new FakeProvider(), models: { mini: "m-mini", full: "m-full" }, pricing: { "m-mini": { inPerMTok: 1_000_000, outPerMTok: 2_000_000 } } };

  async function household(role: "OWNER" | "READ" = "OWNER", plan?: "FREE" | "SOLO") {
    const householdId = randomUUID();
    const userId = `u-${householdId}`;
    await admin.user.create({ data: { id: userId, name: "T", email: `${userId}@t.test` } });
    await admin.consent.createMany({ data: ["SENSITIVE_DATA_PROCESSING", "AI_PROCESSING"].map((type) => ({ userId, type: type as "AI_PROCESSING", granted: true, version: "test" })) });
    await admin.household.create({ data: { id: householdId, name: "T", wrappedDek: Buffer.from("x") } });
    await admin.membership.create({ data: { householdId, userId, role } });
    if (plan) await admin.billingSubscription.create({ data: { householdId, stripeCustomerId: `cus_${householdId}`, plan, status: "ACTIVE" } });
    return { userId, householdId, role } as const;
  }
  const analyze = (t: { userId: string; householdId: string; role: "OWNER" | "READ" }, bytes: Uint8Array, provider: LlmProvider = ai.provider) =>
    analyzeUpload({ db: app, ai: { ...ai, provider }, pepper: PEPPER, now: () => NOW }, t, { bytes });

  beforeAll(async () => {
    Object.assign(process.env, { NODE_ENV: "test", APP_ENV: "dev", DATABASE_URL: appUrl, AUTH_SECRET: "s".repeat(48), KEK_BASE64: randomBytes(32).toString("base64"), HASH_PEPPER: PEPPER });
    admin = createDb(adminUrl!);
    app = createDb(appUrl!);
    ({ analyzeUpload } = await import("../src/server/analyze-service"));
  });
  afterAll(async () => { await admin.$disconnect(); await app.$disconnect(); });

  it("extrait l'essentiel, enregistre l'enregistrement minimal et crée rappels et notification", async () => {
    const t = await household();
    const r = await analyze(t, await pdf(eur(letter("REF-1"))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.saved).toMatchObject({ deadlines: expect.any(Number), savings: 1, savingsAnnualCents: 7200 });
    const rows = await withTenant(app, t, async (tx) => ({
      doc: await tx.document.findFirstOrThrow(),
      dl: await tx.deadline.findMany({ orderBy: { dueDate: "asc" } }),
      rem: await tx.reminder.findMany(),
      act: await tx.recommendedAction.findMany(),
      sav: await tx.saving.findMany(),
      usage: await tx.usageCounter.findFirstOrThrow(),
      runs: await tx.aiRun.findMany(),
    }));
    expect(rows.doc).toMatchObject({ kind: "TELECOM", organization: "Nova", source: "WEB_UPLOAD" });
    expect(rows.dl.map((d) => d.dueDate.toISOString().slice(0, 10))).toEqual(expect.arrayContaining(["2026-11-15", "2026-12-01"]));
    expect(rows.rem.length).toBeGreaterThanOrEqual(8); // 2 échéances × (J-7, J-1) × (email, in-app)
    expect(rows.rem.every((x) => x.remindAt > NOW)).toBe(true);
    expect(rows.act.length).toBeGreaterThanOrEqual(2);
    expect(rows.sav[0]).toMatchObject({ kind: "PRICE_INCREASE", monthlyCents: 600, annualCents: 7200 });
    expect(rows.usage.documents).toBe(1);
    expect(rows.runs[0]).toMatchObject({ task: "ANALYZE", status: "OK" });
    expect(rows.usage.aiCostMicros).toBeGreaterThan(0n);
    const notif = await admin.notification.findFirst({ where: { userId: t.userId } });
    expect(notif?.title).toContain("72 €");
    expect(await admin.auditLog.count({ where: { householdId: t.householdId, action: "document.analyzed" } })).toBe(1);
  });

  it("RÉTENTION : aucun contenu du document n'est présent nulle part en base (test du canari)", async () => {
    const t = await household();
    const canary = `CANARI-${randomUUID()}`;
    const r = await analyze(t, await pdf(eur(letter(canary))));
    expect(r.ok).toBe(true);

    const cols = await admin.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY', 'bytea') AND table_name <> '_prisma_migrations'`;
    const needles = [canary, "FR76 3000", "marie.durand", "Nous restons à votre disposition"];
    for (const { table_name, column_name } of cols) {
      for (const n of needles) {
        const hit = await admin.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*)::bigint AS c FROM "${table_name}" WHERE encode(convert_to("${column_name}"::text, 'UTF8'), 'escape') ILIKE $1`, `%${n}%`);
        expect(Number(hit[0]!.c), `${table_name}.${column_name} contient « ${n} »`).toBe(0);
      }
    }
    // L'affichage (résumé) existe côté réponse seulement, et masque les identifiants.
    if (r.ok) {
      expect(r.outcome.display.summary.length).toBeGreaterThan(0);
      expect(JSON.stringify(r.outcome.display)).not.toMatch(/FR76|marie\.durand/);
    }
  });

  it("un fichier invalide ne consomme pas le quota", async () => {
    const t = await household();
    const bad = await analyze(t, new TextEncoder().encode("ceci n'est pas un document"));
    expect(bad).toMatchObject({ ok: false, error: { code: "UNSUPPORTED" } });
    expect(await admin.usageCounter.count({ where: { householdId: t.householdId } })).toBe(0);
  });

  it("quota du plan gratuit : 5 documents, le 6e est refusé", async () => {
    const t = await household();
    const file = await pdf(eur(letter("Q")));
    for (let i = 0; i < 5; i++) expect((await analyze(t, file)).ok).toBe(true);
    expect(await analyze(t, file)).toMatchObject({ ok: false, error: { code: "QUOTA" } });
  });

  it("le quota résiste à la concurrence : jamais plus que la limite", async () => {
    const t = await household();
    const file = await pdf(eur(letter("C")));
    const results = await Promise.all(Array.from({ length: 9 }, () => analyze(t, file)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.error.code === "QUOTA")).toHaveLength(4);
    expect((await admin.usageCounter.findFirstOrThrow({ where: { householdId: t.householdId } })).documents).toBe(5);
  });

  it("panne du fournisseur : quota rendu, échec tracé, aucun enregistrement", async () => {
    const t = await household();
    const r = await analyze(t, await pdf(eur(letter("F"))), new Failing());
    expect(r).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR" } });
    expect((await admin.usageCounter.findFirstOrThrow({ where: { householdId: t.householdId } })).documents).toBe(0);
    expect(await admin.document.count({ where: { householdId: t.householdId } })).toBe(0);
    expect((await admin.aiRun.findFirstOrThrow({ where: { householdId: t.householdId } })).status).toBe("ERROR");
  });

  it("sans consentement actif (ou après retrait), aucune analyse n'est possible", async () => {
    const t = await household();
    await admin.consent.create({ data: { userId: t.userId, type: "AI_PROCESSING", granted: false, version: "test" } }); // retrait : dernière décision
    expect(await analyze(t, await pdf(eur(letter("K"))))).toMatchObject({ ok: false, error: { code: "CONSENT" } });
    expect(await admin.usageCounter.count({ where: { householdId: t.householdId } })).toBe(0); // rien consommé
    await admin.consent.create({ data: { userId: t.userId, type: "AI_PROCESSING", granted: true, version: "test2", createdAt: new Date(Date.now() + 1000) } });
    expect((await analyze(t, await pdf(eur(letter("K"))))).ok).toBe(true); // ré-accordé : redevient possible
  });

  it("un lecteur ne peut pas analyser de documents", async () => {
    const t = await household("READ");
    expect(await analyze(t, await pdf(eur(letter("R"))))).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("analyser deux fois le même document ne crée ni échéances ni actions en double", async () => {
    const t = await household("OWNER", "SOLO");
    const file = await pdf(eur(letter("D")));
    await analyze(t, file);
    const first = await withTenant(app, t, async (tx) => ({ d: await tx.deadline.count(), a: await tx.recommendedAction.count() }));
    await analyze(t, file);
    const second = await withTenant(app, t, async (tx) => ({ d: await tx.deadline.count(), a: await tx.recommendedAction.count(), docs: await tx.document.count() }));
    expect(second.d).toBe(first.d);
    expect(second.a).toBe(first.a);
    expect(second.docs).toBe(2); // deux analyses = deux enregistrements, mais rien de dupliqué dans l'agenda
  });

  it("isolation : un autre foyer ne voit rien de ces enregistrements", async () => {
    const a = await household("OWNER", "SOLO");
    const b = await household("OWNER", "SOLO");
    await analyze(a, await pdf(eur(letter("I"))));
    const seen = await withTenant(app, b, async (tx) => ({ d: await tx.document.count(), dl: await tx.deadline.count(), s: await tx.saving.count(), r: await tx.reminder.count() }));
    expect(seen).toEqual({ d: 0, dl: 0, s: 0, r: 0 });
  });
});
