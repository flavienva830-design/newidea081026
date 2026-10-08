import { PLANS, can, canAssignRole, canRemoveOrDemote, checkProfileQuota, hmac, randomToken, type MembershipRole, type PlanTier } from "@mon-agent-ia/core";
import { withTenant, withUser, type Db, type Prisma } from "@mon-agent-ia/db";
import { audit, type AuditEntry } from "./audit";
import { currentPlan } from "./plan";
import type { ActiveTenant } from "./tenant";

/**
 * Espace Famille : membres, rôles, invitations, profils.
 *
 * Toutes les règles sont appliquées ICI, côté serveur, indépendamment de l'interface (qui masque seulement les
 * boutons). Chaque opération qui modifie les membres :
 *  - relit le rôle de l'acteur DANS la transaction (un rôle périmé issu du début de requête ne sert à rien) ;
 *  - verrouille la ligne du foyer (`FOR NO KEY UPDATE`) : les changements de membres d'un même foyer sont sérialisés,
 *    ce qui rend sûrs « dernier propriétaire », quotas de places et usage unique d'une invitation sous concurrence ;
 *  - filtre TOUJOURS explicitement par `householdId` : sous RLS, un membre voit aussi ses propres adhésions des autres
 *    foyers (politique `membership_by_user`), donc un filtre implicite ne suffirait pas.
 */

type Tx = Prisma.TransactionClient;

export const INVITE_TTL_MS = 7 * 86_400_000;
/** Un jeton d'invitation (32 octets en base64url) : forme vérifiée avant tout accès à la base. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;
export const isInviteToken = (t: string) => TOKEN_SHAPE.test(t);

export type FamilyDeps = {
  db: Db;
  pepper: string;
  now?: () => Date;
  /** Contexte de la requête, utilisé pour l'audit uniquement. */
  ip?: string;
  userAgent?: string | null;
};

export type InvitationMail = { to: string; token: string; householdName: string; inviterName: string; role: MembershipRole; expiresAt: Date };
export type InviteDeps = FamilyDeps & { send: (mail: InvitationMail) => Promise<void> };

export type FailCode =
  | "FORBIDDEN" | "NOT_FOUND" | "SELF" | "ROLE_RANK" | "LAST_OWNER" | "LAST_HOUSEHOLD"
  | "PLAN" | "QUOTA" | "DUPLICATE" | "ALREADY_MEMBER" | "INVALID_INVITE" | "WRONG_EMAIL" | "MAIL_FAILED";
export type Fail = { ok: false; code: FailCode; error: string; /** Le message invite à passer à l'offre Famille. */ upgrade?: boolean };
export type Outcome<T extends object = Record<never, never>> = ({ ok: true } & T) | Fail;

const MESSAGES: Record<FailCode, string> = {
  FORBIDDEN: "Vous n'avez pas le droit d'effectuer cette action.",
  NOT_FOUND: "Élément introuvable.",
  SELF: "Vous ne pouvez pas modifier votre propre rôle.",
  ROLE_RANK: "Vous ne pouvez attribuer ou modifier qu'un rôle strictement inférieur au vôtre.",
  LAST_OWNER: "Un foyer doit conserver au moins un propriétaire. Nommez d'abord un autre propriétaire.",
  LAST_HOUSEHOLD: "C'est votre seul foyer : vous ne pouvez pas le quitter. Pour fermer votre espace, supprimez votre compte depuis Paramètres > Mes données.",
  PLAN: "L'invitation de membres est incluse dans l'offre Famille.",
  QUOTA: "Le foyer a atteint le nombre de personnes inclus dans son offre.",
  DUPLICATE: "Une invitation est déjà en attente pour cette adresse. Vous pouvez la renvoyer depuis la liste.",
  ALREADY_MEMBER: "Cette personne fait déjà partie du foyer.",
  INVALID_INVITE: "Cette invitation n'est plus valable. Demandez à la personne qui vous a invité de vous en envoyer une nouvelle.",
  WRONG_EMAIL: "Cette invitation est destinée à une autre adresse email. Connectez-vous avec l'adresse qui a reçu l'invitation.",
  MAIL_FAILED: "L'email n'a pas pu être envoyé. Réessayez dans un instant.",
};
export const fail = (code: FailCode, error?: string, upgrade?: boolean): Fail => ({ ok: false, code, error: error ?? MESSAGES[code], ...(upgrade ? { upgrade } : {}) });

const nowOf = (deps: FamilyDeps) => (deps.now ?? (() => new Date()))();

/** Verrou de foyer : sérialise les changements de membres, sans bloquer les insertions ordinaires (clés étrangères). */
const lockHousehold = (tx: Tx, householdId: string) => tx.$queryRaw`SELECT "id" FROM "households" WHERE "id" = ${householdId}::uuid FOR NO KEY UPDATE`;

/** Rôle ACTUEL de l'acteur dans ce foyer (relu en base, dans la transaction verrouillée). */
async function actorRole(tx: Tx, tenant: ActiveTenant): Promise<MembershipRole | null> {
  const m = await tx.membership.findFirst({ where: { householdId: tenant.householdId, userId: tenant.userId }, select: { role: true } });
  return m?.role ?? null;
}

const record = (deps: FamilyDeps, tenant: ActiveTenant, action: string, extra: Partial<AuditEntry> = {}) =>
  audit(deps.db, { actorId: tenant.userId, householdId: tenant.householdId, action, ip: deps.ip, userAgent: deps.userAgent, ...extra }, deps.pepper);

/** Tentative contraire aux règles de hiérarchie : refusée ET tracée (détection d'abus). */
const recordDenied = (deps: FamilyDeps, tenant: ActiveTenant, op: string, rule: string, extra: Record<string, string | number | boolean | null> = {}) =>
  record(deps, tenant, "member.denied", { metadata: { op, rule, ...extra } });

// ───────────────────────────── Places (membres, profils, invitations) ─────────────────────────────

export type Seats = { plan: PlanTier; members: number; externals: number; pending: number; used: number; limit: number };

/**
 * « Places » du foyer : membres (comptes) + profils sans compte + invitations en attente non expirées.
 * Une invitation en attente RÉSERVE sa place ; sinon on pourrait inviter plus de personnes que l'offre n'en inclut.
 * La limite est `PLANS[plan].profiles` (Famille : 5), alignée sur la rétrogradation (le paquet billing compte tous les profils).
 */
export async function seatState(tx: Tx, householdId: string, now: Date, excludeInvitationId?: string): Promise<Seats> {
  const plan = await currentPlan(tx, householdId);
  const members = await tx.membership.count({ where: { householdId } });
  const externals = await tx.profile.count({ where: { householdId, archivedAt: null, userId: null } });
  const pending = await tx.invitation.count({
    where: { householdId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now }, ...(excludeInvitationId ? { id: { not: excludeInvitationId } } : {}) },
  });
  return { plan, members, externals, pending, used: members + externals + pending, limit: PLANS[plan].profiles };
}

/** Contrôle d'offre et de places pour AJOUTER une personne (invitation ou profil). `null` = autorisé. */
function seatFailure(s: Seats, what: "invite" | "profile"): Fail | null {
  if (!PLANS[s.plan].features.family) {
    return fail("PLAN", what === "invite" ? "L'invitation de membres est incluse dans l'offre Famille." : "Les profils supplémentaires sont inclus dans l'offre Famille.", true);
  }
  if (!checkProfileQuota(s.plan, s.used).allowed) {
    return fail("QUOTA", `Votre offre inclut ${s.limit} personnes (membres, profils et invitations en attente) : le foyer est complet. Révoquez une invitation ou archivez un profil pour libérer une place.`);
  }
  return null;
}

// ───────────────────────────── Lecture ─────────────────────────────

export type FamilyView = {
  me: { userId: string; role: MembershipRole };
  household: { id: string; name: string };
  plan: PlanTier;
  familyIncluded: boolean;
  seats: { used: number; limit: number };
  members: { membershipId: string; userId: string; name: string; email: string; role: MembershipRole; joinedAt: Date; isYou: boolean }[];
  invitations: { id: string; email: string; role: MembershipRole; createdAt: Date; expiresAt: Date; expired: boolean }[];
  profiles: { id: string; displayName: string; relation: string }[];
};

export async function loadFamily(db: Db, tenant: ActiveTenant, now = new Date()): Promise<FamilyView> {
  const { householdId } = tenant;
  return withTenant(db, tenant, async (tx) => {
    const seats = await seatState(tx, householdId, now);
    const household = await tx.household.findUniqueOrThrow({ where: { id: householdId }, select: { id: true, name: true } });
    const members = await tx.membership.findMany({
      where: { householdId },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, role: true, createdAt: true, user: { select: { name: true, email: true } } },
    });
    // Les invitations (adresses email des invités) ne sont montrées qu'à ceux qui peuvent inviter.
    const invitations = can(tenant.role, "member:invite")
      ? await tx.invitation.findMany({
          where: { householdId, acceptedAt: null, revokedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
        })
      : [];
    const profiles = await tx.profile.findMany({
      where: { householdId, archivedAt: null, userId: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, displayName: true, relation: true },
    });
    return {
      me: { userId: tenant.userId, role: tenant.role },
      household,
      plan: seats.plan,
      familyIncluded: PLANS[seats.plan].features.family,
      seats: { used: seats.used, limit: seats.limit },
      members: members.map((m) => ({ membershipId: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, joinedAt: m.createdAt, isYou: m.userId === tenant.userId })),
      invitations: invitations.map((i) => ({ ...i, expired: i.expiresAt <= now })),
      profiles,
    };
  });
}

/** Personnes auxquelles on peut rattacher un document : tous les profils actifs du foyer (membres et sans compte). */
export async function listPeople(db: Db, tenant: ActiveTenant): Promise<{ id: string; label: string; isYou: boolean }[]> {
  const rows = await withTenant(db, tenant, (tx) =>
    tx.profile.findMany({ where: { householdId: tenant.householdId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, displayName: true, userId: true } }),
  );
  return rows.map((r) => ({ id: r.id, label: r.displayName, isYou: r.userId === tenant.userId }));
}

// ───────────────────────────── Rôles et retraits ─────────────────────────────

export async function changeMemberRole(deps: FamilyDeps, tenant: ActiveTenant, input: { membershipId: string; role: MembershipRole }): Promise<Outcome<{ changed: boolean }>> {
  if (!can(tenant.role, "member:set_role")) return fail("FORBIDDEN");
  const r = await withTenant(deps.db, tenant, async (tx) => {
    await lockHousehold(tx, tenant.householdId);
    const me = await actorRole(tx, tenant);
    if (!me || !can(me, "member:set_role")) return fail("FORBIDDEN");
    const target = await tx.membership.findFirst({ where: { id: input.membershipId, householdId: tenant.householdId }, select: { id: true, userId: true, role: true } });
    if (!target) return fail("NOT_FOUND", "Membre introuvable.");
    const isSelf = target.userId === tenant.userId;
    if (isSelf) return { ...fail("SELF"), rule: "SELF", from: target.role };
    // On n'attribue qu'un rôle strictement inférieur au sien (OWNER : tous), et on ne touche qu'à un membre que l'on pourrait aussi nommer.
    if (!canAssignRole(me, input.role, isSelf) || !canAssignRole(me, target.role, isSelf)) return { ...fail("ROLE_RANK"), rule: "ROLE_RANK", from: target.role };
    if (target.role === input.role) return { ok: true as const, changed: false };
    if (target.role === "OWNER") {
      const owners = await tx.membership.count({ where: { householdId: tenant.householdId, role: "OWNER" } });
      if (!canRemoveOrDemote(owners, target.role)) return { ...fail("LAST_OWNER"), rule: "LAST_OWNER", from: target.role };
    }
    await tx.membership.update({ where: { id: target.id }, data: { role: input.role } });
    await tx.notification.create({
      data: { userId: target.userId, householdId: tenant.householdId, type: "member_role_changed", title: "Votre rôle dans le foyer a changé", body: `Vous avez maintenant le rôle « ${ROLE_NAMES[input.role]} ».` },
    });
    return { ok: true as const, changed: true, targetUserId: target.userId, from: target.role };
  });
  if (!r.ok) {
    if ("rule" in r) await recordDenied(deps, tenant, "role_change", String(r.rule), { to: input.role, from: "from" in r ? String(r.from) : null });
    return fail(r.code, r.error);
  }
  if (r.changed && "targetUserId" in r) {
    await record(deps, tenant, "member.role_changed", { targetType: "user", targetId: r.targetUserId, metadata: { from: String(r.from), to: input.role } });
  }
  return { ok: true, changed: r.changed };
}

const ROLE_NAMES: Record<MembershipRole, string> = { OWNER: "Propriétaire", ADMIN: "Administrateur", WRITE: "Lecture et écriture", READ: "Lecture seule" };

/** Détache un membre d'un foyer : adhésion supprimée, son profil est archivé et délié (même règle que la suppression de compte). */
async function detach(tx: Tx, householdId: string, membershipId: string, userId: string, now: Date) {
  await tx.membership.delete({ where: { id: membershipId } });
  await tx.profile.updateMany({ where: { householdId, userId }, data: { userId: null, archivedAt: now } });
}

export async function removeMember(deps: FamilyDeps, tenant: ActiveTenant, input: { membershipId: string }): Promise<Outcome<{ userId: string; name: string }>> {
  if (!can(tenant.role, "member:remove")) return fail("FORBIDDEN");
  const now = nowOf(deps);
  const r = await withTenant(deps.db, tenant, async (tx) => {
    await lockHousehold(tx, tenant.householdId);
    const me = await actorRole(tx, tenant);
    if (!me || !can(me, "member:remove")) return fail("FORBIDDEN");
    const target = await tx.membership.findFirst({
      where: { id: input.membershipId, householdId: tenant.householdId },
      select: { id: true, userId: true, role: true, user: { select: { name: true } } },
    });
    if (!target) return fail("NOT_FOUND", "Membre introuvable.");
    if (target.userId === tenant.userId) return fail("SELF", "Pour vous retirer vous-même, utilisez « Quitter le foyer ».");
    // Un administrateur ne peut retirer ni un autre administrateur ni un propriétaire : seulement un rôle strictement inférieur.
    if (!canAssignRole(me, target.role, false)) return { ...fail("ROLE_RANK", "Vous ne pouvez retirer qu'un membre dont le rôle est inférieur au vôtre."), rule: "ROLE_RANK", from: target.role };
    if (target.role === "OWNER") {
      const owners = await tx.membership.count({ where: { householdId: tenant.householdId, role: "OWNER" } });
      if (!canRemoveOrDemote(owners, target.role)) return { ...fail("LAST_OWNER", "Le dernier propriétaire ne peut pas être retiré du foyer."), rule: "LAST_OWNER", from: target.role };
    }
    const household = await tx.household.findUnique({ where: { id: tenant.householdId }, select: { name: true } });
    await detach(tx, tenant.householdId, target.id, target.userId, now);
    // Sans householdId : l'ancien membre n'a plus accès à ce foyer, la notification ne doit pas en dépendre.
    await tx.notification.create({ data: { userId: target.userId, type: "member_removed", title: "Vous avez été retiré d'un foyer", body: `Vous ne faites plus partie du foyer « ${household?.name ?? ""} ».`.slice(0, 200) } });
    return { ok: true as const, userId: target.userId, name: target.user.name, from: target.role };
  });
  if (!r.ok) {
    if ("rule" in r) await recordDenied(deps, tenant, "remove", String(r.rule), { from: "from" in r ? String(r.from) : null });
    return fail(r.code, r.error);
  }
  await record(deps, tenant, "member.removed", { targetType: "user", targetId: r.userId, metadata: { role: String(r.from) } });
  return { ok: true, userId: r.userId, name: r.name };
}

/** Quitter un foyer. Impossible pour le dernier propriétaire, ou si c'est le dernier foyer de la personne. */
export async function leaveHousehold(deps: FamilyDeps, tenant: ActiveTenant): Promise<Outcome> {
  const now = nowOf(deps);
  const mine = await withUser(deps.db, tenant.userId, (tx) => tx.membership.count({ where: { userId: tenant.userId } }));
  if (mine < 2) return fail("LAST_HOUSEHOLD");
  const r = await withTenant(deps.db, tenant, async (tx) => {
    await lockHousehold(tx, tenant.householdId);
    const me = await tx.membership.findFirst({ where: { householdId: tenant.householdId, userId: tenant.userId }, select: { id: true, role: true } });
    if (!me) return fail("NOT_FOUND", "Vous ne faites pas partie de ce foyer.");
    if (me.role === "OWNER") {
      const owners = await tx.membership.count({ where: { householdId: tenant.householdId, role: "OWNER" } });
      if (!canRemoveOrDemote(owners, me.role)) {
        return { ...fail("LAST_OWNER", "Vous êtes le dernier propriétaire de ce foyer : nommez d'abord un autre propriétaire avant de le quitter."), rule: "LAST_OWNER" };
      }
    }
    await detach(tx, tenant.householdId, me.id, tenant.userId, now);
    return { ok: true as const, role: me.role };
  });
  if (!r.ok) {
    if ("rule" in r) await recordDenied(deps, tenant, "leave", String(r.rule));
    return fail(r.code, r.error);
  }
  await record(deps, tenant, "member.left", { targetType: "user", targetId: tenant.userId, metadata: { role: r.role } });
  return { ok: true };
}

// ───────────────────────────── Invitations ─────────────────────────────

type MailNames = { householdName: string; inviterName: string };

async function mailNames(tx: Tx, tenant: ActiveTenant): Promise<MailNames> {
  const household = await tx.household.findUnique({ where: { id: tenant.householdId }, select: { name: true } });
  const inviter = await tx.user.findUnique({ where: { id: tenant.userId }, select: { name: true } });
  return { householdName: household?.name ?? "Foyer", inviterName: inviter?.name?.trim() || "Un proche" };
}

/** Création d'une invitation. Le jeton n'existe qu'ici et dans l'email : seule son empreinte est stockée. */
export async function inviteMember(deps: InviteDeps, tenant: ActiveTenant, input: { email: string; role: Exclude<MembershipRole, "OWNER"> }): Promise<Outcome<{ invitationId: string; expiresAt: Date }>> {
  if (!can(tenant.role, "member:invite")) return fail("FORBIDDEN");
  const email = input.email.trim().toLowerCase();
  const now = nowOf(deps);
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  const r = await withTenant(deps.db, tenant, async (tx) => {
    await lockHousehold(tx, tenant.householdId);
    const me = await actorRole(tx, tenant);
    if (!me || !can(me, "member:invite")) return fail("FORBIDDEN");
    if (!canAssignRole(me, input.role, false)) return { ...fail("ROLE_RANK", "Vous ne pouvez inviter qu'avec un rôle inférieur au vôtre."), rule: "ROLE_RANK" };

    // Déjà membre ? Réponse possible sans fuite : l'acteur voit déjà la liste des membres du foyer.
    const member = await tx.membership.findFirst({ where: { householdId: tenant.householdId, user: { email: { equals: email, mode: "insensitive" } } }, select: { id: true } });
    if (member) return fail("ALREADY_MEMBER");

    // Une invitation expirée mais non révoquée est révoquée avant d'en créer une autre (unicité en base : une seule en attente).
    await tx.invitation.updateMany({
      where: { householdId: tenant.householdId, email: { equals: email, mode: "insensitive" }, acceptedAt: null, revokedAt: null, expiresAt: { lte: now } },
      data: { revokedAt: now },
    });
    const pending = await tx.invitation.findFirst({ where: { householdId: tenant.householdId, email: { equals: email, mode: "insensitive" }, acceptedAt: null, revokedAt: null }, select: { id: true } });
    if (pending) return fail("DUPLICATE");

    const blocked = seatFailure(await seatState(tx, tenant.householdId, now), "invite");
    if (blocked) return blocked;

    const inv = await tx.invitation.create({
      data: { householdId: tenant.householdId, email, role: input.role, tokenHash: hmac(token, deps.pepper), invitedById: tenant.userId, expiresAt },
      select: { id: true },
    });
    return { ok: true as const, invitationId: inv.id, ...(await mailNames(tx, tenant)) };
  });
  if (!r.ok) {
    if ("rule" in r) await recordDenied(deps, tenant, "invite", String(r.rule), { role: input.role });
    return fail(r.code, r.error, r.upgrade);
  }

  try {
    await deps.send({ to: email, token, householdName: r.householdName, inviterName: r.inviterName, role: input.role, expiresAt });
  } catch {
    // Aucune invitation fantôme : sans email envoyé, l'invitation est révoquée (elle ne réserve plus de place).
    await withTenant(deps.db, tenant, (tx) => tx.invitation.updateMany({ where: { id: r.invitationId, householdId: tenant.householdId, acceptedAt: null, revokedAt: null }, data: { revokedAt: nowOf(deps) } }));
    return fail("MAIL_FAILED");
  }
  await record(deps, tenant, "invitation.created", { targetType: "invitation", targetId: r.invitationId, metadata: { role: input.role } });
  return { ok: true, invitationId: r.invitationId, expiresAt };
}

/** Renvoi : nouveau jeton (l'ancien lien cesse immédiatement de fonctionner) et nouvelle échéance de 7 jours. */
export async function resendInvitation(deps: InviteDeps, tenant: ActiveTenant, input: { invitationId: string }): Promise<Outcome<{ expiresAt: Date }>> {
  if (!can(tenant.role, "member:invite")) return fail("FORBIDDEN");
  const now = nowOf(deps);
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  const r = await withTenant(deps.db, tenant, async (tx) => {
    await lockHousehold(tx, tenant.householdId);
    const me = await actorRole(tx, tenant);
    if (!me || !can(me, "member:invite")) return fail("FORBIDDEN");
    const inv = await tx.invitation.findFirst({ where: { id: input.invitationId, householdId: tenant.householdId, acceptedAt: null, revokedAt: null }, select: { id: true, email: true, role: true } });
    if (!inv) return fail("NOT_FOUND", "Invitation introuvable.");
    if (!canAssignRole(me, inv.role, false)) return { ...fail("ROLE_RANK", "Vous ne pouvez gérer que les invitations dont le rôle est inférieur au vôtre."), rule: "ROLE_RANK" };
    // L'invitation reprend (ou garde) sa place : on vérifie l'offre et les places SANS la compter deux fois.
    const blocked = seatFailure(await seatState(tx, tenant.householdId, now, inv.id), "invite");
    if (blocked) return blocked;
    await tx.invitation.update({ where: { id: inv.id }, data: { tokenHash: hmac(token, deps.pepper), expiresAt } });
    return { ok: true as const, email: inv.email, role: inv.role, invitationId: inv.id, ...(await mailNames(tx, tenant)) };
  });
  if (!r.ok) {
    if ("rule" in r) await recordDenied(deps, tenant, "resend", String(r.rule));
    return fail(r.code, r.error, r.upgrade);
  }
  try {
    await deps.send({ to: r.email, token, householdName: r.householdName, inviterName: r.inviterName, role: r.role, expiresAt });
  } catch {
    return fail("MAIL_FAILED"); // le nouveau jeton n'a pas été remis : l'utilisateur peut simplement réessayer « Renvoyer »
  }
  await record(deps, tenant, "invitation.resent", { targetType: "invitation", targetId: r.invitationId });
  return { ok: true, expiresAt };
}

export async function revokeInvitation(deps: FamilyDeps, tenant: ActiveTenant, input: { invitationId: string }): Promise<Outcome> {
  if (!can(tenant.role, "member:invite")) return fail("FORBIDDEN");
  const now = nowOf(deps);
  const r = await withTenant(deps.db, tenant, async (tx) => {
    await lockHousehold(tx, tenant.householdId);
    const me = await actorRole(tx, tenant);
    if (!me || !can(me, "member:invite")) return fail("FORBIDDEN");
    const inv = await tx.invitation.findFirst({ where: { id: input.invitationId, householdId: tenant.householdId, acceptedAt: null, revokedAt: null }, select: { id: true, role: true } });
    if (!inv) return fail("NOT_FOUND", "Invitation introuvable.");
    if (!canAssignRole(me, inv.role, false)) return { ...fail("ROLE_RANK", "Vous ne pouvez gérer que les invitations dont le rôle est inférieur au vôtre."), rule: "ROLE_RANK" };
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: now } });
    return { ok: true as const, invitationId: inv.id };
  });
  if (!r.ok) {
    if ("rule" in r) await recordDenied(deps, tenant, "revoke", String(r.rule));
    return fail(r.code, r.error);
  }
  await record(deps, tenant, "invitation.revoked", { targetType: "invitation", targetId: r.invitationId });
  return { ok: true };
}

// ───────────────────────────── Acceptation (côté invité) ─────────────────────────────

export type InvitationRow = {
  id: string; householdId: string; householdName: string; email: string; role: MembershipRole; invitedById: string;
  expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null;
};

/**
 * Retrouve une invitation par son jeton (hachée ici). Passe par `invitation_lookup`, fonction SQL SECURITY DEFINER
 * étroite : avant l'adhésion, la RLS par foyer ne permet pas de lire `invitations`, et on ne donne pas le rôle de
 * service au processus web pour cela. Seule une empreinte exacte donne une ligne.
 */
export async function lookupInvitation(db: Db, token: string, pepper: string): Promise<InvitationRow | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const rows = await db.$queryRaw<InvitationRow[]>`SELECT * FROM invitation_lookup(${hmac(token, pepper)})`;
  return rows[0] ?? null;
}

export type InviteUser = { id: string; email: string; emailVerified: boolean; name: string };
const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const usable = (row: InvitationRow, now: Date) => !row.acceptedAt && !row.revokedAt && row.expiresAt.getTime() > now.getTime();

export type InviteView =
  | { state: "invalid" }
  | { state: "wrong_email" }
  | { state: "already_member"; householdName: string }
  | { state: "ok"; householdName: string; role: MembershipRole };

/** Ce que la page d'invitation peut montrer. Jeton inconnu, expiré, révoqué ou déjà utilisé : un seul et même état. */
export async function previewInvitation(deps: FamilyDeps, user: InviteUser, token: string): Promise<InviteView> {
  const row = await lookupInvitation(deps.db, token, deps.pepper);
  if (!row || !usable(row, nowOf(deps))) return { state: "invalid" };
  // L'adresse invitée n'est jamais révélée : on dit seulement qu'elle ne correspond pas.
  if (!user.emailVerified || !sameEmail(row.email, user.email)) return { state: "wrong_email" };
  const already = await withUser(deps.db, user.id, (tx) => tx.membership.findFirst({ where: { userId: user.id, householdId: row.householdId }, select: { id: true } }));
  if (already) return { state: "already_member", householdName: row.householdName };
  return { state: "ok", householdName: row.householdName, role: row.role };
}

/**
 * Accepte une invitation. Une seule transaction, sous le verrou du foyer :
 *  jeton valide + non révoqué + non utilisé + non expiré, email vérifié identique, offre et places disponibles,
 *  puis adhésion + profil + invitation consommée. Deux acceptations simultanées : la seconde voit l'invitation
 *  déjà consommée (mise à jour conditionnelle) et échoue.
 */
export async function acceptInvitation(deps: FamilyDeps, user: InviteUser, token: string): Promise<Outcome<{ householdId: string; householdName: string; alreadyMember: boolean }>> {
  const now = nowOf(deps);
  const row = await lookupInvitation(deps.db, token, deps.pepper);
  if (!row || !usable(row, now)) return fail("INVALID_INVITE");
  if (!user.emailVerified || !sameEmail(row.email, user.email)) return fail("WRONG_EMAIL");

  const ctx = { userId: user.id, householdId: row.householdId };
  const out = await withTenant(deps.db, ctx, async (tx) => {
    await lockHousehold(tx, row.householdId);
    const live = await tx.invitation.findFirst({
      where: { id: row.id, tokenHash: hmac(token, deps.pepper), acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, role: true, invitedById: true },
    });
    if (!live) return fail("INVALID_INVITE");

    const existing = await tx.membership.findFirst({ where: { householdId: row.householdId, userId: user.id }, select: { id: true } });
    if (existing) {
      // Déjà membre : l'invitation est consommée, le rôle actuel ne change jamais (ni promotion ni rétrogradation par ce biais).
      await tx.invitation.update({ where: { id: live.id }, data: { acceptedAt: now } });
      return { ok: true as const, joined: false, role: live.role, invitedById: live.invitedById, invitationId: live.id };
    }

    // L'offre a pu changer depuis l'envoi : on revérifie, sans consommer l'invitation en cas de refus.
    const blocked = seatFailure(await seatState(tx, row.householdId, now, live.id), "invite");
    if (blocked) return fail(blocked.code, "Ce foyer ne peut pas accueillir de nouveau membre pour le moment. Contactez la personne qui vous a invité.");

    const claimed = await tx.invitation.updateMany({ where: { id: live.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } });
    if (claimed.count !== 1) return fail("INVALID_INVITE");

    await tx.membership.create({ data: { householdId: row.householdId, userId: user.id, role: live.role } });
    const hasProfile = await tx.profile.findFirst({ where: { householdId: row.householdId, userId: user.id }, select: { id: true } });
    if (!hasProfile) await tx.profile.create({ data: { householdId: row.householdId, userId: user.id, displayName: (user.name.trim() || "Membre").slice(0, 60), relation: "SELF" } });
    // L'invitant a pu supprimer son compte depuis l'envoi (l'invitation appartient au foyer, pas à lui) : sans compte, pas de notification.
    const inviter = await tx.user.findUnique({ where: { id: live.invitedById }, select: { id: true } });
    if (inviter) {
      await tx.notification.create({
        data: { userId: inviter.id, householdId: row.householdId, type: "member_joined", title: `${(user.name.trim() || "Une personne").slice(0, 60)} a rejoint le foyer`, body: `Rôle : ${ROLE_NAMES[live.role]}.` },
      });
    }
    return { ok: true as const, joined: true, role: live.role, invitedById: live.invitedById, invitationId: live.id };
  });
  if (!out.ok) return out;

  const actor = { actorId: user.id, householdId: row.householdId, ip: deps.ip, userAgent: deps.userAgent };
  await audit(deps.db, { ...actor, action: "invitation.accepted", targetType: "invitation", targetId: out.invitationId, metadata: { role: out.role, joined: out.joined } }, deps.pepper);
  if (out.joined) await audit(deps.db, { ...actor, action: "member.joined", targetType: "user", targetId: user.id, metadata: { role: out.role } }, deps.pepper);
  return { ok: true, householdId: row.householdId, householdName: row.householdName, alreadyMember: !out.joined };
}

// ───────────────────────────── Profils (personnes sans compte) ─────────────────────────────

export type ProfileRelationInput = "SPOUSE" | "CHILD" | "PARENT" | "OTHER";

export async function addProfile(deps: FamilyDeps, tenant: ActiveTenant, input: { displayName: string; relation: ProfileRelationInput }): Promise<Outcome<{ profileId: string }>> {
  if (!can(tenant.role, "member:invite")) return fail("FORBIDDEN");
  const now = nowOf(deps);
  const r = await withTenant(deps.db, tenant, async (tx) => {
    await lockHousehold(tx, tenant.householdId);
    const me = await actorRole(tx, tenant);
    if (!me || !can(me, "member:invite")) return fail("FORBIDDEN");
    const blocked = seatFailure(await seatState(tx, tenant.householdId, now), "profile");
    if (blocked) return blocked;
    const p = await tx.profile.create({ data: { householdId: tenant.householdId, displayName: input.displayName.trim(), relation: input.relation }, select: { id: true } });
    return { ok: true as const, profileId: p.id };
  });
  if (!r.ok) return fail(r.code, r.error, r.upgrade);
  await record(deps, tenant, "profile.created", { targetType: "profile", targetId: r.profileId, metadata: { relation: input.relation } });
  return { ok: true, profileId: r.profileId };
}

/** Archive un profil SANS compte (les profils des membres suivent l'adhésion). Réversible côté données : rien n'est supprimé. */
export async function archiveProfile(deps: FamilyDeps, tenant: ActiveTenant, input: { profileId: string }): Promise<Outcome> {
  if (!can(tenant.role, "member:invite")) return fail("FORBIDDEN");
  const now = nowOf(deps);
  const r = await withTenant(deps.db, tenant, async (tx) => {
    await lockHousehold(tx, tenant.householdId);
    const me = await actorRole(tx, tenant);
    if (!me || !can(me, "member:invite")) return fail("FORBIDDEN");
    const res = await tx.profile.updateMany({ where: { id: input.profileId, householdId: tenant.householdId, userId: null, archivedAt: null }, data: { archivedAt: now } });
    return res.count === 1 ? { ok: true as const } : fail("NOT_FOUND", "Profil introuvable.");
  });
  if (!r.ok) return r;
  await record(deps, tenant, "profile.archived", { targetType: "profile", targetId: input.profileId });
  return { ok: true };
}

// ───────────────────────────── Foyer ─────────────────────────────

export async function renameHousehold(deps: FamilyDeps, tenant: ActiveTenant, input: { name: string }): Promise<Outcome> {
  // Propriétaire ou administrateur (volontairement explicite, indépendant de la matrice des permissions).
  if (tenant.role !== "OWNER" && tenant.role !== "ADMIN") return fail("FORBIDDEN");
  const r = await withTenant(deps.db, tenant, async (tx) => {
    const me = await actorRole(tx, tenant);
    if (me !== "OWNER" && me !== "ADMIN") return fail("FORBIDDEN");
    await tx.household.update({ where: { id: tenant.householdId }, data: { name: input.name.trim() } });
    return { ok: true as const };
  });
  if (!r.ok) return r;
  await record(deps, tenant, "household.renamed", { targetType: "household", targetId: tenant.householdId });
  return { ok: true };
}
