"use server";

import { z } from "zod";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { can, hmac, parseKek } from "@mon-agent-ia/core";
import { withUser } from "@mon-agent-ia/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { limiters } from "@/lib/limiters";
import { actionEmail, sendMail } from "@/lib/mailer";
import { ROLE_LABEL } from "@/lib/roles";
import { provisionHousehold } from "./household";
import { requireSession, requireTenant } from "./session";
import { clientInfo } from "./security";
import { HOUSEHOLD_COOKIE, householdCookieOptions, resolveTenant } from "./tenant";
import * as svc from "./family-service";

/**
 * Server Actions de l'espace Famille. Next.js protège déjà leur appel contre le CSRF (origine vérifiée) ; ici :
 * validation Zod de TOUTES les entrées, session à email vérifié, puis délégation au service qui applique les
 * règles de rôles, de places et d'audit. Aucun identifiant d'acteur ou de foyer ne vient du client.
 */

export type FamilyResult = { ok: true; message?: string } | { ok: false; error: string; upgrade?: boolean };

const DENIED: FamilyResult = { ok: false, error: "Vous n'avez pas le droit d'effectuer cette action." };
const bad = (error = "Demande invalide."): FamilyResult => ({ ok: false, error });
const uuid = z.uuid();
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Session + foyer actif, à email vérifié uniquement. */
async function context() {
  const { session, tenant } = await requireTenant();
  if (!session.user.emailVerified) return null;
  const info = clientInfo(await headers());
  const e = env();
  return { session, tenant, e, deps: { db: db(), pepper: e.HASH_PEPPER, ip: info.ip, userAgent: info.userAgent } satisfies svc.FamilyDeps };
}

const revalidate = () => revalidatePath("/app", "layout");
const toResult = (r: { ok: true } | svc.Fail, message: string): FamilyResult => (r.ok ? { ok: true, message } : { ok: false, error: r.error, ...(r.upgrade ? { upgrade: true } : {}) });
const wait = (sec: number) => (sec >= 3600 ? `${Math.ceil(sec / 3600)} h` : sec >= 60 ? `${Math.ceil(sec / 60)} min` : `${sec} s`);

/** Email d'invitation : texte sans révéler si l'adresse a déjà un compte (même message dans les deux cas). */
async function deliverInvitation(m: svc.InvitationMail): Promise<void> {
  const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim().slice(0, 60);
  const inviter = clean(m.inviterName);
  const house = clean(m.householdName);
  const body = actionEmail({
    title: `${inviter} vous invite à rejoindre un foyer`,
    intro: `${inviter} vous invite à rejoindre le foyer « ${house} » sur Mon Agent IA, avec le rôle « ${ROLE_LABEL[m.role]} ». Cette invitation est valable 7 jours et ne peut être utilisée qu'une seule fois.`,
    cta: "Rejoindre le foyer",
    url: `${env().APP_URL}/invite/${m.token}`,
    outro: "Si vous ne connaissez pas cette personne ou n'attendiez pas cette invitation, ignorez simplement cet email : sans action de votre part, rien ne se passe.",
  });
  await sendMail({ to: m.to, subject: `${inviter} vous invite sur Mon Agent IA`, ...body });
}

// ───────────────────────────── Foyer actif ─────────────────────────────

/** Change le foyer actif. L'identifiant reçu n'est qu'une demande : l'appartenance est vérifiée en base avant d'écrire le cookie. */
export async function switchHousehold(input: unknown): Promise<FamilyResult> {
  const p = z.object({ householdId: uuid }).safeParse(input);
  if (!p.success) return bad();
  const session = await requireSession();
  const tenant = await resolveTenant(db(), session.user.id, p.data.householdId);
  if (!tenant) return bad("Foyer introuvable.");
  (await cookies()).set(HOUSEHOLD_COOKIE, tenant.householdId, householdCookieOptions(env().APP_ENV));
  revalidate();
  return { ok: true };
}

export async function renameHousehold(input: unknown): Promise<FamilyResult> {
  const p = z.object({ name: z.string().trim().min(2, "Donnez un nom d'au moins 2 caractères.").max(60, "60 caractères au maximum.") }).safeParse(input);
  if (!p.success) return bad(p.error.issues[0]?.message);
  const c = await context();
  if (!c) return DENIED;
  const r = await svc.renameHousehold(c.deps, c.tenant, p.data);
  if (r.ok) revalidate();
  return toResult(r, "Foyer renommé.");
}

// ───────────────────────────── Invitations ─────────────────────────────

export async function inviteMember(input: unknown): Promise<FamilyResult> {
  const p = z.object({ email, role: z.enum(["READ", "WRITE", "ADMIN"]) }).safeParse(input);
  if (!p.success) return bad("Saisissez une adresse email valide et un rôle.");
  const c = await context();
  if (!c || !can(c.tenant.role, "member:invite")) return DENIED;

  // Chaque invitation envoie un email vers une adresse choisie par l'utilisateur : limites par expéditeur, foyer et destinataire.
  const L = limiters();
  for (const [limiter, key] of [
    [L.invite, `invite:u:${c.tenant.userId}`],
    [L.inviteHousehold, `invite:h:${c.tenant.householdId}`],
    [L.inviteRecipient, `invite:to:${hmac(p.data.email, c.e.HASH_PEPPER)}`],
  ] as const) {
    const lim = await limiter.check(key);
    if (!lim.allowed) return bad(`Trop d'invitations envoyées. Réessayez dans ${wait(lim.retryAfterSec)}.`);
  }

  const r = await svc.inviteMember({ ...c.deps, send: deliverInvitation }, c.tenant, p.data);
  if (r.ok) revalidate();
  return toResult(r, "Invitation envoyée. Elle est valable 7 jours.");
}

export async function resendInvitation(input: unknown): Promise<FamilyResult> {
  const p = z.object({ invitationId: uuid }).safeParse(input);
  if (!p.success) return bad();
  const c = await context();
  if (!c || !can(c.tenant.role, "member:invite")) return DENIED;
  const L = limiters();
  for (const [limiter, key] of [[L.invite, `invite:u:${c.tenant.userId}`], [L.inviteHousehold, `invite:h:${c.tenant.householdId}`]] as const) {
    const lim = await limiter.check(key);
    if (!lim.allowed) return bad(`Trop d'invitations envoyées. Réessayez dans ${wait(lim.retryAfterSec)}.`);
  }
  const r = await svc.resendInvitation({ ...c.deps, send: deliverInvitation }, c.tenant, p.data);
  if (r.ok) revalidate();
  return toResult(r, "Invitation renvoyée avec un nouveau lien.");
}

export async function revokeInvitation(input: unknown): Promise<FamilyResult> {
  const p = z.object({ invitationId: uuid }).safeParse(input);
  if (!p.success) return bad();
  const c = await context();
  if (!c) return DENIED;
  const r = await svc.revokeInvitation(c.deps, c.tenant, p.data);
  if (r.ok) revalidate();
  return toResult(r, "Invitation révoquée.");
}

/** Acceptation (page /invite/[token]). Le jeton est la seule preuve : l'email vérifié du compte doit correspondre à l'invitation. */
export async function acceptInvitation(input: unknown): Promise<FamilyResult> {
  const p = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }).safeParse(input);
  if (!p.success) return bad(svc.fail("INVALID_INVITE").error);
  const session = await requireSession();
  const e = env();
  const lim = await limiters().inviteAccept.check(`invite:accept:${session.user.id}`);
  if (!lim.allowed) return bad(`Trop de tentatives. Réessayez dans ${wait(lim.retryAfterSec)}.`);
  const info = clientInfo(await headers());
  const r = await svc.acceptInvitation(
    { db: db(), pepper: e.HASH_PEPPER, ip: info.ip, userAgent: info.userAgent },
    { id: session.user.id, email: session.user.email, emailVerified: session.user.emailVerified, name: session.user.name },
    p.data.token,
  );
  if (!r.ok) return { ok: false, error: r.error };
  // Bascule sur le foyer rejoint (le cookie est une préférence : l'appartenance vient d'être créée en base).
  (await cookies()).set(HOUSEHOLD_COOKIE, r.householdId, householdCookieOptions(e.APP_ENV));
  revalidate();
  return { ok: true, message: r.alreadyMember ? "Vous faisiez déjà partie de ce foyer." : `Bienvenue dans le foyer « ${r.householdName} ».` };
}

// ───────────────────────────── Membres ─────────────────────────────

export async function changeMemberRole(input: unknown): Promise<FamilyResult> {
  const p = z.object({ membershipId: uuid, role: z.enum(["OWNER", "ADMIN", "WRITE", "READ"]) }).safeParse(input);
  if (!p.success) return bad();
  const c = await context();
  if (!c) return DENIED;
  const r = await svc.changeMemberRole(c.deps, c.tenant, p.data);
  if (r.ok) revalidate();
  return toResult(r, r.ok && !r.changed ? "Rôle inchangé." : "Rôle mis à jour.");
}

export async function removeMember(input: unknown): Promise<FamilyResult> {
  const p = z.object({ membershipId: uuid }).safeParse(input);
  if (!p.success) return bad();
  const c = await context();
  if (!c) return DENIED;
  const r = await svc.removeMember(c.deps, c.tenant, p.data);
  if (r.ok) {
    // Une personne ne doit jamais se retrouver sans foyer : si c'était le sien, elle retrouve un foyer personnel vide.
    const left = await withUser(db(), r.userId, (tx) => tx.membership.count({ where: { userId: r.userId } }));
    if (left === 0) {
      try {
        await provisionHousehold(db(), { id: r.userId, name: r.name }, parseKek(c.e.KEK_BASE64, c.e.KEK_VERSION));
      } catch {
        console.error("[family] foyer de repli impossible à créer pour un membre retiré");
      }
    }
    revalidate();
  }
  return toResult(r, "Membre retiré du foyer.");
}

export async function leaveHousehold(): Promise<FamilyResult> {
  const c = await context();
  if (!c) return DENIED;
  const r = await svc.leaveHousehold(c.deps, c.tenant);
  if (r.ok) {
    (await cookies()).delete(HOUSEHOLD_COOKIE); // on retombe sur le premier foyer restant
    revalidate();
  }
  return toResult(r, "Vous avez quitté le foyer.");
}

// ───────────────────────────── Profils ─────────────────────────────

export async function addProfile(input: unknown): Promise<FamilyResult> {
  const p = z
    .object({ displayName: z.string().trim().min(1, "Saisissez un prénom.").max(60, "60 caractères au maximum."), relation: z.enum(["SPOUSE", "CHILD", "PARENT", "OTHER"]) })
    .safeParse(input);
  if (!p.success) return bad(p.error.issues[0]?.message);
  const c = await context();
  if (!c) return DENIED;
  const r = await svc.addProfile(c.deps, c.tenant, p.data);
  if (r.ok) revalidate();
  return toResult(r, "Profil ajouté.");
}

export async function archiveProfile(input: unknown): Promise<FamilyResult> {
  const p = z.object({ profileId: uuid }).safeParse(input);
  if (!p.success) return bad();
  const c = await context();
  if (!c) return DENIED;
  const r = await svc.archiveProfile(c.deps, c.tenant, p.data);
  if (r.ok) revalidate();
  return toResult(r, "Profil archivé.");
}
