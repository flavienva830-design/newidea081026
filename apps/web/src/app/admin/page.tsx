import { redirect } from "next/navigation";
import { Card, Hero, RangeTabs, Stat, pct } from "@/components/admin/bits";
import { TimeChart } from "@/components/admin/charts";
import { fmtEuro, fmtEuro2, fmtInt } from "@/components/admin/format";
import { dbService } from "@/lib/db";
import { aiCostSeries, analysisSeries, getKpis, mrrSeries, parseRange, rangeBounds, signupSeries } from "@/server/admin/metrics";
import { requireStaff } from "@/server/admin/guard";

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff("SUPPORT");
  if (staff.role !== "ADMIN") redirect("/admin/users");
  const range = parseRange((await searchParams).range);
  const now = new Date();
  const { from, to } = rangeBounds(now, range);
  const db = dbService();
  const [k, signups, analyses, mrr, cost] = await Promise.all([getKpis(db, now), signupSeries(db, from, to), analysisSeries(db, from, to), mrrSeries(db, from, to), aiCostSeries(db, from, to)]);

  return (
    <div className="space-y-8">
      <div><h1 className="display-md">Vue d'ensemble</h1><p className="mt-2 text-[15px] text-soft">Indicateurs agrégés. Aucun contenu de document n'existe dans cette base.</p></div>
      <RangeTabs current={range} base="/admin" />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
        <Hero label="Revenu mensuel récurrent (MRR, estimé)" value={fmtEuro2(k.revenue.mrrCents)} hint="Prix catalogue des abonnements actifs, annuel ramené au mois. Hors remises et taxes : Stripe reste la référence comptable." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="ARR estimé" value={fmtEuro(k.revenue.arrCents)} hint="MRR × 12" />
          <Stat label="Foyers abonnés" value={fmtInt(k.revenue.paying)} hint={`ARPU ${fmtEuro2(k.revenue.arpuCents)}`} />
          <Stat label="Churn à 30 jours" value={pct(k.churn.logoRate)} hint={`${k.churn.churned} résiliation(s) · revenu ${pct(k.churn.revenueRate)}`} />
          <Stat label="Conversion" value={pct(k.conversion.rate)} hint={`${k.conversion.paid} abonnés sur ${k.conversion.cohort} foyers créés en 90 jours`} />
          <Stat label="Activation" value={pct(k.activation.rate)} hint={`${k.activation.activated} sur ${k.activation.cohort} : 1er document sous 7 jours`} />
          <Stat label="Utilisateurs" value={fmtInt(k.users.total)} hint={`${k.users.new7d} nouveaux sur 7 jours · ${k.users.verified} vérifiés`} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:max-w-[560px]">
        <Stat label="Connectés / jour" value={fmtInt(k.active.dau)} />
        <Stat label="Connectés / 7 j" value={fmtInt(k.active.wau)} />
        <Stat label="Connectés / 30 j" value={fmtInt(k.active.mau)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="MRR dans le temps" subtitle="Somme cumulée des variations d'abonnement (estimation)"><TimeChart kind="line" data={mrr} title="MRR" valueLabel="MRR" unit="euro2" /></Card>
        <Card title="Inscriptions" subtitle="Nouveaux comptes par jour"><TimeChart kind="bar" data={signups} title="Inscriptions par jour" valueLabel="Comptes" /></Card>
        <Card title="Documents analysés" subtitle="Analyses terminées par jour"><TimeChart kind="bar" data={analyses} title="Documents analysés par jour" valueLabel="Documents" /></Card>
        <Card title="Coût IA" subtitle="Coût estimé par jour (grille de prix configurée)"><TimeChart kind="bar" data={cost} title="Coût IA par jour" valueLabel="Coût" unit="euro2" /></Card>
      </div>

      <details className="rounded-card border border-line p-5 text-[13px] text-soft">
        <summary className="cursor-pointer font-medium text-fg">Définitions des indicateurs</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li><b>MRR</b> : somme des prix mensuels catalogue des abonnements actifs, en essai, ou impayés encore dans leur période payée.</li>
          <li><b>Churn à 30 jours</b> : abonnements passés à zéro revenu sur 30 jours ÷ abonnés au début de la période (hors nouveaux). Un foyer qui part et revient compte deux fois.</li>
          <li><b>Conversion</b> : part des foyers créés ces 90 derniers jours qui sont abonnés aujourd'hui.</li>
          <li><b>Activation</b> : parmi les comptes vérifiés créés il y a 7 à 37 jours, part ayant analysé au moins un document dans les 7 jours suivant l'inscription.</li>
          <li><b>Connectés</b> : utilisateurs distincts ayant ouvert une session (connexion), pas utilisateurs ayant consulté l'application.</li>
        </ul>
      </details>
    </div>
  );
}
