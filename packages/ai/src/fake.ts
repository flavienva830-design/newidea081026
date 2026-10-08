import type { ModelAnalysis } from "./schemas.ts";
import type { LlmProvider, ProviderRequest, ProviderResponse } from "./types.ts";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function dates(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) out.push(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  const re = new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${MONTHS.join("|")})\\s+(\\d{4})\\b`, "gi");
  for (const m of t.matchAll(re)) out.push(`${m[3]}-${String(MONTHS.indexOf(m[2]!.toLowerCase()) + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  return [...new Set(out)].sort();
}

const euros = (t: string) => [...t.matchAll(/(\d{1,3}(?:[  ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?€/g)].map((m) => Math.round(parseFloat(m[1]!.replace(/[  ]/g, "").replace(",", ".")) * 100));

/**
 * Fournisseur déterministe pour le développement et les tests (APP_ENV=dev uniquement).
 * Il imite grossièrement un modèle à l'aide de règles : il ne remplace pas une vraie analyse.
 */
export class FakeProvider implements LlmProvider {
  readonly name = "fake";

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const text = req.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
    const visionOnly = !text;
    const ds = dates(text);
    const amounts = euros(text);
    const lower = text.toLowerCase();

    const kind: ModelAnalysis["kind"] = /mutuelle|assurance|sinistre/.test(lower) ? "INSURANCE" : /impôt|taxe|dgfip/.test(lower) ? "TAX"
      : /abonnement|forfait|internet|mobile|fibre/.test(lower) ? "TELECOM" : /facture|règlement|montant/.test(lower) ? "INVOICE" : visionOnly ? "UNKNOWN" : "OTHER";
    const org = /(?:société|opérateur|fournisseur|chez)\s+([A-ZÉ][\wÉé'-]+(?: [A-ZÉ][\wé'-]+)?)/.exec(text)?.[1] ?? null;

    const hike = /passera de\s*([\d.,]+)\s*€\s*à\s*([\d.,]+)\s*€/i.exec(text);
    const injection = /ignore (?:toutes? )?(?:les |tes )?(?:instructions|règles)|oublie tes instructions|system prompt/i.test(text);

    const deadlines: ModelAnalysis["deadlines"] = ds.slice(0, 3).map((d, i) => ({
      kind: /résili|préavis/.test(lower) && i === 0 ? "CANCELLATION_NOTICE" : "PAYMENT",
      title: /résili|préavis/.test(lower) && i === 0 ? "Date limite de résiliation" : "Échéance indiquée dans le document",
      dueDate: d, amountCents: null, confidence: 0.8,
    }));

    const savings: ModelAnalysis["savings"] = [];
    const actions: ModelAnalysis["actions"] = [];
    if (hike) {
      const monthly = Math.round((parseFloat(hike[2]!.replace(",", ".")) - parseFloat(hike[1]!.replace(",", "."))) * 100);
      if (monthly > 0) {
        savings.push({ kind: "PRICE_INCREASE", title: `Hausse de ${(monthly / 100).toFixed(2).replace(".", ",")} € par mois`, rationale: "Augmentation tarifaire annoncée par l'organisme", monthlyCents: monthly, annualCents: monthly * 12, confidence: 0.9 });
        actions.push({ type: "CONTEST", title: "Demander un geste commercial", rationale: "Hausse tarifaire annoncée", priority: 70 });
        actions.push({ type: "CANCEL_CONTRACT", title: "Résilier avant l'application de la hausse", rationale: "Résiliation sans frais possible avant la date indiquée", priority: 60 });
      }
    }
    if (injection) actions.length = 0;

    const out: ModelAnalysis = {
      kind,
      title: kind === "TELECOM" ? "Courrier opérateur" : kind === "INSURANCE" ? "Courrier d'assurance" : kind === "TAX" ? "Avis fiscal" : kind === "INVOICE" ? "Facture" : "Document",
      organization: org,
      amountCents: amounts.length ? Math.max(...amounts) : null,
      documentDate: null,
      urgencyScore: Math.min(95, 30 + (deadlines.length ? 30 : 0) + (hike ? 15 : 0)),
      confidence: visionOnly ? 0.4 : text.length > 150 ? 0.85 : 0.55,
      summary: visionOnly ? "Document image analysé avec une confiance limitée." : `Document de type ${kind.toLowerCase()} : ${amounts.length} montant(s) et ${ds.length} date(s) repérés.`,
      keyPoints: [...(hike ? ["Hausse tarifaire annoncée"] : []), ...ds.slice(0, 2).map((d) => `Date repérée : ${d}`)],
      risks: injection ? [{ label: "Le document contient des instructions suspectes", severity: "high" }] : [],
      tags: [kind.toLowerCase()],
      deadlines, savings, actions,
    };
    return { json: out, inputTokens: Math.ceil(text.length / 4) + 300, outputTokens: 350, model: req.model, latencyMs: 5 };
  }
}
