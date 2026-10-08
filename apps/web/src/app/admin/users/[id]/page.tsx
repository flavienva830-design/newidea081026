import { notFound } from "next/navigation";
import { Card, Pill, Table, dateFr, dateTimeFr } from "@/components/admin/bits";
import { fmtEuro2 } from "@/components/admin/format";
import { dbService } from "@/lib/db";
import { env } from "@/lib/env";
import { requireStaff } from "@/server/admin/guard";
import { recordUserView } from "@/server/admin/audit";
import { getUserDetail } from "@/server/admin/users";
import { UserActions } from "./user-actions";

export const metadata = { title: "Fiche utilisateur" };
const CONSENT: Record<string, string> = { TERMS: "Conditions", PRIVACY: "Confidentialité", SENSITIVE_DATA_PROCESSING: "Données sensibles", AI_PROCESSING: "Traitement IA", MARKETING_EMAIL: "Actualités" };
const METHOD: Record<string, string> = { password: "Mot de passe", magic_link: "Lien magique", google: "Google", totp: "Code à usage unique", backup_code: "Code de secours" };
const ROLE: Record<string, string> = { OWNER: "Propriétaire", ADMIN: "Administrateur", WRITE: "Écriture", READ: "Lecture" };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("SUPPORT");
  let id: string;
  try {
    id = decodeURIComponent((await params).id).slice(0, 100);
  } catch {
    notFound(); // pourcentage mal formé dans l'URL
  }
  const db = dbService();
  const d = await getUserDetail(db, id, new Date());
  if (!d) notFound();
  // Consultation d'une fiche personnelle : tracée.
  await recordUserView(db, { actorId: staff.userId, targetId: id, ip: staff.ip }, env().HASH_PEPPER);
  const { user } = d;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display-md break-all">{user.email}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-soft">{user.name} · inscrit le {dateFr(user.createdAt)}
          {user.bannedAt && <Pill tone="danger">Suspendu le {dateFr(user.bannedAt)}</Pill>}
          {user.deletionRequestedAt && <Pill tone="warn">Suppression demandée</Pill>}
          {user.twoFactorEnabled ? <Pill tone="ok">2FA</Pill> : <Pill>Sans 2FA</Pill>}
          {user.emailVerified ? <Pill tone="ok">Email vérifié</Pill> : <Pill tone="warn">Email non vérifié</Pill>}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Foyers et abonnement">
          <div className="space-y-4">
            {d.households.map((h) => (
              <div key={h.household.id} className="rounded-card border border-line p-4 text-[13px]">
                <p className="font-medium">{h.household.name} <span className="font-normal text-soft">· {ROLE[h.role]}</span></p>
                <p className="mt-1 text-soft">Offre : {h.household.billing && h.household.billing.plan !== "FREE" ? `${h.household.billing.plan} (${h.household.billing.status}${h.household.billing.cancelAtPeriodEnd ? ", fin programmée" : ""})` : "Gratuit"}{h.household.billing?.currentPeriodEnd ? ` · jusqu'au ${dateFr(h.household.billing.currentPeriodEnd)}` : ""}</p>
                <p className="mt-1 text-soft">{h.documents} document(s) analysé(s)</p>
                {h.usage && <p className="mt-1 text-soft">Ce mois-ci : {h.usage.documents} doc. · {h.usage.lettersGenerated} courrier(s) · coût IA {fmtEuro2(h.usage.aiCostMicros / 10000)}</p>}
              </div>
            ))}
            {d.households.length === 0 && <p className="text-[13px] text-soft">Aucun foyer.</p>}
          </div>
        </Card>
        <Card title="Consentements (dernière décision)">
          <ul className="divide-y divide-line text-[13px]">
            {d.consents.map((c) => <li key={c.type} className="flex items-center justify-between py-2"><span>{CONSENT[c.type] ?? c.type}</span><span className="flex items-center gap-2 text-soft">{dateFr(c.at)} {c.granted ? <Pill tone="ok">Accordé</Pill> : <Pill tone="danger">Retiré</Pill>}</span></li>)}
            {d.consents.length === 0 && <li className="py-2 text-soft">Aucun consentement enregistré.</li>}
          </ul>
        </Card>
      </div>

      <Card title="Dernières connexions">
        <Table head={["Date", "Méthode", "Pays", "Résultat"]}>
          {user.loginEvents.map((e, i) => (
            <tr key={i}><td className="whitespace-nowrap text-soft">{dateTimeFr(e.createdAt)}</td><td>{METHOD[e.method] ?? e.method}</td><td>{e.country ?? "—"}</td>
              <td>{e.success ? <Pill tone="ok">Réussie</Pill> : <Pill tone="danger">Échec</Pill>} {e.suspicious && <Pill tone="warn">Inhabituelle : {e.riskReasons.join(", ")}</Pill>}</td></tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Actions" subtitle={staff.role === "ADMIN" ? "Chaque action est journalisée avec votre identité et son motif." : "Réservé aux administrateurs."}>
          <UserActions userId={user.id} banned={!!user.bannedAt} admin={staff.role === "ADMIN"} target={user.staffRole === "ADMIN" || user.id === staff.userId} />
        </Card>
        <Card title="Notes internes" subtitle="Courtes et factuelles. Pas de donnée de santé ni de paiement.">
          <ul className="mb-4 space-y-3 text-[13px]">
            {user.supportNotes.map((n) => <li key={n.id} className="rounded-control bg-subtle p-3"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-1 text-[11px] text-faint">{dateTimeFr(n.createdAt)}</p></li>)}
            {user.supportNotes.length === 0 && <li className="text-soft">Aucune note.</li>}
          </ul>
          <UserActions userId={user.id} note />
        </Card>
      </div>
    </div>
  );
}
