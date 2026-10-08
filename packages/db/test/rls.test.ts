import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withTenant, withUser, type Db } from "../src/index.ts";

// Nécessite : DATABASE_ADMIN_URL (propriétaire) et DATABASE_APP_URL (rôle mai_app).
const adminUrl = process.env["TEST_ADMIN_URL"];
const appUrl = process.env["TEST_APP_URL"];
// En CI, l'absence de base est une erreur : les tests de sécurité ne doivent jamais être sautés en silence.
if (process.env["CI"] && !(adminUrl && appUrl)) throw new Error("TEST_ADMIN_URL / TEST_APP_URL requis en CI");
const run = adminUrl && appUrl ? describe : describe.skip;

run("isolation par foyer (RLS)", () => {
  let admin: Db;
  let app: Db;
  const A = "00000000-0000-7000-8000-00000000000a";
  const B = "00000000-0000-7000-8000-00000000000b";

  beforeAll(async () => {
    admin = createDb(adminUrl!);
    app = createDb(appUrl!);
    await admin.document.deleteMany();
    await admin.household.deleteMany({ where: { id: { in: [A, B] } } });
    await admin.user.deleteMany({ where: { id: { in: ["u-a", "u-b"] } } });
    await admin.user.createMany({
      data: [
        { id: "u-a", name: "A", email: "a@test.fr" },
        { id: "u-b", name: "B", email: "b@test.fr" },
      ],
    });
    await admin.household.createMany({
      data: [
        { id: A, name: "Foyer A", wrappedDek: Buffer.from("x") },
        { id: B, name: "Foyer B", wrappedDek: Buffer.from("x") },
      ],
    });
    await admin.membership.createMany({
      data: [
        { householdId: A, userId: "u-a", role: "OWNER" },
        { householdId: B, userId: "u-b", role: "OWNER" },
      ],
    });
    await admin.document.createMany({
      data: [
        { householdId: A, source: "WEB_UPLOAD", title: "Doc A" },
        { householdId: B, source: "WEB_UPLOAD", title: "Doc B" },
      ],
    });
  });

  afterAll(async () => {
    await admin.$disconnect();
    await app.$disconnect();
  });

  it("sans contexte, aucune ligne métier n'est visible", async () => {
    expect(await app.document.count()).toBe(0);
    expect(await app.household.count()).toBe(0);
  });

  it("un foyer ne voit que ses documents", async () => {
    const docs = await withTenant(app, { userId: "u-a", householdId: A }, (tx) => tx.document.findMany());
    expect(docs.map((d) => d.title)).toEqual(["Doc A"]);
  });

  it("IDOR : lire le document d'un autre foyer par son id échoue", async () => {
    const docB = await admin.document.findFirstOrThrow({ where: { householdId: B } });
    const r = await withTenant(app, { userId: "u-a", householdId: A }, (tx) => tx.document.findUnique({ where: { id: docB.id } }));
    expect(r).toBeNull();
  });

  it("IDOR : modifier/supprimer le document d'un autre foyer n'affecte rien", async () => {
    const docB = await admin.document.findFirstOrThrow({ where: { householdId: B } });
    const upd = await withTenant(app, { userId: "u-a", householdId: A }, (tx) =>
      tx.document.updateMany({ where: { id: docB.id }, data: { title: "piraté" } }));
    const del = await withTenant(app, { userId: "u-a", householdId: A }, (tx) => tx.document.deleteMany({ where: { id: docB.id } }));
    expect(upd.count).toBe(0);
    expect(del.count).toBe(0);
    expect((await admin.document.findUniqueOrThrow({ where: { id: docB.id } })).title).toBe("Doc B");
  });

  it("insertion dans un autre foyer refusée (WITH CHECK)", async () => {
    await expect(
      withTenant(app, { userId: "u-a", householdId: A }, (tx) =>
        tx.document.create({ data: { householdId: B, source: "WEB_UPLOAD", title: "intrus" } })),
    ).rejects.toThrow();
  });

  it("le contexte ne fuit pas entre transactions", async () => {
    await withTenant(app, { userId: "u-a", householdId: A }, (tx) => tx.document.findMany());
    expect(await app.document.count()).toBe(0);
  });

  it("withUser liste uniquement les foyers de l'utilisateur", async () => {
    const m = await withUser(app, "u-a", (tx) => tx.membership.findMany());
    expect(m.map((x) => x.householdId)).toEqual([A]);
    const h = await withUser(app, "u-a", (tx) => tx.household.findMany());
    expect(h.map((x) => x.id)).toEqual([A]);
  });

  it("householdId non-UUID rejeté (pas d'injection dans le contexte)", async () => {
    await expect(withTenant(app, { userId: "u-a", householdId: "x' OR '1'='1" }, async () => 1)).rejects.toThrow();
  });

  it("journal d'audit : ajout seul, même pour le propriétaire", async () => {
    const row = await admin.auditLog.create({ data: { action: "test" } });
    await expect(admin.auditLog.update({ where: { id: row.id }, data: { action: "x" } })).rejects.toThrow();
    await expect(admin.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(app.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it("rétention minimale : aucune table ni colonne ne peut stocker un fichier, un texte ou un courrier", async () => {
    const tables = await admin.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = tables.map((t) => t.table_name);
    for (const forbidden of ["document_versions", "document_texts", "extractions", "letters"]) expect(names).not.toContain(forbidden);
    const cols = await admin.$queryRaw<{ column_name: string }[]>`SELECT DISTINCT column_name FROM information_schema.columns WHERE table_schema = 'public'`;
    const columns = cols.map((c) => c.column_name.toLowerCase());
    for (const f of ["storagekey", "textenc", "bodyenc", "recipientenc", "pdfkey", "dataenc", "summary", "sha256", "originalname", "mimetype", "archivekey"]) {
      // archiveKey (export RGPD) est la seule clé de fichier tolérée : archive éphémère générée à la demande.
      if (f === "archivekey") continue;
      expect(columns).not.toContain(f);
    }
  });

  it("les champs texte sont plafonnés : impossible d'y stocker un extrait de document", async () => {
    await expect(admin.document.create({ data: { householdId: A, source: "WEB_UPLOAD", title: "x".repeat(500) } })).rejects.toThrow();
    await expect(
      admin.saving.create({ data: { householdId: A, kind: "FEE", title: "t", rationale: "y".repeat(2000), monthlyCents: 1, annualCents: 12, confidence: 0.5 } }),
    ).rejects.toThrow();
  });
});
