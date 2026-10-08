import { PersistableAnalysis, containsSensitiveIdentifier, maskSensitiveIdentifiers } from "@mon-agent-ia/core";
import type { ModelAnalysis } from "./schemas.ts";

export type DisplayResult = {
  summary: string;
  keyPoints: string[];
  risks: { label: string; severity: "low" | "medium" | "high" }[];
};

export type Sanitized = {
  persistable: PersistableAnalysis;
  /** Affiché une seule fois à l'utilisateur, jamais stocké. */
  display: DisplayResult;
  confidence: number;
  /** Éléments écartés (identifiants sensibles, dates invalides…) : indicateur de qualité, sans contenu. */
  dropped: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const intIn = (n: number | null | undefined, lo: number, hi: number): number | null =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(clamp(n, lo, hi)) : null;

/** Une ligne, sans caractères de contrôle, tronquée ; `null` si vide ou si elle contient un identifiant sensible. */
function line(v: string | null | undefined, max: number): string | null {
  if (!v) return null;
  // Borne la taille AVANT tout traitement : la sortie du modèle n'est pas fiable.
  // eslint-disable-next-line no-control-regex
  const t = v.slice(0, max * 3).replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim(); // \s couvre aussi U+2028/2029
  if (!t || containsSensitiveIdentifier(t)) return null;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}

/**
 * Transforme la sortie du modèle (non fiable) en enregistrement minimal conforme à `PersistableAnalysis`.
 * On nettoie et on écarte plutôt que de rejeter l'analyse entière : un téléphone dans un titre ne doit pas
 * faire perdre les échéances. La validation stricte finale garantit qu'aucun contenu ne passe.
 */
export function toPersistable(raw: ModelAnalysis, now: Date): Sanitized {
  let dropped = 0;
  const keep = <T>(v: T | null): v is T => {
    if (v === null) dropped++;
    return v !== null;
  };

  const lowest = new Date(now.getTime() - 30 * 86_400_000);
  const highest = new Date(now.getTime() + 5 * 365 * 86_400_000);

  const seenDl = new Set<string>();
  const deadlines = raw.deadlines
    .slice(0, 20)
    .map((d) => {
      const due = parseDate(d.dueDate);
      const title = line(d.title, 160);
      if (!due || !title || due < lowest || due > highest) return null;
      const k = `${d.kind}:${due.toISOString()}`;
      if (seenDl.has(k)) return null;
      seenDl.add(k);
      return { kind: d.kind, title, dueDate: due, amountCents: intIn(d.amountCents, 0, 1e9), confidence: clamp(d.confidence, 0, 1) };
    })
    .filter(keep)
    .slice(0, 10);

  const savings = raw.savings
    .slice(0, 20)
    .map((s) => {
      const title = line(s.title, 160);
      const rationale = line(s.rationale, 300);
      const monthly = intIn(s.monthlyCents, 0, 1e9) ?? 0;
      let annual = intIn(s.annualCents, 0, 1e9) ?? 0;
      if (!title || !rationale || (monthly === 0 && annual === 0)) return null;
      if (annual === 0) annual = monthly * 12;
      return { kind: s.kind, title, rationale, monthlyCents: monthly, annualCents: annual, confidence: clamp(s.confidence, 0, 1) };
    })
    .filter(keep)
    .slice(0, 10);

  const actions = raw.actions
    .slice(0, 20)
    .map((a) => {
      const title = line(a.title, 160);
      const rationale = line(a.rationale, 300);
      return title && rationale ? { type: a.type, title, rationale, priority: intIn(a.priority, 0, 100) ?? 0 } : null;
    })
    .filter(keep)
    .slice(0, 10);

  const tags = [...new Set(raw.tags.map((t) => line(t.toLowerCase(), 30)).filter((t): t is string => !!t))].slice(0, 8);

  const docDate = parseDate(raw.documentDate);
  const persistable = PersistableAnalysis.parse({
    kind: raw.kind,
    title: line(raw.title, 120) ?? "Document",
    organization: line(raw.organization, 120),
    amountCents: intIn(raw.amountCents, 0, 1e9),
    documentDate: docDate && docDate.getUTCFullYear() >= 2000 && docDate <= highest ? docDate : null,
    urgencyScore: intIn(raw.urgencyScore, 0, 100) ?? 0,
    tags,
    deadlines,
    savings,
    actions,
  });

  const mask = (s: string, max: number) => {
    const m = maskSensitiveIdentifiers(s.slice(0, max * 3).replace(/\s+/g, " ").trim());
    return m.length > max ? m.slice(0, max - 1).trimEnd() + "…" : m;
  };
  const display: DisplayResult = {
    summary: mask(raw.summary ?? "", 600),
    keyPoints: raw.keyPoints.slice(0, 6).map((k) => mask(k, 200)).filter(Boolean),
    risks: raw.risks.slice(0, 5).map((r) => ({ label: mask(r.label, 200), severity: r.severity })).filter((r) => r.label),
  };

  return { persistable, display, confidence: clamp(raw.confidence, 0, 1), dropped };
}
