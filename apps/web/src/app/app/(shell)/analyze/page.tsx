import type { Metadata } from "next";
import { can } from "@mon-agent-ia/core";
import { Analyzer } from "./analyzer";
import { Reveal } from "@/components/ui/reveal";
import { db } from "@/lib/db";
import { listPeople } from "@/server/family-service";
import { requireTenant } from "@/server/session";

export const metadata: Metadata = { title: "Analyser un document" };

export default async function AnalyzePage() {
  const { tenant } = await requireTenant();
  const people = await listPeople(db(), tenant);
  return (
    <div className="mx-auto max-w-[900px]">
      <Reveal hero><h1 className="display-md">Analyser un document</h1></Reveal>
      <Reveal hero delay={0.1}><p className="mt-2 max-w-[60ch] text-[16px] text-soft">Déposez un courrier, une facture ou un contrat. L'agent le lit, vous présente le résultat, puis oublie le fichier.</p></Reveal>
      <div className="mt-10">
        {can(tenant.role, "document:write")
          ? <Analyzer people={people} />
          : <p className="rounded-[20px] bg-subtle p-8 text-[14px] text-soft">Votre rôle dans ce foyer est « lecture seule » : vous pouvez consulter les documents, pas en ajouter. Demandez un accès en écriture au propriétaire du foyer.</p>}
      </div>
    </div>
  );
}
