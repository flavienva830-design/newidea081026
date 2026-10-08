import { Card, RangeTabs, Stat, Table, pct } from "@/components/admin/bits";
import { CategoryBars, TimeChart } from "@/components/admin/charts";
import { fmtEuro2, fmtInt } from "@/components/admin/format";
import { dbService } from "@/lib/db";
import { requireStaff } from "@/server/admin/guard";
import { aiCostSeries, analysisSeries, documentsByKind, getAiStats, parseRange, rangeBounds } from "@/server/admin/metrics";

export const metadata = { title: "Activité IA" };
const KIND: Record<string, string> = { INVOICE: "Facture", CONTRACT: "Contrat", TAX: "Impôts", INSURANCE: "Assurance", HEALTH: "Santé", BANK_STATEMENT: "Relevé", UTILITY: "Énergie", TELECOM: "Télécom", OFFICIAL_LETTER: "Courrier officiel", PAYSLIP: "Bulletin de paie", OTHER: "Autre", UNKNOWN: "Non identifié" };
const micros = (m: number) => fmtEuro2(m / 10000); // micro-euros → centimes → format
const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s` : `${v} ms`);

export default async function AiAdminPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireStaff("ADMIN");
  const range = parseRange((await searchParams).range);
  const now = new Date();
  const { from, to } = rangeBounds(now, range);
  const db = dbService();
  const [s, cost, analyses, kinds] = await Promise.all([getAiStats(db, from), aiCostSeries(db, from, to), analysisSeries(db, from, to), documentsByKind(db, from)]);
  return (
    <div className="space-y-8">
      <div><h1 className="display-md">Activité IA</h1><p className="mt-2 text-[15px] text-soft">Appels, coûts et fiabilité. Seules des métriques techniques sont conservées : jamais le contenu des documents.</p></div>
      <RangeTabs current={range} base="/admin/ai" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Appels IA" value={fmtInt(s.runs)} hint={`${fmtInt(s.inputTokens + s.outputTokens)} tokens`} />
        <Stat label="Taux d'erreur" value={pct(s.errorRate)} hint={`${s.errors} appel(s) en erreur ou invalide(s)`} />
        <Stat label="Latence p50 / p95" value={`${ms(s.p50Ms)} / ${ms(s.p95Ms)}`} />
        <Stat label="Coût sur la période" value={micros(s.costMicros)} hint={s.costPerDocumentMicros !== null ? `${micros(s.costPerDocumentMicros)} par document` : "Grille de prix à configurer (AI_PRICING_JSON)"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Coût IA par jour" subtitle="Estimé d'après la grille de prix configurée"><TimeChart kind="bar" data={cost} title="Coût IA par jour" valueLabel="Coût" unit="euro2" /></Card>
        <Card title="Documents analysés par jour"><TimeChart kind="bar" data={analyses} title="Documents analysés par jour" valueLabel="Documents" /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Types de documents analysés" subtitle="Répartition sur la période (métadonnées uniquement)"><CategoryBars data={kinds.map((k) => ({ label: KIND[k.kind] ?? k.kind, value: k.count }))} title="Documents par type" valueLabel="Documents" /></Card>
        <Card title="Par modèle et tâche">
          <Table head={["Modèle", "Tâche", "Appels", "Erreurs", "Coût"]}>
            {s.byModel.map((m) => <tr key={`${m.model}-${m.task}`}><td className="font-mono text-[12px]">{m.model}</td><td>{m.task}</td><td className="tabular-nums">{m.runs}</td><td className="tabular-nums">{m.errors}</td><td className="tabular-nums">{micros(m.costMicros)}</td></tr>)}
            {s.byModel.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-soft">Aucun appel sur la période.</td></tr>}
          </Table>
        </Card>
      </div>

      <Card title="Foyers les plus consommateurs" subtitle="Pour repérer un abus ou une boucle : identifiant abrégé du foyer">
        <Table head={["Foyer", "Appels", "Coût"]}>
          {s.topHouseholds.map((h) => <tr key={h.householdId}><td className="font-mono text-[12px] text-soft">{h.householdId.slice(0, 8)}</td><td className="tabular-nums">{h.runs}</td><td className="tabular-nums">{micros(h.costMicros)}</td></tr>)}
          {s.topHouseholds.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-soft">Aucune donnée.</td></tr>}
        </Table>
      </Card>
    </div>
  );
}
