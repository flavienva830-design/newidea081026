import type { Metadata } from "next";
import { CalendarClock, Sparkles } from "lucide-react";
import { PLANS, can, usagePeriod } from "@mon-agent-ia/core";
import { withTenant } from "@mon-agent-ia/db";
import { db } from "@/lib/db";
import { billingConfigured } from "@/server/billing";
import { currentPlan } from "@/server/plan";
import { requireTenant } from "@/server/session";
import { BillingActions } from "./billing-actions";

export const metadata: Metadata = { title: "Abonnement" };

const NAMES = { FREE: "Gratuit", SOLO: "Solo", FAMILLE: "Famille" } as const;
const STATUS: Record<string, string> = { ACTIVE: "Actif", TRIALING: "Période d'essai", PAST_DUE: "Paiement en échec", CANCELED: "Résilié", UNPAID: "Impayé", INCOMPLETE: "En attente de paiement" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const sp = await searchParams;
  const { tenant } = await requireTenant();
  const data = await withTenant(db(), tenant, async (tx) => ({
    plan: await currentPlan(tx, tenant.householdId),
    billing: await tx.billingSubscription.findUnique({ where: { householdId: tenant.householdId } }),
    usage: await tx.usageCounter.findUnique({ where: { householdId_period: { householdId: tenant.householdId, period: usagePeriod() } } }),
  }));
  const limits = PLANS[data.plan];
  const docs = data.usage?.documents ?? 0;
  const letters = data.usage?.lettersGenerated ?? 0;
  const canManage = can(tenant.role, "billing:manage");

  return (
    <div className="space-y-8">
      <div><h1 className="display-md">Abonnement</h1><p className="mt-2 text-[15px] text-soft">Votre offre, votre consommation et vos factures.</p></div>

      {sp.checkout === "success" && <p role="status" className="rounded-control border border-[#abefc6] bg-[#ecfdf3] px-4 py-3 text-[14px] text-[#067647]">Merci ! Votre paiement est en cours de confirmation. Votre offre s'active d'ici quelques instants.</p>}
      {sp.checkout === "cancel" && <p role="status" className="rounded-control border border-line bg-subtle px-4 py-3 text-[14px] text-soft">Paiement annulé : aucun montant n'a été prélevé.</p>}

      <section className="rounded-[20px] border border-line p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] text-soft">Offre actuelle</p>
            <p className="mt-1 font-display text-[40px] font-medium leading-none tracking-tight">{NAMES[data.plan]}</p>
            {data.billing && data.plan !== "FREE" && (
              <p className="mt-3 flex items-center gap-2 text-[13px] text-soft"><CalendarClock className="size-4" />
                {STATUS[data.billing.status]}{data.billing.currentPeriodEnd ? ` · ${data.billing.cancelAtPeriodEnd ? "se termine le" : "renouvellement le"} ${data.billing.currentPeriodEnd.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : ""}
              </p>
            )}
            {data.billing?.status === "PAST_DUE" && <p role="alert" className="mt-3 text-[13px] text-danger">Le dernier paiement a échoué. Mettez à jour votre moyen de paiement depuis « Gérer l'abonnement ».</p>}
          </div>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Meter label="Documents ce mois-ci" used={docs} limit={limits.documentsPerMonth} />
          <Meter label="Courriers ce mois-ci" used={letters} limit={limits.lettersPerMonth} none="Non inclus dans cette offre" />
        </div>
      </section>

      {canManage ? <BillingActions plan={data.plan} hasCustomer={!!data.billing} configured={billingConfigured()} /> : (
        <p className="flex items-center gap-2 rounded-card bg-subtle p-5 text-[14px] text-soft"><Sparkles className="size-4" /> Seul le propriétaire du foyer peut modifier l'abonnement.</p>
      )}
    </div>
  );
}

function Meter({ label, used, limit, none }: { label: string; used: number; limit: number; none?: string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <p className="text-[13px] font-medium">{label}</p>
      {limit === 0 ? <p className="mt-2 text-[13px] text-soft">{none}</p> : (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className={pct >= 90 ? "h-full rounded-full bg-danger" : "h-full rounded-full bg-accent"} style={{ width: `${pct}%` }} /></div>
          <p className="mt-1.5 text-[12px] text-soft">{used} sur {limit}</p>
        </>
      )}
    </div>
  );
}
