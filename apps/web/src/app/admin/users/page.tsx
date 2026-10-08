import Link from "next/link";
import { Pill, Table, dateFr } from "@/components/admin/bits";
import { dbService } from "@/lib/db";
import { requireStaff } from "@/server/admin/guard";
import { searchUsers } from "@/server/admin/users";

export const metadata = { title: "Utilisateurs" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireStaff("SUPPORT");
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const users = await searchUsers(dbService(), q);
  return (
    <div className="space-y-6">
      <div><h1 className="display-md">Utilisateurs</h1><p className="mt-2 text-[15px] text-soft">Recherche par adresse email (3 caractères minimum). Consulter une fiche est enregistré dans le journal d'audit.</p></div>
      <form method="get" role="search" className="flex max-w-[520px] gap-2">
        <label className="sr-only" htmlFor="q">Adresse email</label>
        <input id="q" name="q" defaultValue={q} placeholder="prenom.nom@exemple.fr" autoComplete="off" className="h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-white px-5 text-[14px] focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)]" />
        <button className="h-11 rounded-full bg-fg px-6 text-[14px] font-medium text-white hover:bg-[#2a2a2a]">Rechercher</button>
      </form>
      <p className="text-[12px] text-soft">{q.length >= 3 ? `${users.length} résultat(s) pour « ${q} »` : "25 derniers comptes créés"}</p>
      <Table head={["Email", "Nom", "Offre", "Créé le", "État"]}>
        {users.map((u) => (
          <tr key={u.id}>
            <td><Link href={`/admin/users/${encodeURIComponent(u.id)}`} className="font-medium text-fg underline underline-offset-4">{u.email}</Link></td>
            <td className="text-soft">{u.name}</td>
            <td>{u.plan === "FREE" ? <Pill>Gratuit</Pill> : <Pill tone="ok">{u.plan === "SOLO" ? "Solo" : "Famille"}</Pill>}</td>
            <td className="whitespace-nowrap text-soft">{dateFr(u.createdAt)}</td>
            <td className="space-x-1.5">
              {u.bannedAt && <Pill tone="danger">Suspendu</Pill>}
              {!u.emailVerified && <Pill tone="warn">Non vérifié</Pill>}
              {u.staffRole !== "NONE" && <Pill>Équipe</Pill>}
              {u.twoFactorEnabled && <Pill tone="ok">2FA</Pill>}
            </td>
          </tr>
        ))}
        {users.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-soft">Aucun utilisateur.</td></tr>}
      </Table>
    </div>
  );
}
