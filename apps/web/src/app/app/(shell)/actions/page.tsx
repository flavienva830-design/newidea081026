import type { Metadata } from "next";
import { withTenant } from "@mon-agent-ia/db";
import { can } from "@mon-agent-ia/core";
import { Empty, PageHead } from "@/components/app/page-bits";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { setActionStatus } from "@/server/records";
import { requireTenant } from "@/server/session";

export const metadata: Metadata = { title: "Actions recommandées" };

const LETTERABLE = new Set(["CANCEL_CONTRACT", "CONTEST", "REQUEST_REFUND", "FOLLOW_UP", "REPLY_REQUIRED"]);
const TYPE: Record<string, string> = { CANCEL_CONTRACT: "Résiliation", CONTEST: "Contestation", REQUEST_REFUND: "Remboursement", FOLLOW_UP: "Relance", REPLY_REQUIRED: "Réponse", PAY_BEFORE: "Paiement", REVIEW_DOCUMENT: "À vérifier", OTHER: "Autre" };

export default async function ActionsPage() {
  const { tenant } = await requireTenant();
  const actions = await withTenant(db(), tenant, (tx) => tx.recommendedAction.findMany({ where: { status: { in: ["PROPOSED", "ACCEPTED", "IN_PROGRESS"] } }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 100 }));
  const canWrite = can(tenant.role, "action:write");
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHead title="Actions recommandées" subtitle="L'agent propose, vous décidez. Rien n'est envoyé sans votre validation." />
      {actions.length === 0 ? <Empty title="Aucune action pour le moment" text="Dès qu'un document le justifie, l'agent vous proposera une démarche." cta /> : (
        <ul className="space-y-3">
          {actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-4 rounded-[20px] border border-line p-5 sm:p-6">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-accent-strong">{TYPE[a.type]}{a.status === "ACCEPTED" ? " · acceptée" : ""}</p>
                <p className="mt-0.5 text-[16px] font-medium tracking-tight">{a.title}</p>
                <p className="text-[14px] text-soft">{a.rationale}</p>
              </div>
              {canWrite && LETTERABLE.has(a.type) && <Button href={`/app/letters?action=${a.id}`} variant="secondary" size="sm">Préparer le courrier</Button>}
              {canWrite && <RowActions actions={[
                ...(a.status === "PROPOSED" ? [{ label: "Accepter", icon: "check" as const, variant: "primary" as const, run: async () => { "use server"; return setActionStatus({ id: a.id, status: "ACCEPTED" }); } }] : []),
                { label: "Terminé", icon: "check" as const, run: async () => { "use server"; return setActionStatus({ id: a.id, status: "DONE" }); } },
                { label: "Ignorer", icon: "x" as const, variant: "ghost" as const, run: async () => { "use server"; return setActionStatus({ id: a.id, status: "DISMISSED" }); } },
              ]} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
