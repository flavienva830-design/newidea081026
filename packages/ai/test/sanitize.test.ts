import { describe, expect, it } from "vitest";
import { PersistableAnalysis } from "@mon-agent-ia/core";
import { toPersistable } from "../src/sanitize.ts";
import type { ModelAnalysis } from "../src/schemas.ts";

const now = new Date("2026-10-08T10:00:00Z");
const base = (over: Partial<ModelAnalysis> = {}): ModelAnalysis => ({
  kind: "TELECOM", title: "Facture internet", organization: "Opérateur Nova", amountCents: 3599, documentDate: "2026-10-01", urgencyScore: 50, confidence: 0.9,
  summary: "Résumé.", keyPoints: ["Point"], risks: [], tags: ["Internet"], deadlines: [], savings: [], actions: [], ...over,
});

describe("nettoyage de la sortie du modèle", () => {
  it("produit un enregistrement valide pour un cas normal", () => {
    const r = toPersistable(base({
      deadlines: [{ kind: "PAYMENT", title: "Payer", dueDate: "2026-11-15", amountCents: 3599, confidence: 0.8 }],
      savings: [{ kind: "PRICE_INCREASE", title: "Hausse", rationale: "Hausse annoncée", monthlyCents: 600, annualCents: 7200, confidence: 0.9 }],
      actions: [{ type: "CONTEST", title: "Demander un geste", rationale: "Hausse annoncée", priority: 70 }],
    }), now);
    expect(PersistableAnalysis.safeParse(r.persistable).success).toBe(true);
    expect(r.persistable.deadlines[0]!.dueDate.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(r.persistable.tags).toEqual(["internet"]);
    expect(r.dropped).toBe(0);
  });

  it("écarte les champs porteurs d'identifiants sensibles sans perdre le reste", () => {
    const r = toPersistable(base({
      organization: "Contact : service@nova.fr",
      title: "Prélèvement FR76 3000 6000 0112 3456 7890 189",
      deadlines: [{ kind: "PAYMENT", title: "Appeler le 06 12 34 56 78", dueDate: "2026-11-15", amountCents: null, confidence: 1 },
                  { kind: "PAYMENT", title: "Payer", dueDate: "2026-11-20", amountCents: null, confidence: 1 }],
    }), now);
    expect(r.persistable.organization).toBeNull();
    expect(r.persistable.title).toBe("Document");
    expect(r.persistable.deadlines.map((d) => d.title)).toEqual(["Payer"]);
    expect(r.dropped).toBe(1);
  });

  it("écarte les dates invalides, lointaines ou en doublon", () => {
    const d = (dueDate: string, kind: "PAYMENT" | "RENEWAL" = "PAYMENT") => ({ kind, title: "t", dueDate, amountCents: null, confidence: 1 });
    const r = toPersistable(base({ deadlines: [d("2026-02-30"), d("pas une date"), d("2020-01-01"), d("2099-01-01"), d("2026-11-01"), d("2026-11-01"), d("2026-11-01", "RENEWAL"), d("2026-10-01")] }), now);
    expect(r.persistable.deadlines.map((x) => `${x.kind}:${x.dueDate.toISOString().slice(0, 10)}`)).toEqual(["PAYMENT:2026-11-01", "RENEWAL:2026-11-01", "PAYMENT:2026-10-01"]);
  });

  it("borne les nombres et recalcule l'économie annuelle manquante", () => {
    const r = toPersistable(base({
      amountCents: 9e15, urgencyScore: 500, confidence: 3,
      savings: [{ kind: "FEE", title: "Frais", rationale: "Frais bancaires", monthlyCents: 500, annualCents: 0, confidence: 7 },
                { kind: "FEE", title: "Rien", rationale: "Aucun gain", monthlyCents: 0, annualCents: 0, confidence: 0.5 }],
    }), now);
    expect(r.persistable.amountCents).toBe(1e9);
    expect(r.persistable.urgencyScore).toBe(100);
    expect(r.confidence).toBe(1);
    expect(r.persistable.savings).toHaveLength(1);
    expect(r.persistable.savings[0]).toMatchObject({ annualCents: 6000, confidence: 1 });
  });

  it("aplatit les textes multilignes et plafonne les longueurs", () => {
    const r = toPersistable(base({ title: "Ligne 1\nLigne 2\t\u0000fin", organization: "x".repeat(500), tags: ["a".repeat(100), "A", "a"] }), now);
    expect(r.persistable.title).toBe("Ligne 1 Ligne 2 fin");
    expect(r.persistable.organization!.length).toBeLessThanOrEqual(120);
    expect(r.persistable.tags).toEqual(["a".repeat(29) + "…", "a"]);
  });

  it("le résumé affiché masque les identifiants et n'est jamais dans l'enregistrement", () => {
    const r = toPersistable(base({ summary: "Prélèvement sur FR76 3000 6000 0112 3456 7890 189, contact marie@x.fr" }), now);
    expect(r.display.summary).not.toMatch(/FR76|marie@/);
    expect(r.display.summary).toContain("[masqué]");
    expect(JSON.stringify(r.persistable)).not.toContain("Prélèvement");
  });

  it("robustesse : jamais d'exception ni d'enregistrement invalide sur des sorties hostiles", () => {
    const evil = ["", " ", "\n\n", "x".repeat(10_000), "FR76 3000 6000 0112 3456 7890 189", "<script>", "'; DROP TABLE users;--", "0".repeat(40), "é".repeat(300)];
    for (const a of evil) for (const b of evil) {
      const r = toPersistable(base({
        title: a, organization: b, tags: [a, b], summary: a,
        deadlines: [{ kind: "OTHER", title: a, dueDate: "2026-12-01", amountCents: -5, confidence: NaN }],
        savings: [{ kind: "OTHER", title: a, rationale: b, monthlyCents: 5, annualCents: 60, confidence: -1 }],
        actions: [{ type: "OTHER", title: b, rationale: a, priority: Infinity }],
      }), now);
      expect(PersistableAnalysis.safeParse(r.persistable).success).toBe(true);
    }
  });
});
