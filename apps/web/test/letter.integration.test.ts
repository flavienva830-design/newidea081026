import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { FakeProvider, type LlmProvider, type ProviderRequest } from "@mon-agent-ia/ai";
import { createDb, withTenant, type Db } from "@mon-agent-ia/db";

const adminUrl = process.env["TEST_ADMIN_URL"];
const appUrl = process.env["TEST_APP_URL"];
if (process.env["CI"] && !(adminUrl && appUrl)) throw new Error("TEST_ADMIN_URL / TEST_APP_URL requis en CI");
const run = adminUrl && appUrl ? describe : describe.skip;

const NOW = new Date("2026-10-08T10:00:00Z");
const PEPPER = "p".repeat(40);
const sender = { fullName: "Camille Martin", address: "12 rue des Lilas\n75011 Paris", city: "Paris", reference: "CONTRAT-7788" };

class Spy extends FakeProvider {
  calls: ProviderRequest[] = [];
  override async complete(req: ProviderRequest) { this.calls.push(req); return super.complete(req); }
}
class Failing implements LlmProvider { name = "failing"; async complete(): Promise<never> { throw new Error("panne"); } }

run("rédaction de courriers sans conservation", () => {
  let admin: Db;
  let app: Db;
  let generateLetter: typeof import("../src/server/letter-service").generateLetter;
  const base = { models: { mini: "m-mini", full: "m-full" }, pricing: { "m-full": { inPerMTok: 1_000_000, outPerMTok: 1_000_000 } } };

  async function household(role: "OWNER" | "READ" = "OWNER", plan: "FREE" | "SOLO" = "SOLO") {
    const householdId = randomUUID();
    const userId = `u-${householdId}`;
    await admin.user.create({ data: { id: userId, name: "T", email: `${userId}@t.test` } });
    await admin.household.create({ data: { id: householdId, name: "T", wrappedDek: Buffer.from("x") } });
    await admin.membership.create({ data: { householdId, userId, role } });
    await admin.billingSubscription.create({ data: { householdId, stripeCustomerId: `cus_${householdId}`, plan, status: "ACTIVE" } });
    return { userId, householdId, role } as const;
  }
  const gen = (t: { userId: string; householdId: string; role: "OWNER" | "READ" }, req: unknown, provider: LlmProvider = new FakeProvider()) =>
    generateLetter({ db: app, ai: { ...base, provider }, pepper: PEPPER, now: () => NOW }, t, req);

  beforeAll(async () => {
    Object.assign(process.env, { NODE_ENV: "test", APP_ENV: "dev", DATABASE_URL: appUrl, AUTH_SECRET: "s".repeat(48), KEK_BASE64: randomBytes(32).toString("base64"), HASH_PEPPER: PEPPER });
    admin = createDb(adminUrl!);
    app = createDb(appUrl!);
    ({ generateLetter } = await import("../src/server/letter-service"));
  });
  afterAll(async () => { await admin.$disconnect(); await app.$disconnect(); });

  it("rédige un courrier depuis une action : données personnelles insérées après le modèle", async () => {
    const t = await household();
    const doc = await admin.document.create({ data: { householdId: t.householdId, source: "WEB_UPLOAD", title: "Courrier opérateur", organization: "Nova", amountCents: 3599, kind: "TELECOM" } });
    const action = await admin.recommendedAction.create({ data: { householdId: t.householdId, documentId: doc.id, type: "CANCEL_CONTRACT", title: "Résilier avant la hausse", rationale: "Hausse annoncée", dedupeKey: "k1" } });
    const spy = new Spy();
    const r = await gen(t, { kind: "CANCELLATION", actionId: action.id, sender }, spy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("Camille Martin");
    expect(r.text).toContain("12 rue des Lilas");
    expect(r.text).toContain("CONTRAT-7788");
    expect(r.text).toContain("À l'attention de Nova");
    expect(r.text).toContain("Paris, le 8 octobre 2026");
    expect(r.text).not.toMatch(/\[\[/);
    // Le modèle n'a JAMAIS reçu l'identité de l'utilisateur.
    const sent = JSON.stringify(spy.calls);
    for (const secret of ["Camille", "Martin", "Lilas", "CONTRAT-7788", t.userId]) expect(sent).not.toContain(secret);
    expect(sent).toContain("Nova");
    expect(r.disclaimer).toContain("pas un conseil juridique");
  });

  it("aucune trace du courrier en base : seulement un compteur et la trace technique de l'appel", async () => {
    const t = await household();
    const r = await gen(t, { kind: "FREE", organization: "Mutuelle Santé", topic: "Question sur un remboursement", note: "Ma référence interne ZEBRA-42", sender });
    expect(r.ok).toBe(true);
    const cols = await admin.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'ARRAY') AND table_name <> '_prisma_migrations'`;
    for (const { table_name, column_name } of cols) {
      for (const needle of ["Camille Martin", "rue des Lilas", "CONTRAT-7788", "ZEBRA-42", "Madame, Monsieur"]) {
        const hit = await admin.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*)::bigint AS c FROM "${table_name}" WHERE "${column_name}"::text ILIKE $1`, `%${needle}%`);
        expect(Number(hit[0]!.c), `${table_name}.${column_name} contient « ${needle} »`).toBe(0);
      }
    }
    const usage = await admin.usageCounter.findFirstOrThrow({ where: { householdId: t.householdId } });
    expect(usage.lettersGenerated).toBe(1);
    expect(usage.aiCostMicros).toBeGreaterThan(0n);
    const runRow = await admin.aiRun.findFirstOrThrow({ where: { householdId: t.householdId } });
    expect(runRow).toMatchObject({ task: "LETTER", status: "OK" });
  });

  it("le plan gratuit n'inclut pas les courriers", async () => {
    const t = await household("OWNER", "FREE");
    expect(await gen(t, { kind: "FREE", organization: "X", topic: "Y", sender })).toMatchObject({ ok: false, error: { code: "UPGRADE" } });
  });

  it("un lecteur ne peut pas rédiger de courrier", async () => {
    const t = await household("READ");
    expect(await gen(t, { kind: "FREE", organization: "X", topic: "Y", sender })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("une action d'un autre foyer est introuvable (IDOR)", async () => {
    const a = await household();
    const b = await household();
    const doc = await admin.document.create({ data: { householdId: b.householdId, source: "WEB_UPLOAD", title: "Secret", organization: "Org B" } });
    const act = await admin.recommendedAction.create({ data: { householdId: b.householdId, documentId: doc.id, type: "CONTEST", title: "Contester", rationale: "r", dedupeKey: "k2" } });
    expect(await gen(a, { kind: "CONTESTATION", actionId: act.id, sender })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("valide les entrées (expéditeur, longueurs, type, objet manquant)", async () => {
    const t = await household();
    expect(await gen(t, { kind: "NOPE", organization: "X", topic: "Y", sender })).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(await gen(t, { kind: "FREE", organization: "X", topic: "Y", sender: { ...sender, fullName: "" } })).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(await gen(t, { kind: "FREE", organization: "X", topic: "Y", note: "x".repeat(801), sender })).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(await gen(t, { kind: "FREE", organization: "X", sender })).toMatchObject({ ok: false, error: { code: "INVALID" } });
  });

  it("quota mensuel atomique : jamais plus que la limite, même en parallèle", async () => {
    const t = await household();
    const results = await Promise.all(Array.from({ length: 70 }, () => gen(t, { kind: "FREE", organization: "X", topic: "Y", sender })));
    expect(results.filter((r) => r.ok)).toHaveLength(60);
    expect(results.filter((r) => !r.ok && r.error.code === "QUOTA")).toHaveLength(10);
  });

  it("panne du fournisseur : compteur rendu, erreur générique", async () => {
    const t = await household();
    const r = await gen(t, { kind: "FREE", organization: "X", topic: "Y", sender }, new Failing());
    expect(r).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR" } });
    const usage = await admin.usageCounter.findFirstOrThrow({ where: { householdId: t.householdId } });
    expect(usage.lettersGenerated).toBe(0);
  });

  it("mise en demeure : avertissement renforcé", async () => {
    const t = await household();
    const r = await gen(t, { kind: "FORMAL_NOTICE", organization: "X", topic: "Y", sender });
    expect(r.ok && r.disclaimer).toContain("recommandé");
  });
});
