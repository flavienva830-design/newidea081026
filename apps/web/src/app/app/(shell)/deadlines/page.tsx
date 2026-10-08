import type { Metadata } from "next";
import { withTenant } from "@mon-agent-ia/db";
import { can } from "@mon-agent-ia/core";
import { Empty, PageHead, dayFr, euro } from "@/components/app/page-bits";
import { RowActions } from "@/components/app/row-actions";
import { db } from "@/lib/db";
import { setDeadlineStatus } from "@/server/records";
import { requireTenant } from "@/server/session";

export const metadata: Metadata = { title: "Échéances" };

export default async function DeadlinesPage() {
  const { tenant } = await requireTenant();
  const now = new Date();
  const items = await withTenant(db(), tenant, (tx) => tx.deadline.findMany({ where: { status: "OPEN" }, orderBy: { dueDate: "asc" }, take: 100 }));
  const canWrite = can(tenant.role, "deadline:write");
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHead title="Échéances" subtitle="Les dates limites repérées dans vos documents. Vous êtes prévenu par email 7 jours et 1 jour avant." />
      {items.length === 0 ? <Empty title="Aucune échéance à venir" text="Les dates limites de vos documents apparaîtront ici." cta /> : (
        <ul className="divide-y divide-line rounded-[20px] border border-line">
          {items.map((d) => {
            const days = Math.ceil((d.dueDate.getTime() - now.getTime()) / 86_400_000);
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-4 p-5">
                <div className="w-[130px] shrink-0">
                  <p className="text-[14px] font-medium">{dayFr(d.dueDate)}</p>
                  <p className={days < 0 ? "text-[12px] text-danger" : days <= 7 ? "text-[12px] text-[#b54708]" : "text-[12px] text-soft"}>{days < 0 ? `En retard de ${-days} j` : days === 0 ? "Aujourd'hui" : `Dans ${days} j`}</p>
                </div>
                <p className="min-w-0 flex-1 text-[15px]">{d.title}{d.amountCents != null ? <span className="text-soft"> · {euro(d.amountCents)}</span> : null}</p>
                {canWrite && <RowActions actions={[
                  { label: "Fait", icon: "check", run: async () => { "use server"; return setDeadlineStatus({ id: d.id, status: "DONE" }); } },
                  { label: "Ignorer", icon: "x", variant: "ghost", run: async () => { "use server"; return setDeadlineStatus({ id: d.id, status: "DISMISSED" }); } },
                ]} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
