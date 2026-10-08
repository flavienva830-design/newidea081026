import Link from "next/link";
import { Card, Pill, Stat, Table, dateFr, dateTimeFr } from "@/components/admin/bits";
import { fmtEuro, fmtEuro2, fmtInt } from "@/components/admin/format";
import { dbService } from "@/lib/db";
import { requireStaff } from "@/server/admin/guard";
import { getBilling, getKpis } from "@/server/admin/metrics";

export const metadata = { title: "Abonnements" };
const PLAN = { FREE: "Gratuit", SOLO: "Solo", FAMILLE: "Famille" } as const;
const STATUS: Record<string, string> = { ACTIVE: "Actif", TRIALING: "Essai", PAST_DUE: "Impayé", CANCELED: "Résilié", UNPAID: "Impayé (clos)", INCOMPLETE: "En attente" };

export default async function BillingAdminPage() {
  await requireStaff("ADMIN");
  const now = new Date();
  const db = dbService();
  const [k, b] = await Promise.all([getKpis(db, now), getBilling(db, now)]);
  return (
    <div className="space-y-8">
      <div><h1 className="display-md">Abonnements et revenus</h1><p className="mt-2 text-[15px] text-soft">Estimation à partir du catalogue de prix. Stripe reste la référence pour la comptabilité, la TVA et les remboursements.</p></div>

      {b.stuckEvents > 0 && <p role="alert" className="rounded-control border border-[#fecdca] bg-danger-wash px-4 py-3 text-[14px] text-danger">{b.stuckEvents} événement(s) Stripe en erreur ou non traité(s) depuis plus de 10 minutes : vérifiez le tableau « Événements Stripe » ci-dessous.</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="MRR estimé" value={fmtEuro2(k.revenue.mrrCents)} />
        <Stat label="ARR estimé" value={fmtEuro(k.revenue.arrCents)} />
        <Stat label="Foyers abonnés" value={fmtInt(k.revenue.paying)} />
        <Stat label="ARPU" value={fmtEuro2(k.revenue.arpuCents)} hint="MRR ÷ foyers abonnés" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Par offre et période">
          <Table head={["Offre", "Période", "Foyers", "MRR"]}>
            {k.revenue.byPlan.map((g) => <tr key={`${g.plan}-${g.interval}`}><td>{PLAN[g.plan]}</td><td>{g.interval === "year" ? "Annuel" : "Mensuel"}</td><td className="tabular-nums">{g.count}</td><td className="tabular-nums">{fmtEuro2(g.mrrCents)}</td></tr>)}
            {k.revenue.byPlan.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-soft">Aucun abonnement payant.</td></tr>}
          </Table>
        </Card>
        <Card title="Par statut Stripe">
          <Table head={["Statut", "Foyers"]}>
            {b.byStatus.map((s) => <tr key={s.status}><td>{STATUS[s.status] ?? s.status}</td><td className="tabular-nums">{s.count}</td></tr>)}
          </Table>
        </Card>
      </div>

      <Card title="Paiements en échec" subtitle="Abonnements impayés, du plus proche de la fin de période au plus lointain">
        <Table head={["Titulaire", "Offre", "Fin de période"]}>
          {b.pastDue.map((p) => (
            <tr key={p.householdId}>
              <td>{p.owner ? <Link href={`/admin/users/${encodeURIComponent(p.owner.id)}`} className="underline underline-offset-4">{p.owner.email}</Link> : "—"}</td>
              <td>{PLAN[p.plan]} · {p.interval === "year" ? "annuel" : "mensuel"}</td><td className="text-soft">{dateFr(p.periodEnd)}</td>
            </tr>
          ))}
          {b.pastDue.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-soft">Aucun impayé.</td></tr>}
        </Table>
      </Card>

      <Card title="Derniers changements d'abonnement" subtitle="50 plus récents (nouveaux abonnés, changements d'offre, résiliations)">
        <Table head={["Date", "Foyer", "Changement", "MRR", "Cause"]}>
          {b.history.map((h) => (
            <tr key={h.id}><td className="whitespace-nowrap text-soft">{dateTimeFr(h.at)}</td><td className="font-mono text-[12px] text-soft">{h.householdId.slice(0, 8)}</td>
              <td>{PLAN[h.fromPlan]} → {PLAN[h.toPlan]}</td><td className="whitespace-nowrap tabular-nums">{fmtEuro2(h.mrrBeforeCents)} → {fmtEuro2(h.mrrAfterCents)}</td><td className="text-soft">{h.reason}</td></tr>
          ))}
          {b.history.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-soft">Aucun changement enregistré.</td></tr>}
        </Table>
      </Card>

      <Card title="Événements Stripe" subtitle="50 derniers webhooks reçus">
        <Table head={["Reçu", "Type", "État"]}>
          {b.events.map((e) => (
            <tr key={e.id}><td className="whitespace-nowrap text-soft">{dateTimeFr(e.receivedAt)}</td><td className="font-mono text-[12px]">{e.type}</td>
              <td>{e.error ? <Pill tone="danger">Erreur : {e.error}</Pill> : e.processedAt ? <Pill tone="ok">Traité</Pill> : <Pill tone="warn">En attente</Pill>}</td></tr>
          ))}
          {b.events.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-soft">Aucun événement reçu.</td></tr>}
        </Table>
      </Card>
    </div>
  );
}
