/**
 * Banc d'essai de l'analyse : mesure la QUALITÉ de l'extraction sur des documents fictifs.
 *
 *   OPENAI_API_KEY=sk-… pnpm --filter @mon-agent-ia/ai eval                 # vrai modèle (consomme quelques centimes)
 *   pnpm --filter @mon-agent-ia/ai eval --provider=fake                      # vérifie seulement que le banc fonctionne
 *   pnpm --filter @mon-agent-ia/ai eval --only=internet-hausse-tarif,injection-exfiltration
 *   pnpm --filter @mon-agent-ia/ai eval --json=rapport.json --min-score=0.9  # code de sortie 1 sous le seuil
 *
 * Variables : OPENAI_API_KEY, AI_MODEL_MINI, AI_MODEL_FULL, AI_PRICING_JSON (grille officielle, micro-euros par million de tokens).
 * N'envoyez JAMAIS de vrais documents : ce banc n'utilise que les documents fictifs de `cases.ts`.
 */
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { AnalysisFailure, analyzeDocument, type AnalysisOutcome } from "../src/analyze.ts";
import { FakeProvider } from "../src/fake.ts";
import { DEFAULT_MODELS, parsePricing, type ModelConfig, type Pricing } from "../src/models.ts";
import { OpenAIProvider } from "../src/openai.ts";
import type { LlmProvider } from "../src/types.ts";
import { CASES, NOW } from "./cases.ts";
import { scoreCase, summarize, type CaseResult, type Summary } from "./score.ts";
import type { EvalCase } from "./types.ts";

export type EvalReport = { provider: string; models: ModelConfig; now: string; results: CaseResult[]; summary: Summary };

/** Résultat d'un cas quand l'analyse n'a pas pu être produite : toutes les vérifications attendues comptent comme ratées (jamais comme réussies). */
const BLANK: AnalysisOutcome = {
  persistable: { kind: "UNKNOWN", title: "x", organization: null, amountCents: null, documentDate: null, urgencyScore: 0, tags: [], deadlines: [], savings: [], actions: [] },
  display: { summary: "", keyPoints: [], risks: [] },
  confidence: 0, dropped: 0, runs: [], escalated: false, model: "",
};

async function runCase(c: EvalCase, deps: { provider: LlmProvider; models: ModelConfig; pricing?: Pricing }): Promise<CaseResult> {
  const now = () => new Date(`${NOW}T10:00:00Z`);
  const started = Date.now();
  try {
    const out = await analyzeDocument({ provider: deps.provider, models: deps.models, ...(deps.pricing ? { pricing: deps.pricing } : {}), now }, { parts: [{ type: "text", text: c.text }], userRef: "eval" });
    return {
      id: c.id, about: c.about, checks: scoreCase(c, out),
      tokens: { input: out.runs.reduce((n, r) => n + r.inputTokens, 0), output: out.runs.reduce((n, r) => n + r.outputTokens, 0) },
      costMicros: out.runs.reduce((n, r) => n + r.costMicros, 0),
      latencyMs: out.runs.reduce((n, r) => n + r.latencyMs, 0), escalated: out.escalated, model: out.model,
    };
  } catch (e) {
    const code = e instanceof AnalysisFailure ? e.message : e instanceof Error ? e.name : "erreur";
    const runs = e instanceof AnalysisFailure ? e.runs : [];
    return {
      id: c.id, about: c.about, error: code,
      checks: scoreCase(c, BLANK).map((k) => ({ ...k, pass: false, detail: "analyse impossible" })),
      tokens: { input: runs.reduce((n, r) => n + r.inputTokens, 0), output: runs.reduce((n, r) => n + r.outputTokens, 0) },
      costMicros: runs.reduce((n, r) => n + r.costMicros, 0), latencyMs: Date.now() - started, escalated: false, model: "",
    };
  }
}

export async function runEval(opts: { provider: LlmProvider; models?: ModelConfig; pricing?: Pricing; cases?: EvalCase[]; concurrency?: number; onResult?: (r: CaseResult) => void }): Promise<EvalReport> {
  const models = opts.models ?? DEFAULT_MODELS;
  const cases = opts.cases ?? CASES;
  const results: CaseResult[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < cases.length; i = next++) {
      const r = await runCase(cases[i]!, { provider: opts.provider, models, ...(opts.pricing ? { pricing: opts.pricing } : {}) });
      results[i] = r;
      opts.onResult?.(r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, cases.length)) }, worker));
  return { provider: opts.provider.name, models, now: NOW, results, summary: summarize(results) };
}

const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1).replace(".", ",")} %`);
const euros = (micros: number) => `${(micros / 1_000_000).toFixed(4).replace(".", ",")} €`;

export function formatReport(rep: EvalReport): string {
  const s = rep.summary;
  const lines: string[] = [];
  for (const r of rep.results) {
    const ok = r.checks.filter((c) => c.pass).length;
    lines.push(`${!r.error && ok === r.checks.length ? "✔" : "✘"} ${r.id}  (${ok}/${r.checks.length})${r.error ? `  — ${r.error}` : ""}${r.escalated ? "  [modèle complet]" : ""}`);
    for (const c of r.checks) if (!c.pass) lines.push(`    ✘ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  lines.push("", `Score global : ${pct(s.score)} (${s.checksPassed}/${s.checks} vérifications) — documents entièrement réussis : ${s.casesPassed}/${s.cases}`);
  lines.push("Par dimension :");
  for (const d of s.byDimension) lines.push(`  ${d.dimension.padEnd(30)} ${pct(d.rate).padStart(8)}  (${d.passed}/${d.total})`);
  lines.push("", `Tokens : ${s.tokens.input} en entrée, ${s.tokens.output} en sortie — coût : ${s.costMicros ? euros(s.costMicros) : "non calculé (renseigner AI_PRICING_JSON)"} — ${s.cases ? euros(s.costMicros / s.cases) : "—"} par document`);
  lines.push(`Latence p50 / p95 : ${s.latency.p50 ?? "—"} / ${s.latency.p95 ?? "—"} ms — passages au modèle complet : ${s.escalations} — échecs techniques : ${s.errors}`);
  return lines.join("\n");
}

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const choice = arg("provider") ?? (process.env["OPENAI_API_KEY"] ? "openai" : undefined);
  if (choice !== "openai" && choice !== "fake") {
    console.error("Aucune clé OPENAI_API_KEY : renseignez-la pour évaluer le vrai modèle, ou utilisez --provider=fake pour vérifier seulement le banc d'essai.");
    process.exit(2);
  }
  if (choice === "openai" && !process.env["OPENAI_API_KEY"]) {
    console.error("OPENAI_API_KEY manquante.");
    process.exit(2);
  }
  const provider: LlmProvider = choice === "fake" ? new FakeProvider() : new OpenAIProvider({ apiKey: process.env["OPENAI_API_KEY"] });
  const models: ModelConfig = { mini: process.env["AI_MODEL_MINI"] ?? DEFAULT_MODELS.mini, full: process.env["AI_MODEL_FULL"] ?? DEFAULT_MODELS.full };
  const pricing = parsePricing(process.env["AI_PRICING_JSON"]);
  const only = arg("only")?.split(",").map((x) => x.trim()).filter(Boolean);
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  if (cases.length === 0) {
    console.error(`Aucun cas ne correspond à --only. Disponibles : ${CASES.map((c) => c.id).join(", ")}`);
    process.exit(2);
  }

  console.log(`Banc d'essai de l'analyse — fournisseur : ${provider.name} — modèles : ${models.mini} → ${models.full} — ${cases.length} document(s) fictif(s)\n`);
  const report = await runEval({ provider, models, ...(pricing ? { pricing } : {}), cases, concurrency: Number(arg("concurrency") ?? 3) });
  console.log(formatReport(report));

  const out = arg("json");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  const min = arg("min-score");
  if (min !== undefined && report.summary.score < Number(min)) {
    console.error(`\nScore ${pct(report.summary.score)} inférieur au seuil ${pct(Number(min))}.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
