import Link from "next/link";
import { Card, Pill, Stat, Table, dateTimeFr } from "@/components/admin/bits";
import { dbService } from "@/lib/db";
import { requireStaff } from "@/server/admin/guard";
import { decodeCursor, encodeCursor, listAudit, securitySummary } from "@/server/admin/audit";

export const metadata = { title: "Journal d'audit" };

type SP = { action?: string; household?: string; actor?: string; before?: string };
const FILTERS: ReadonlyArray<readonly ["action" | "household" | "actor", string, string]> = [
  ["action", "Action (début)", "admin.user"],
  ["household", "Foyer (UUID)", ""],
  ["actor", "Auteur (id)", ""],
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff("ADMIN");
  const sp = await searchParams;
  const before = decodeCursor(sp.before);
  const db = dbService();
  const [{ rows, next }, sec] = await Promise.all([listAudit(db, { action: sp.action, householdId: sp.household, actorId: sp.actor, before }), securitySummary(db, new Date())]);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), ...(sp.household ? { household: sp.household } : {}), ...(sp.actor ? { actor: sp.actor } : {}), ...extra }).toString();

  return (
    <div className="space-y-8">
      <div><h1 className="display-md">Journal d'audit</h1><p className="mt-2 text-[15px] text-soft">Journal en ajout seul : aucune ligne ne peut être modifiée ni supprimée. Il ne contient que des identifiants et des paramètres, jamais de contenu.</p></div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-[520px]">
        <Stat label="Connexions échouées (7 j)" value={String(sec.failed)} />
        <Stat label="Connexions inhabituelles (7 j)" value={String(sec.suspicious)} />
      </div>
      {sec.recent.length > 0 && (
        <Card title="Connexions inhabituelles récentes">
          <Table head={["Date", "Compte", "Pays", "Signaux"]}>
            {sec.recent.map((e, i) => <tr key={i}><td className="whitespace-nowrap text-soft">{dateTimeFr(e.createdAt)}</td><td>{e.user ? <Link href={`/admin/users/${encodeURIComponent(e.user.id)}`} className="underline underline-offset-4">{e.user.email}</Link> : "—"}</td><td>{e.country ?? "—"}</td><td className="text-soft">{e.riskReasons.join(", ")}</td></tr>)}
          </Table>
        </Card>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3">
        {FILTERS.map(([n, l, ph]) => (
          <label key={n} className="text-[12px] font-medium">{l}
            <input name={n} defaultValue={sp[n] ?? ""} placeholder={ph} className="mt-1 block h-10 w-56 rounded-full border border-line-strong bg-white px-4 text-[13px] font-normal focus:border-accent focus:outline-none" />
          </label>
        ))}
        <button className="h-10 rounded-full bg-fg px-5 text-[13px] font-medium text-white">Filtrer</button>
        {(sp.action || sp.household || sp.actor) && <Link href="/admin/audit" className="pb-2 text-[13px] text-soft underline underline-offset-4">Réinitialiser</Link>}
      </form>

      <Table head={["Date", "Action", "Auteur", "Cible", "Détails"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap text-soft">{dateTimeFr(r.createdAt)}</td>
            <td>{r.action.startsWith("admin.") ? <Pill tone="warn">{r.action}</Pill> : <span className="font-mono text-[12px]">{r.action}</span>}</td>
            <td className="font-mono text-[12px] text-soft">{r.actorId ? r.actorId.slice(0, 14) : "—"}</td>
            <td className="font-mono text-[12px] text-soft">{[r.targetType, r.targetId?.slice(0, 8)].filter(Boolean).join(" ") || (r.householdId ? `foyer ${r.householdId.slice(0, 8)}` : "—")}</td>
            <td className="max-w-[320px] truncate text-[12px] text-soft" title={r.metadata ? JSON.stringify(r.metadata) : ""}>{r.metadata ? JSON.stringify(r.metadata).slice(0, 140) : ""}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-soft">Aucune ligne.</td></tr>}
      </Table>
      {next && <Link href={`/admin/audit?${qs({ before: encodeCursor(next) })}`} className="inline-flex h-10 items-center rounded-full border border-line-strong px-5 text-[13px] font-medium hover:border-fg">Page suivante</Link>}
    </div>
  );
}
