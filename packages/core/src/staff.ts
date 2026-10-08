import type { StaffRole } from "./rbac.ts";

export type StaffUser = { staffRole: StaffRole; bannedAt: Date | null; emailVerified: boolean; twoFactorEnabled: boolean };
export type StaffDecision = { ok: true; role: "SUPPORT" | "ADMIN" } | { ok: false; reason: "not_staff" | "mfa_required" | "insufficient" | "stale" };

/**
 * Décision d'accès au portail d'administration. Refus par défaut.
 *  - `not_staff` est aussi renvoyé pour un compte banni ou non vérifié : la page répond 404, l'existence du portail n'est pas révélée ;
 *  - la double authentification est exigée hors développement ;
 *  - les actions qui modifient quelque chose exigent une connexion récente (`maxSessionAgeMs`).
 */
export function authorizeStaff(
  user: StaffUser,
  opts: { min: "SUPPORT" | "ADMIN"; requireMfa: boolean; sessionCreatedAt: Date; now: Date; maxSessionAgeMs?: number },
): StaffDecision {
  if (user.staffRole === "NONE" || user.bannedAt || !user.emailVerified) return { ok: false, reason: "not_staff" };
  if (opts.requireMfa && !user.twoFactorEnabled) return { ok: false, reason: "mfa_required" };
  if (opts.min === "ADMIN" && user.staffRole !== "ADMIN") return { ok: false, reason: "insufficient" };
  if (opts.maxSessionAgeMs !== undefined && opts.now.getTime() - opts.sessionCreatedAt.getTime() > opts.maxSessionAgeMs) return { ok: false, reason: "stale" };
  return { ok: true, role: user.staffRole };
}
