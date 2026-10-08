import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { can, canAssignRole, type MembershipRole } from "@mon-agent-ia/core";
import { PageHead } from "@/components/app/page-bits";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { loadFamily } from "@/server/family-service";
import { requireTenant } from "@/server/session";
import { InvitationRow, InviteForm, LeaveHousehold, MemberRow, ProfileForm, ProfileRow, RenameHousehold } from "./family-panels";

export const metadata: Metadata = { title: "Famille" };

const PLAN_NAME = { FREE: "Gratuit", SOLO: "Solo", FAMILLE: "Famille" } as const;
const ROLES: MembershipRole[] = ["OWNER", "ADMIN", "WRITE", "READ"];
const day = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function FamilyPage() {
  const { tenant } = await requireTenant();
  const v = await loadFamily(db(), tenant);

  // Les commandes affichées suivent le rôle ; chaque Server Action revérifie tout de son côté.
  const role = tenant.role;
  const canInvite = can(role, "member:invite");
  const canSetRole = can(role, "member:set_role");
  const canRemove = can(role, "member:remove");
  const canRename = role === "OWNER" || role === "ADMIN";
  const inviteRoles = (["READ", "WRITE", "ADMIN"] as const).filter((r) => canAssignRole(role, r, false));
  const roleOptions = canSetRole ? ROLES.filter((r) => canAssignRole(role, r, false)) : null;
  const owners = v.members.filter((m) => m.role === "OWNER").length;
  const full = v.seats.used >= v.seats.limit;
  const pct = Math.min(100, Math.round((v.seats.used / Math.max(1, v.seats.limit)) * 100));
  const soleOwner = role === "OWNER" && owners <= 1;

  return (
    <div className="mx-auto max-w-[900px] space-y-8">
      <PageHead title="Famille" subtitle="Les personnes de votre foyer, leurs droits d'accès et les profils que vous gérez." />

      <section aria-labelledby="home-title" className="rounded-[20px] border border-line p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-[12px] text-soft">Foyer actif</p>
            <h2 id="home-title" className="mt-1 text-[28px] tracking-tight">{v.household.name}</h2>
            <p className="mt-2 text-[13px] text-soft">Offre {PLAN_NAME[v.plan]} · votre rôle : {role === "OWNER" ? "propriétaire" : role === "ADMIN" ? "administrateur" : role === "WRITE" ? "lecture et écriture" : "lecture seule"}</p>
          </div>
          <div className="min-w-[200px]">
            <p className="text-[13px] font-medium">Places utilisées</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className={full ? "h-full rounded-full bg-danger" : "h-full rounded-full bg-accent"} style={{ width: `${pct}%` }} /></div>
            <p className="mt-1.5 text-[12px] text-soft">{v.seats.used} sur {v.seats.limit} (membres, profils, invitations en attente)</p>
          </div>
        </div>
        {canRename && <div className="mt-6 border-t border-line pt-6"><RenameHousehold name={v.household.name} /></div>}
      </section>

      {!v.familyIncluded && (
        <section className="flex flex-wrap items-center gap-5 rounded-[20px] bg-subtle p-6 sm:p-8">
          <Sparkles className="size-6 shrink-0 text-accent-strong" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-medium">Partagez ce foyer avec vos proches</p>
            <p className="mt-1 max-w-[56ch] text-[14px] text-soft">L'offre Famille permet d'inviter jusqu'à 5 personnes avec des droits différents (lecture, écriture, administration) et de gérer des profils pour les enfants et les parents.</p>
          </div>
          {role === "OWNER"
            ? <Button href="/app/settings/billing">Voir l'abonnement</Button>
            : <p className="text-[13px] text-soft">Demandez au propriétaire du foyer de passer à l'offre Famille.</p>}
        </section>
      )}

      <section aria-labelledby="members-title" className="space-y-4">
        <h2 id="members-title" className="text-[22px] tracking-tight">Membres <span className="text-[15px] text-soft">({v.members.length})</span></h2>
        <ul className="divide-y divide-line rounded-[20px] border border-line">
          {v.members.map((m) => (
            <MemberRow
              key={m.membershipId}
              m={{ membershipId: m.membershipId, name: m.name, email: m.email, role: m.role, isYou: m.isYou, joinedLabel: day(m.joinedAt) }}
              roleOptions={roleOptions && canAssignRole(role, m.role, m.isYou) ? roleOptions : null}
              canRemove={canRemove && !m.isYou && canAssignRole(role, m.role, false)}
            />
          ))}
        </ul>
        {!canInvite && <p className="text-[13px] text-soft">Seuls les propriétaires et les administrateurs peuvent inviter des personnes ou gérer les profils.</p>}
      </section>

      {canInvite && (
        <section aria-labelledby="invite-title" className="space-y-4">
          <h2 id="invite-title" className="text-[22px] tracking-tight">Inviter une personne</h2>
          <div className="rounded-[20px] border border-line p-6 sm:p-8">
            {v.familyIncluded
              ? <InviteForm roles={[...inviteRoles]} full={full} />
              : <p className="text-[14px] text-soft">L'invitation de membres est incluse dans l'offre Famille.</p>}
            {v.familyIncluded && full && <p className="mt-4 text-[13px] text-soft">Votre foyer est complet. Révoquez une invitation ou archivez un profil pour libérer une place.</p>}
          </div>
          {v.invitations.length > 0 && (
            <>
              <h3 className="pt-2 text-[16px] font-medium tracking-tight">Invitations en attente ({v.invitations.length})</h3>
              <ul className="divide-y divide-line rounded-[20px] border border-line">
                {v.invitations.map((i) => (
                  <InvitationRow key={i.id} inv={{ id: i.id, email: i.email, role: i.role, expiresLabel: day(i.expiresAt), expired: i.expired }} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="profiles-title" className="space-y-4">
        <div>
          <h2 id="profiles-title" className="text-[22px] tracking-tight">Profils <span className="text-[15px] text-soft">({v.profiles.length})</span></h2>
          <p className="mt-1 max-w-[62ch] text-[14px] text-soft">Des personnes sans compte (enfants, parents…) dont vous gérez les papiers. Vous pouvez rattacher un document à un profil au moment de l'analyse.</p>
        </div>
        {v.profiles.length > 0 && (
          <ul className="divide-y divide-line rounded-[20px] border border-line">
            {v.profiles.map((p) => <ProfileRow key={p.id} p={p} canManage={canInvite} />)}
          </ul>
        )}
        {canInvite && (
          <div className="rounded-[20px] border border-line p-6 sm:p-8">
            {v.familyIncluded
              ? <ProfileForm full={full} />
              : <p className="text-[14px] text-soft">Les profils supplémentaires sont inclus dans l'offre Famille.</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="leave-title" className="space-y-3 border-t border-line pt-8">
        <h2 id="leave-title" className="text-[16px] font-medium tracking-tight">Quitter ce foyer</h2>
        {soleOwner
          ? <p className="max-w-[62ch] text-[13px] text-soft">Vous êtes le seul propriétaire de ce foyer : nommez d'abord un autre propriétaire pour pouvoir le quitter.</p>
          : <LeaveHousehold householdName={v.household.name} />}
      </section>
    </div>
  );
}
