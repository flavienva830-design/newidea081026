import type { Metadata } from "next";
import { withTenant } from "@mon-agent-ia/db";
import { can } from "@mon-agent-ia/core";
import { Empty, PageHead, dayFr, euro } from "@/components/app/page-bits";
import { RowActions } from "@/components/app/row-actions";
import { db } from "@/lib/db";
import { deleteDocument } from "@/server/records";
import { requireTenant } from "@/server/session";

export const metadata: Metadata = { title: "Documents analysés" };

const KIND: Record<string, string> = { INVOICE: "Facture", CONTRACT: "Contrat", TAX: "Impôts", INSURANCE: "Assurance", HEALTH: "Santé", BANK_STATEMENT: "Relevé", UTILITY: "Énergie", TELECOM: "Télécom", OFFICIAL_LETTER: "Courrier officiel", PAYSLIP: "Bulletin de paie", OTHER: "Autre", UNKNOWN: "Non identifié" };

export default async function DocumentsPage() {
  const { tenant } = await requireTenant();
  const docs = await withTenant(db(), tenant, (tx) => tx.document.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100, include: { profile: { select: { displayName: true } } } }));
  const canDelete = can(tenant.role, "document:delete");
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHead title="Documents analysés" subtitle="Les fichiers ne sont jamais conservés. Voici uniquement ce que l'agent a retenu de chacun. Vous pouvez le supprimer à tout moment." />
      {docs.length === 0 ? <Empty title="Aucun document analysé" text="Déposez un courrier, une facture ou un contrat : l'agent en retire l'essentiel." cta /> : (
        <ul className="divide-y divide-line rounded-[20px] border border-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{d.title}</p>
                <p className="truncate text-[13px] text-soft">{[KIND[d.kind], d.profile ? `Pour ${d.profile.displayName}` : null, d.organization, d.amountCents != null ? euro(d.amountCents) : null, dayFr(d.createdAt)].filter(Boolean).join(" · ")}</p>
              </div>
              {d.urgencyScore != null && d.urgencyScore >= 70 && <span className="rounded-full bg-danger-wash px-2.5 py-1 text-[11px] font-medium text-danger">Urgent</span>}
              {canDelete && <RowActions actions={[{ label: "Supprimer", icon: "trash", variant: "ghost", confirm: "Supprimer ce document et ses échéances, actions et économies associées ?", run: async () => { "use server"; return deleteDocument({ id: d.id }); } }]} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
