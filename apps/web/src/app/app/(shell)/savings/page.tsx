import type { Metadata } from "next";
import { withTenant } from "@mon-agent-ia/db";
import { can } from "@mon-agent-ia/core";
import { Empty, PageHead, euro } from "@/components/app/page-bits";
import { RowActions } from "@/components/app/row-actions";
import { db } from "@/lib/db";
import { setSavingStatus } from "@/server/records";
import { requireTenant } from "@/server/session";

export const metadata: Metadata = { title: "Économies" };

export default async function SavingsPage() {
  const { tenant } = await requireTenant();
  const items = await withTenant(db(), tenant, (tx) => tx.saving.findMany({ where: { status: { in: ["DETECTED", "ACCEPTED"] } }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 100 }));
  const canWrite = can(tenant.role, "action:write");
  const monthly = items.reduce((n, s) => n + s.monthlyCents, 0);
  const annual = items.reduce((n, s) => n + s.annualCents, 0);
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHead title="Économies" subtitle="Hausses de tarif, doublons, frais : ce que l'agent a repéré, chiffré par mois et par an." />
      {items.length === 0 ? <Empty title="Aucune économie détectée" text="L'agent signale ici les gains possibles repérés dans vos documents." cta /> : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-line p-6"><p className="text-[12px] text-soft">Par mois</p><p className="mt-1 font-display text-[40px] font-medium leading-none tracking-tight">{euro(monthly)}</p></div>
            <div className="rounded-card bg-fg p-6 text-white"><p className="text-[12px] text-white/60">Par an</p><p className="mt-1 font-display text-[40px] font-medium leading-none tracking-tight">{euro(annual)}</p></div>
          </div>
          <ul className="space-y-3">
            {items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-4 rounded-[20px] border border-line p-5 sm:p-6">
                <div className="min-w-0 flex-1"><p className="text-[16px] font-medium tracking-tight">{s.title}</p><p className="text-[14px] text-soft">{s.rationale}</p></div>
                <div className="text-right"><p className="font-display text-[22px] font-medium tracking-tight">{euro(s.annualCents)}<span className="text-[12px] text-soft"> / an</span></p><p className="text-[12px] text-faint">Confiance {Math.round(s.confidence * 100)} %</p></div>
                {canWrite && <RowActions actions={[
                  { label: "Réalisée", icon: "check", run: async () => { "use server"; return setSavingStatus({ id: s.id, status: "REALIZED" }); } },
                  { label: "Ignorer", icon: "x", variant: "ghost", run: async () => { "use server"; return setSavingStatus({ id: s.id, status: "DISMISSED" }); } },
                ]} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
