import { describe, expect, it } from "vitest";
import { PersistableAnalysis, RETENTION, containsSensitiveIdentifier, scrub } from "../src/retention.ts";

const ok = {
  kind: "TELECOM" as const,
  title: "Facture internet",
  organization: "Opérateur X",
  amountCents: 3599,
  documentDate: new Date("2026-10-01"),
  urgencyScore: 40,
  tags: ["internet"],
  deadlines: [{ kind: "CANCELLATION_NOTICE" as const, title: "Résilier avant hausse", dueDate: new Date("2026-11-15"), amountCents: null, confidence: 0.9 }],
  savings: [{ kind: "PRICE_INCREASE" as const, title: "Hausse de 6 €/mois", rationale: "Passage de 29,99 € à 35,99 €", monthlyCents: 600, annualCents: 7200, confidence: 0.92 }],
  actions: [{ type: "CONTEST" as const, title: "Demander un geste commercial", rationale: "Hausse non annoncée", priority: 70 }],
};

describe("rétention minimale", () => {
  it("la politique interdit fichiers, texte et courriers", () => {
    expect(RETENTION).toMatchObject({ files: "never", fullText: "never", generatedLetters: "never" });
  });

  it("accepte un enregistrement structuré court", () => {
    expect(PersistableAnalysis.safeParse(ok).success).toBe(true);
  });

  it("refuse toute clé de contenu (texte, résumé, nom de fichier…)", () => {
    for (const extra of [{ text: "contenu" }, { summary: "résumé" }, { filename: "facture.pdf" }, { content: "x" }]) {
      expect(PersistableAnalysis.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
  });

  it("refuse un extrait de document : texte trop long ou multiligne", () => {
    expect(PersistableAnalysis.safeParse({ ...ok, title: "x".repeat(121) }).success).toBe(false);
    expect(PersistableAnalysis.safeParse({ ...ok, title: "ligne 1\nligne 2" }).success).toBe(false);
    const long = { ...ok, savings: [{ ...ok.savings[0]!, rationale: "mot ".repeat(100) }] };
    expect(PersistableAnalysis.safeParse(long).success).toBe(false);
  });

  it("refuse les identifiants sensibles (IBAN, carte, NIR, email, téléphone)", () => {
    for (const v of ["FR76 3000 6000 0112 3456 7890 189", "4970 1012 3456 7890", "1 85 05 78 006 084 36", "marie@exemple.fr", "06 12 34 56 78", "+33 6 12 34 56 78"]) {
      expect(containsSensitiveIdentifier(v)).toBe(true);
      expect(PersistableAnalysis.safeParse({ ...ok, organization: v }).success).toBe(false);
    }
    expect(containsSensitiveIdentifier("Facture du 15/10/2026 de 35,99 €")).toBe(false);
  });

  it("borne les montants et les listes", () => {
    expect(PersistableAnalysis.safeParse({ ...ok, amountCents: -1 }).success).toBe(false);
    expect(PersistableAnalysis.safeParse({ ...ok, urgencyScore: 101 }).success).toBe(false);
    expect(PersistableAnalysis.safeParse({ ...ok, tags: Array(9).fill("t") }).success).toBe(false);
  });
});

describe("scrub (journaux et supervision)", () => {
  it("masque les clés de contenu et les longues chaînes", () => {
    const out = scrub({ userId: "u1", text: "Madame, Monsieur…", note: "a".repeat(200), nested: { password: "x", n: 3 } }) as Record<string, unknown>;
    expect(out["userId"]).toBe("u1");
    expect(out["text"]).toBe("[masqué]");
    expect(out["note"]).toBe("[texte:200]");
    expect(out["nested"]).toEqual({ password: "[masqué]", n: 3 });
  });
  it("n'expose jamais le message d'une erreur", () => {
    expect(scrub(new Error("IBAN FR76 3000… invalide"))).toEqual({ name: "Error" });
  });
  it("masque les identifiants dans les chaînes courtes et borne la profondeur", () => {
    expect(scrub("jean@exemple.fr")).toBe("[identifiant]");
    let deep: unknown = "x";
    for (let i = 0; i < 10; i++) deep = { a: deep };
    expect(JSON.stringify(scrub(deep))).toContain("[profondeur]");
  });
});
