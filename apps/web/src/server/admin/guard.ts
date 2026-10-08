import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authorizeStaff, type StaffDecision } from "@mon-agent-ia/core";
import { dbService } from "@/lib/db";
import { env } from "@/lib/env";
import { clientInfo } from "@/server/security";
import { getSession } from "@/server/session";

const SENSITIVE_MAX_AGE_MS = 4 * 3600_000;

export type StaffContext = { userId: string; email: string; role: "SUPPORT" | "ADMIN"; ip: string; userAgent: string | null };

/** Décision sans effet de bord (pour les Server Actions, qui répondent par un résultat plutôt qu'une redirection). */
export async function checkStaff(min: "SUPPORT" | "ADMIN", sensitive = false): Promise<{ decision: StaffDecision; ctx: StaffContext | null }> {
  const s = await getSession();
  if (!s) return { decision: { ok: false, reason: "not_staff" }, ctx: null };
  // Le rôle est relu en base à CHAQUE requête : jamais déduit de la session ni d'un cookie.
  const u = await dbService().user.findUnique({ where: { id: s.user.id }, select: { email: true, staffRole: true, bannedAt: true, emailVerified: true, twoFactorEnabled: true } });
  if (!u) return { decision: { ok: false, reason: "not_staff" }, ctx: null };
  const decision = authorizeStaff(u, { min, requireMfa: env().APP_ENV !== "dev", sessionCreatedAt: new Date(s.session.createdAt), now: new Date(), maxSessionAgeMs: sensitive ? SENSITIVE_MAX_AGE_MS : undefined });
  if (!decision.ok) return { decision, ctx: null };
  const info = clientInfo(await headers());
  return { decision, ctx: { userId: s.user.id, email: u.email, role: decision.role, ip: info.ip, userAgent: info.userAgent } };
}

/** Pour les pages : 404 si l'on n'est pas du personnel (le portail n'existe pas pour les autres), redirections utiles sinon. */
export async function requireStaff(min: "SUPPORT" | "ADMIN" = "SUPPORT"): Promise<StaffContext> {
  const { decision, ctx } = await checkStaff(min);
  if (decision.ok && ctx) return ctx;
  if (!decision.ok && decision.reason === "mfa_required") redirect("/app/settings/security?mfa=required");
  notFound();
}
