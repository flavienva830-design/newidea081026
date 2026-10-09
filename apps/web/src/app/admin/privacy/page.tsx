import Link from "next/link";
import { RETENTION_DAYS, RETENTION_POLICY, formatRetention } from "@mon-agent-ia/core";
import { Card, Pill, Stat, Table, dateFr, dateTimeFr } from "@/components/admin/bits";
import { dbService } from "@/lib/db";
import { requireStaff } from "@/server/admin/guard";
import { getPrivacyOverview } from "@/server/admin/metrics";
import { DeletionActions } from "./deletion-actions";

export const metadata = { title: "RGPD" };

export default async function PrivacyAdminPage() {
  await requireStaff("ADMIN");
  const p = await getPrivacyOverview(dbService(), new Date());
  return (
    <div className="space-y-8">
      <div><h1 className="display-md">RGPD</h1><p className="mt-2 text-[15px] text-soft">Demandes des personnes sur 30 jours. Les fichiers ne sont jamais conservés : l'export et la suppression ne portent que sur des données structurées.</p></div>
      <div className="grid grid-cols-3 gap-3 sm:max-w-[620px]">
        <Stat label="Consentements retirés" value={String(p.withdrawals)} />
        <Stat label="Exports de données" value={String(p.exports)} />
        <Stat label="Effacements demandés" value={String(p.erasures)} />
      </div>
      <Card title="Suppressions de compte en attente" subtitle="Le worker purge les demandes arrivées à échéance (toutes les 10 minutes). Chaque intervention est journalisée avec son motif.">
        <Table head={["Compte", "Demandée le", "Échéance", "État", "Actions"]}>
          {p.requests.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/admin/users/${encodeURIComponent(r.user.id)}`} className="underline underline-offset-4">{r.user.email}</Link></td>
              <td className="whitespace-nowrap text-soft">{dateTimeFr(r.createdAt)}</td><td className="whitespace-nowrap text-soft">{dateFr(r.scheduledFor)}</td>
              <td>{r.status === "PROCESSING" ? "En cours" : "Programmée"}</td>
              <td>{r.status === "PENDING" ? <DeletionActions id={r.id} /> : <span className="text-soft">—</span>}</td>
            </tr>
          ))}
          {p.requests.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-soft">Aucune suppression en attente.</td></tr>}
        </Table>
      </Card>
      <Card title="Durées de conservation" subtitle="Appliquées chaque nuit par le worker. Les documents, leur texte et les courriers générés ne sont jamais conservés : cette liste ne concerne que des données d'exploitation.">
        <p className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-soft">
          {p.lastPurge
            ? <>Dernière purge : {dateTimeFr(p.lastPurge.at)} · {p.lastPurge.deleted} ligne(s) supprimée(s) {p.lastPurge.failed.length > 0 && <Pill tone="danger">Échec : {p.lastPurge.failed.join(", ")}</Pill>}</>
            : <>Aucune purge enregistrée pour l'instant : <Pill tone="warn">à vérifier que le worker tourne</Pill></>}
        </p>
        <Table head={["Donnée", "Durée", "Pourquoi"]}>
          {RETENTION_POLICY.map((r) => (
            <tr key={r.label}>
              <td className="font-medium">{r.label}</td>
              <td className="whitespace-nowrap">{r.keys.map((k) => formatRetention(RETENTION_DAYS[k])).join(" / ")}</td>
              <td className="text-soft">{r.why}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
