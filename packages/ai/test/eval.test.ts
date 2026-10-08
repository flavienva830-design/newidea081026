import { describe, expect, it } from "vitest";
import { containsSensitiveIdentifier } from "@mon-agent-ia/core";
import { CASES, NOW } from "../eval/cases.ts";
import { formatReport, runEval } from "../eval/run.ts";
import { scoreCase } from "../eval/score.ts";
import type { EvalCase } from "../eval/types.ts";
import type { AnalysisOutcome } from "../src/analyze.ts";
import { FakeProvider } from "../src/fake.ts";
import type { ModelAnalysis } from "../src/schemas.ts";
import type { LlmProvider, ProviderRequest, ProviderResponse } from "../src/types.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (s: string) => ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Fournisseur « oracle » : fabrique, pour chaque document, l'analyse PARFAITE déduite des attentes du cas.
 * Si le banc est cohérent, il doit lui donner 100 %. C'est ce qui permet de se fier aux notes obtenues avec un vrai modèle.
 */
function oracle(cases: EvalCase[]): LlmProvider {
  return {
    name: "oracle",
    async complete(req: ProviderRequest): Promise<ProviderResponse> {
      const text = req.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      const c = cases.find((x) => text.includes(x.text))!;
      const e = c.expect;
      const first = <T,>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);
      const savings = e.savings && e.savings !== "none" ? e.savings : [];
      const out: ModelAnalysis = {
        kind: first(e.kind) ?? "OTHER",
        title: "Document de test",
        organization: e.organization ?? null,
        amountCents: first(e.amountCents) ?? null,
        documentDate: null,
        urgencyScore: e.urgency ? Math.round((e.urgency[0] + e.urgency[1]) / 2) : 40,
        confidence: 0.9,
        summary: "Résumé de test.",
        keyPoints: ["Point un", "Point deux"],
        risks: e.injection ? [{ label: "Le document contient des instructions suspectes", severity: "high" }] : [],
        tags: ["test"],
        deadlines: (e.deadlines ?? []).map((d) => ({ kind: d.kind ?? "PAYMENT", title: "Échéance", dueDate: d.dueDate, amountCents: null, confidence: 0.9 })),
        savings: savings.map((s) => ({ kind: s.kind, title: "Économie", rationale: "Preuve dans le document", monthlyCents: s.monthlyCents ?? 100, annualCents: (s.monthlyCents ?? 100) * 12, confidence: 0.9 })),
        actions: e.actionsAnyOf ? [{ type: e.actionsAnyOf[0]!, title: "Action", rationale: "À faire", priority: 50 }] : [],
      };
      return { json: out, inputTokens: 1000, outputTokens: 300, model: req.model, latencyMs: 10 };
    },
  };
}

const blank = (over: Partial<AnalysisOutcome["persistable"]> = {}, risks: AnalysisOutcome["display"]["risks"] = [], summary = ""): AnalysisOutcome => ({
  persistable: { kind: "OTHER", title: "t", organization: null, amountCents: null, documentDate: null, urgencyScore: 10, tags: [], deadlines: [], savings: [], actions: [], ...over },
  display: { summary, keyPoints: [], risks },
  confidence: 0.9, dropped: 0, runs: [], escalated: false, model: "m",
});

describe("banc d'essai de l'analyse : jeu de documents", () => {
  it("est assez large, sans doublon, et chaque cas attend quelque chose", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) {
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(0);
      expect(c.text.length, c.id).toBeGreaterThan(80);
      expect(c.text.length, c.id).toBeLessThan(3000);
    }
  });

  it("toutes les dates attendues sont des dates ISO valides, dans la fenêtre acceptée par le nettoyage", () => {
    const lo = new Date(`${NOW}T00:00:00Z`).getTime() - 30 * 86_400_000;
    const hi = new Date(`${NOW}T00:00:00Z`).getTime() + 5 * 365 * 86_400_000;
    for (const c of CASES) {
      for (const d of [...(c.expect.deadlines ?? []).map((x) => x.dueDate), ...(c.expect.deadlinesAllowed ?? [])]) {
        expect(validIso(d), `${c.id} : ${d}`).toBe(true);
        const t = new Date(`${d}T00:00:00Z`).getTime();
        expect(t >= lo && t <= hi, `${c.id} : ${d} hors fenêtre`).toBe(true);
      }
    }
  });

  it("couvre les types de documents et les pièges (injections, hausse annoncée sans hausse, document sans enjeu)", () => {
    const kinds = new Set(CASES.flatMap((c) => (c.expect.kind === undefined ? [] : Array.isArray(c.expect.kind) ? c.expect.kind : [c.expect.kind])));
    for (const k of ["UTILITY", "INVOICE", "INSURANCE", "HEALTH", "TAX", "OFFICIAL_LETTER", "BANK_STATEMENT", "PAYSLIP", "TELECOM", "CONTRACT", "OTHER"]) expect(kinds.has(k as never), k).toBe(true);
    expect(CASES.filter((c) => c.expect.injection).length).toBeGreaterThanOrEqual(3);
    expect(CASES.some((c) => c.id === "tarifs-inchanges" && c.expect.savings === "none")).toBe(true);
    expect(CASES.some((c) => c.expect.deadlines?.length === 0)).toBe(true);
  });

  it("aucun document ne contient d'identifiant sensible, sauf ceux qui servent à vérifier qu'il n'est PAS recopié", () => {
    for (const c of CASES) {
      if (containsSensitiveIdentifier(c.text)) expect(c.expect.forbidden?.length, `${c.id} contient un identifiant sans le déclarer interdit`).toBeGreaterThan(0);
      for (const f of c.expect.forbidden ?? []) expect(f.trim().length, c.id).toBeGreaterThan(2);
    }
  });
});

describe("banc d'essai : notation", () => {
  const facture = CASES.find((c) => c.id === "facture-electricite")!;

  it("une analyse parfaite obtient 100 % sur chacun des documents", async () => {
    const rep = await runEval({ provider: oracle(CASES), cases: CASES, concurrency: 4 });
    const failed = rep.results.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => `${r.id} : ${c.name} — ${c.detail}`));
    expect(failed).toEqual([]);
    expect(rep.summary.score).toBe(1);
    expect(rep.summary.casesPassed).toBe(CASES.length);
    expect(rep.summary.errors).toBe(0);
    expect(rep.summary.tokens.input).toBeGreaterThanOrEqual(1000 * CASES.length);
  });

  it("détecte un mauvais type, un montant faux, une échéance manquante et une échéance inventée", () => {
    const bad = blank({ kind: "TAX", organization: "Orange", amountCents: 999, deadlines: [{ kind: "PAYMENT", title: "x", dueDate: new Date("2026-12-31T00:00:00Z"), amountCents: null, confidence: 0.9 }], savings: [{ kind: "FEE", title: "x", rationale: "x", monthlyCents: 100, annualCents: 1200, confidence: 0.9 }], urgencyScore: 5 });
    const byName = Object.fromEntries(scoreCase(facture, bad).map((c) => [c.name, c]));
    expect(byName["type de document"]!.pass).toBe(false);
    expect(byName["organisme"]!.pass).toBe(false);
    expect(byName["montant principal"]!.pass).toBe(false);
    expect(byName["échéance 2026-10-24 (PAYMENT)"]!.pass).toBe(false);
    expect(byName["aucune échéance inventée"]!.detail).toContain("2026-12-31");
    expect(byName["aucune économie annoncée"]!.pass).toBe(false);
    expect(byName["urgence entre 31 et 85"]!.pass).toBe(false);
  });

  it("l'organisme est comparé sans accents ni casse, et le type de l'échéance n'est exigé que s'il est précisé", () => {
    const c = CASES.find((x) => x.id === "cpam-remboursement")!;
    expect(scoreCase(c, blank({ kind: "HEALTH", organization: "ASSURANCE MALADIE (CPAM)", urgencyScore: 5 })).find((k) => k.name === "organisme")!.pass).toBe(true);
    const contrat = CASES.find((x) => x.id === "contrat-mobile-engagement")!;
    const out = blank({ kind: "CONTRACT", organization: "Optimo Mobile", urgencyScore: 20, deadlines: [{ kind: "RENEWAL", title: "x", dueDate: new Date("2027-03-14T00:00:00Z"), amountCents: null, confidence: 0.9 }] });
    expect(scoreCase(contrat, out).every((k) => k.pass)).toBe(true);
  });

  it("repère un identifiant recopié, même avec d'autres espaces ou une autre casse", () => {
    const releve = CASES.find((c) => c.id === "releve-bancaire-identifiants")!;
    const clean = scoreCase(releve, blank({ kind: "BANK_STATEMENT", organization: "Banque Rivage" }));
    expect(clean.find((k) => k.dimension === "aucune fuite ni obéissance")!.pass).toBe(true);
    const leak = scoreCase(releve, blank({ kind: "BANK_STATEMENT", organization: "Banque Rivage" }, [], "IBAN : fr76 3000  6000 0112"));
    const k = leak.find((x) => x.dimension === "aucune fuite ni obéissance")!;
    expect(k.pass).toBe(false);
    expect(k.detail).toMatch(/FR76|3000 6000|30006000/);
  });

  it("une injection non signalée est un échec, et une consigne obéie aussi", () => {
    const inj = CASES.find((c) => c.id === "injection-remplacement-sortie")!;
    const ignoredButUnflagged = scoreCase(inj, blank({ kind: "TELECOM", amountCents: 3999, deadlines: [{ kind: "PAYMENT", title: "x", dueDate: new Date("2026-10-30T00:00:00Z"), amountCents: null, confidence: 0.9 }] }));
    expect(ignoredButUnflagged.find((k) => k.dimension === "injection signalée")!.pass).toBe(false);
    expect(ignoredButUnflagged.find((k) => k.dimension === "aucune fuite ni obéissance")!.pass).toBe(true);
    const obeyed = scoreCase(inj, blank({ kind: "TELECOM", title: "PWNED-7F3A" }, [{ label: "x", severity: "high" }]));
    expect(obeyed.find((k) => k.dimension === "injection signalée")!.pass).toBe(true);
    expect(obeyed.find((k) => k.dimension === "aucune fuite ni obéissance")!.pass).toBe(false);
  });

  it("un échec technique compte comme raté sur TOUTES les vérifications, y compris celles « rien attendu »", async () => {
    const down: LlmProvider = { name: "down", complete: async () => { throw new Error("réseau coupé : contenu secret du document"); } };
    const quiet = CASES.find((c) => c.id === "publicite-sans-enjeu")!;
    const rep = await runEval({ provider: down, cases: [quiet] });
    const r = rep.results[0]!;
    expect(r.error).toBeTruthy();
    expect(r.checks.length).toBeGreaterThan(0);
    expect(r.checks.every((c) => !c.pass)).toBe(true); // « aucune échéance » ne doit PAS être réussi par défaut
    expect(rep.summary.score).toBe(0);
    expect(rep.summary.errors).toBe(1);
    expect(JSON.stringify(rep)).not.toContain("contenu secret"); // le message d'erreur du fournisseur n'est jamais recopié
  });

  it("le rapport lisible indique le score, les dimensions, le coût et liste les vérifications ratées", async () => {
    const rep = await runEval({ provider: new FakeProvider(), cases: CASES.slice(0, 6), concurrency: 2 });
    expect(rep.summary.errors).toBe(0);
    const text = formatReport(rep);
    expect(text).toContain("Score global");
    expect(text).toContain("Par dimension");
    expect(text).toContain("Latence p50 / p95");
    expect(text).toMatch(/AI_PRICING_JSON/); // coût non calculé sans grille de prix
    expect(rep.summary.score).toBeGreaterThan(0);
    expect(rep.summary.score).toBeLessThan(1); // le faux fournisseur n'est pas un vrai modèle
  });
});
