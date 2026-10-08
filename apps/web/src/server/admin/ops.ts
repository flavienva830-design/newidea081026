import type { Db } from "@mon-agent-ia/db";
import { hmac } from "@mon-agent-ia/core";
import { audit } from "@/server/audit";

/**
 * Opérations d'administration (logique pure, testable) : l'autorisation est vérifiée par l'appelant (`actions.ts`).
 * Chaque opération est journalisée avec son auteur et son motif ; aucun contenu, aucune donnée de paiement.
 */
export type OpsCtx = { userId: string; ip?: string; userAgent?: string | null; pepper: string };
export type AdminResult = { ok: true; message?: string } | { ok: false; error: string };

async function log(db: Db, ctx: OpsCtx, action: string, targetType: string, targetId: string, metadata: Record<string, string | number | boolean | null> = {}) {
  await audit(db, { actorId: ctx.userId, action, targetType, targetId, ip: ctx.ip, userAgent: ctx.userAgent, metadata }, ctx.pepper);
}

export async function banUserOp(db: Db, ctx: OpsCtx, input: { id: string; reason: string }): Promise<AdminResult> {
  if (input.id === ctx.userId) return { ok: false, error: "Vous ne pouvez pas suspendre votre propre compte." };
  const target = await db.user.findUnique({ where: { id: input.id }, select: { staffRole: true } });
  if (!target) return { ok: false, error: "Utilisateur introuvable." };
  if (target.staffRole === "ADMIN") return { ok: false, error: "Un administrateur ne peut pas être suspendu depuis le portail." };
  await db.user.update({ where: { id: input.id }, data: { bannedAt: new Date() } });
  const sessions = await db.session.deleteMany({ where: { userId: input.id } });
  await log(db, ctx, "admin.user.ban", "user", input.id, { reason: input.reason, sessionsRevoked: sessions.count });
  return { ok: true, message: "Compte suspendu et sessions fermées." };
}

export async function unbanUserOp(db: Db, ctx: OpsCtx, input: { id: string; reason: string }): Promise<AdminResult> {
  const r = await db.user.updateMany({ where: { id: input.id, bannedAt: { not: null } }, data: { bannedAt: null } });
  if (r.count === 0) return { ok: false, error: "Ce compte n'est pas suspendu." };
  await log(db, ctx, "admin.user.unban", "user", input.id, { reason: input.reason });
  return { ok: true, message: "Compte réactivé." };
}

export async function revokeSessionsOp(db: Db, ctx: OpsCtx, input: { id: string; reason: string }): Promise<AdminResult> {
  const r = await db.session.deleteMany({ where: { userId: input.id } });
  await log(db, ctx, "admin.user.revoke_sessions", "user", input.id, { reason: input.reason, count: r.count });
  return { ok: true, message: `${r.count} session(s) fermée(s).` };
}

export async function addNoteOp(db: Db, ctx: OpsCtx, input: { id: string; body: string }): Promise<AdminResult> {
  if (!(await db.user.findUnique({ where: { id: input.id }, select: { id: true } }))) return { ok: false, error: "Utilisateur introuvable." };
  await db.supportNote.create({ data: { userId: input.id, authorId: ctx.userId, body: input.body } });
  await log(db, ctx, "admin.note.add", "user", input.id);
  return { ok: true };
}

export async function updateDeletionOp(db: Db, ctx: OpsCtx, input: { id: string; action: "execute_now" | "cancel"; reason: string }): Promise<AdminResult> {
  const req = await db.deletionRequest.findUnique({ where: { id: input.id }, select: { userId: true, status: true } });
  if (!req || req.status !== "PENDING") return { ok: false, error: "Demande introuvable ou déjà en cours." };
  if (input.action === "execute_now") await db.deletionRequest.update({ where: { id: input.id }, data: { scheduledFor: new Date() } });
  else {
    await db.deletionRequest.update({ where: { id: input.id }, data: { status: "CANCELLED" } });
    await db.user.update({ where: { id: req.userId }, data: { deletionRequestedAt: null } });
  }
  await log(db, ctx, `admin.deletion.${input.action}`, "deletion_request", input.id, { reason: input.reason });
  return { ok: true, message: input.action === "execute_now" ? "Suppression avancée : le worker l'exécute dans la minute." : "Suppression annulée." };
}

/** Pseudonyme court et stable d'un foyer pour l'affichage (le portail ne montre pas d'identifiant complet quand ce n'est pas utile). */
export const shortId = (id: string) => id.slice(0, 8);
export { hmac };
