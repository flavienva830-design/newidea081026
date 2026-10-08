"use client";

import { LogOut, Mail, Plus, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { MembershipRole } from "@mon-agent-ia/core/rbac";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { RELATION_LABEL, ROLE_HELP, ROLE_LABEL } from "@/lib/roles";
import {
  addProfile, archiveProfile, changeMemberRole, inviteMember, leaveHousehold, removeMember, renameHousehold, resendInvitation, revokeInvitation,
  type FamilyResult,
} from "@/server/family";

/**
 * Îlots interactifs de la page Famille. Ils n'appliquent AUCUNE règle de droits : la page serveur n'affiche une
 * commande que si le rôle le permet, et chaque Server Action revérifie tout côté serveur (rôles, hiérarchie, places).
 */

type Msg = { tone: "ok" | "error"; text: string; upgrade?: boolean } | null;

function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<FamilyResult>, after?: (r: FamilyResult) => void) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tone: "ok", text: r.message ?? "C'est fait." } : { tone: "error", text: r.error, upgrade: r.upgrade });
      after?.(r);
    });
  };
  return { pending, msg, run };
}

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  if (msg.tone === "ok") return <Alert tone="ok">{msg.text}</Alert>;
  return (
    <Alert>
      {msg.text}
      {msg.upgrade && <> <Link href="/app/settings/billing" className="font-medium underline underline-offset-4">Voir l'abonnement</Link></>}
    </Alert>
  );
}

const SELECT = "h-12 w-full rounded-control border border-line-strong bg-white px-4 text-[15px] focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)]";
const SELECT_SM = "h-10 rounded-full border border-line-strong bg-white px-3 text-[13px] focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)] disabled:opacity-60";

// ───────────────────────────── Foyer ─────────────────────────────

export function RenameHousehold({ name }: { name: string }) {
  const [value, setValue] = useState(name);
  const { pending, msg, run } = useAct();
  useEffect(() => setValue(name), [name]);
  return (
    <form
      className="space-y-3" noValidate
      onSubmit={(e) => { e.preventDefault(); run(() => renameHousehold({ name: value })); }}
    >
      <Field label="Nom du foyer" htmlFor="household-name">
        <div className="flex flex-wrap gap-3">
          <Input id="household-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} className="min-w-[220px] flex-1" />
          <Button type="submit" variant="secondary" loading={pending} disabled={value.trim() === name}>Renommer</Button>
        </div>
      </Field>
      <Feedback msg={msg} />
    </form>
  );
}

// ───────────────────────────── Invitations ─────────────────────────────

export function InviteForm({ roles, full }: { roles: Exclude<MembershipRole, "OWNER">[]; full: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(roles.includes("READ") ? "READ" : (roles[0] ?? "READ"));
  const { pending, msg, run } = useAct();
  return (
    <form
      className="space-y-4" noValidate
      onSubmit={(e) => { e.preventDefault(); run(() => inviteMember({ email, role }), (r) => { if (r.ok) setEmail(""); }); }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
        <Field label="Adresse email de la personne à inviter" htmlFor="invite-email">
          <Input id="invite-email" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@exemple.fr" disabled={full} />
        </Field>
        <Field label="Rôle" htmlFor="invite-role" hint={ROLE_HELP[role as MembershipRole]}>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} className={SELECT} disabled={full}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={pending} disabled={full || !email.trim()}><Mail className="size-4" /> Envoyer l'invitation</Button>
        <p className="text-[12px] text-faint">Le lien est valable 7 jours et ne peut servir qu'une fois.</p>
      </div>
      <Feedback msg={msg} />
    </form>
  );
}

export type InvitationItem = { id: string; email: string; role: MembershipRole; expiresLabel: string; expired: boolean };

export function InvitationRow({ inv }: { inv: InvitationItem }) {
  const { pending, msg, run } = useAct();
  return (
    <li className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{inv.email}</p>
          <p className="text-[13px] text-soft">
            {ROLE_LABEL[inv.role]} · {inv.expired ? <span className="text-danger">expirée le {inv.expiresLabel}</span> : <>valable jusqu'au {inv.expiresLabel}</>}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={pending} aria-label={`Renvoyer l'invitation à ${inv.email}`} onClick={() => run(() => resendInvitation({ invitationId: inv.id }))}>
            <RefreshCw className="size-4" /> Renvoyer
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`Révoquer l'invitation de ${inv.email}`} onClick={() => run(() => revokeInvitation({ invitationId: inv.id }))}>
            <X className="size-4" /> Révoquer
          </Button>
        </div>
      </div>
      <Feedback msg={msg} />
    </li>
  );
}

// ───────────────────────────── Membres ─────────────────────────────

export type MemberItem = { membershipId: string; name: string; email: string; role: MembershipRole; isYou: boolean; joinedLabel: string };

export function MemberRow({ m, roleOptions, canRemove }: { m: MemberItem; roleOptions: MembershipRole[] | null; canRemove: boolean }) {
  const [role, setRole] = useState<MembershipRole>(m.role);
  const { pending, msg, run } = useAct();
  useEffect(() => setRole(m.role), [m.role]);
  const initials = m.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

  return (
    <li className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-medium">{initials}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">
            {m.name}
            {m.isYou && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-[11px] font-medium text-soft">Vous</span>}
          </p>
          <p className="truncate text-[13px] text-soft">{m.email} · depuis le {m.joinedLabel}</p>
        </div>
        {roleOptions && !m.isYou ? (
          <select
            aria-label={`Rôle de ${m.name}`} value={role} disabled={pending} className={SELECT_SM}
            onChange={(e) => {
              const next = e.target.value as MembershipRole;
              setRole(next);
              run(() => changeMemberRole({ membershipId: m.membershipId, role: next }), (r) => { if (!r.ok) setRole(m.role); });
            }}
          >
            {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        ) : (
          <span className="rounded-full bg-muted px-3 py-1.5 text-[12px] font-medium text-soft">{ROLE_LABEL[m.role]}</span>
        )}
        {canRemove && !m.isYou && (
          <Button
            type="button" size="sm" variant="ghost" disabled={pending} aria-label={`Retirer ${m.name} du foyer`}
            onClick={() => {
              if (!window.confirm(`Retirer ${m.name} du foyer ? Cette personne perdra l'accès aux données du foyer.`)) return;
              run(() => removeMember({ membershipId: m.membershipId }));
            }}
          >
            <Trash2 className="size-4" /> Retirer
          </Button>
        )}
      </div>
      <Feedback msg={msg} />
    </li>
  );
}

export function LeaveHousehold({ householdName }: { householdName: string }) {
  const router = useRouter();
  const { pending, msg, run } = useAct();
  return (
    <div className="space-y-3">
      <Button
        type="button" variant="secondary" disabled={pending}
        onClick={() => {
          if (!window.confirm(`Quitter le foyer « ${householdName} » ? Vous perdrez l'accès à ses données.`)) return;
          run(() => leaveHousehold(), (r) => { if (r.ok) { router.replace("/app"); router.refresh(); } });
        }}
      >
        <LogOut className="size-4" /> Quitter le foyer
      </Button>
      <Feedback msg={msg} />
    </div>
  );
}

// ───────────────────────────── Profils (personnes sans compte) ─────────────────────────────

export function ProfileForm({ full }: { full: boolean }) {
  const [displayName, setDisplayName] = useState("");
  const [relation, setRelation] = useState("CHILD");
  const { pending, msg, run } = useAct();
  return (
    <form
      className="space-y-4" noValidate
      onSubmit={(e) => { e.preventDefault(); run(() => addProfile({ displayName, relation }), (r) => { if (r.ok) setDisplayName(""); }); }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
        <Field label="Prénom du profil" htmlFor="profile-name">
          <Input id="profile-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="Léa" disabled={full} />
        </Field>
        <Field label="Lien avec vous" htmlFor="profile-relation">
          <select id="profile-relation" value={relation} onChange={(e) => setRelation(e.target.value)} className={SELECT} disabled={full}>
            {(["SPOUSE", "CHILD", "PARENT", "OTHER"] as const).map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}
          </select>
        </Field>
      </div>
      <Button type="submit" variant="secondary" loading={pending} disabled={full || !displayName.trim()}><Plus className="size-4" /> Ajouter le profil</Button>
      <Feedback msg={msg} />
    </form>
  );
}

export type ProfileItem = { id: string; displayName: string; relation: string };

export function ProfileRow({ p, canManage }: { p: ProfileItem; canManage: boolean }) {
  const { pending, msg, run } = useAct();
  return (
    <li className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{p.displayName}</p>
          <p className="text-[13px] text-soft">{RELATION_LABEL[p.relation] ?? "Proche"} · sans compte</p>
        </div>
        {canManage && (
          <Button
            type="button" size="sm" variant="ghost" disabled={pending} aria-label={`Archiver le profil ${p.displayName}`}
            onClick={() => {
              if (!window.confirm(`Archiver le profil de ${p.displayName} ? Ses documents restent conservés.`)) return;
              run(() => archiveProfile({ profileId: p.id }));
            }}
          >
            Archiver
          </Button>
        )}
      </div>
      <Feedback msg={msg} />
    </li>
  );
}
