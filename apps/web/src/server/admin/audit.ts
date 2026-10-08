import type { Db } from "@mon-agent-ia/db";
import { audit } from "@/server/audit";
import { escapeLike } from "./like";

export type AuditCursor = { at: Date; id: string };
export type AuditFilter = { action?: string; householdId?: string; actorId?: string; before?: AuditCursor };
const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Curseur de page dans l'URL : « date-ISO_identifiant ». Toute valeur mal formée est ignorée (retour à la première page). */
export const encodeCursor = (c: AuditCursor) => `${c.at.toISOString()}_${c.id}`;
export function decodeCursor(v: string | undefined): AuditCursor | undefined {
  const [iso, id] = (v ?? "").split("_");
  if (!iso || !id || !UUID.test(id) || Number.isNaN(Date.parse(iso))) return undefined;
  return { at: new Date(iso), id };
}

/**
 * Journal d'audit paginé : 50 lignes par page, du plus récent au plus ancien.
 * Curseur sur (date, identifiant) : plusieurs lignes peuvent partager la même milliseconde sans qu'aucune soit perdue ni dupliquée.
 */
export async function listAudit(db: Db, f: AuditFilter) {
  const rows = await db.auditLog.findMany({
    where: {
      ...(f.action ? { action: { startsWith: escapeLike(f.action.slice(0, 60)) } } : {}),
      ...(f.householdId && UUID.test(f.householdId) ? { householdId: f.householdId } : {}),
      ...(f.actorId ? { actorId: f.actorId.slice(0, 80) } : {}),
      ...(f.before ? { OR: [{ createdAt: { lt: f.before.at } }, { createdAt: f.before.at, id: { lt: f.before.id } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1,
    select: { id: true, createdAt: true, actorId: true, householdId: true, action: true, targetType: true, targetId: true, metadata: true },
  });
  const more = rows.length > PAGE;
  const page = more ? rows.slice(0, PAGE) : rows;
  const last = page[page.length - 1];
  return { rows: page, next: more && last ? { at: last.createdAt, id: last.id } : null };
}

export async function securitySummary(db: Db, now: Date) {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [failed, suspicious, recent] = await Promise.all([
    db.loginEvent.count({ where: { success: false, createdAt: { gte: since } } }),
    db.loginEvent.count({ where: { suspicious: true, createdAt: { gte: since } } }),
    db.loginEvent.findMany({ where: { suspicious: true, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, country: true, riskReasons: true, user: { select: { id: true, email: true } } } }),
  ]);
  return { failed, suspicious, recent };
}

const VIEW_WINDOW_MS = 2 * 60_000;

/**
 * Consultation d'une fiche personnelle : tracée (qui, quelle personne, quand), sans doublon pour les rechargements rapprochés
 * (chaque action du portail rafraîchit la page : sans cela, une seule intervention laisserait une dizaine de lignes identiques).
 */
export async function recordUserView(db: Db, input: { actorId: string; targetId: string; ip?: string }, pepper: string, now = new Date()): Promise<boolean> {
  const recent = await db.auditLog.findFirst({
    where: { actorId: input.actorId, action: "admin.user.view", targetId: input.targetId, createdAt: { gte: new Date(now.getTime() - VIEW_WINDOW_MS) } },
    select: { id: true },
  });
  if (recent) return false;
  await audit(db, { actorId: input.actorId, action: "admin.user.view", targetType: "user", targetId: input.targetId, ip: input.ip }, pepper);
  return true;
}
