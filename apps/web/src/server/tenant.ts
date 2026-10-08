import { withUser, withTenant, type Db, type TenantContext } from "@mon-agent-ia/db";
import { can, type MembershipRole, type Permission, ForbiddenError } from "@mon-agent-ia/core";

export type ActiveTenant = TenantContext & { role: MembershipRole };

/**
 * Cookie du foyer actif. Il ne porte qu'une PRÉFÉRENCE (un identifiant de foyer) : il n'est jamais une preuve
 * d'appartenance. À chaque requête, l'appartenance de l'utilisateur au foyer demandé est revérifiée en base.
 */
export const HOUSEHOLD_COOKIE = "mai_hh";
const HOUSEHOLD_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 180;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valeur brute → identifiant de foyer d'allure valide (jamais autre chose), sinon `undefined`. */
export function parseHouseholdId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return UUID.test(v) ? v : undefined;
}

/** Lit le foyer préféré dans un en-tête `Cookie` brut (Route Handlers). Le premier cookie du nom l'emporte. */
export function householdIdFromCookieHeader(header: string | null | undefined): string | undefined {
  if (!header || header.length > 8192) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== HOUSEHOLD_COOKIE) continue;
    let raw = part.slice(eq + 1).trim();
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    return parseHouseholdId(raw);
  }
  return undefined;
}

/** Attributs du cookie : HttpOnly, SameSite=Lax, Secure hors développement, valable sur tout le site. */
export function householdCookieOptions(appEnv: string) {
  return { httpOnly: true, sameSite: "lax" as const, secure: appEnv !== "dev", path: "/", maxAge: HOUSEHOLD_COOKIE_MAX_AGE_SEC };
}

async function loadMemberships(db: Db, userId: string) {
  return withUser(db, userId, (tx) =>
    tx.membership.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { householdId: true, role: true } }),
  );
}

/**
 * Résout le foyer actif d'un utilisateur authentifié et son rôle.
 * Si `preferredHouseholdId` est fourni, l'appartenance est vérifiée (anti-IDOR) ; sinon le premier foyer.
 * Strict : un foyer demandé dont l'utilisateur n'est pas membre donne `null`.
 */
export async function resolveTenant(db: Db, userId: string, preferredHouseholdId?: string): Promise<ActiveTenant | null> {
  const memberships = await loadMemberships(db, userId);
  const m = preferredHouseholdId ? memberships.find((x) => x.householdId === preferredHouseholdId) : memberships[0];
  return m ? { userId, householdId: m.householdId, role: m.role } : null;
}

/**
 * Foyer actif à partir d'une PRÉFÉRENCE non fiable (cookie) : si l'utilisateur n'est pas (ou plus) membre du foyer
 * demandé — retrait, départ, cookie forgé —, on retombe sur son premier foyer plutôt que d'échouer.
 * Le rôle retourné est toujours celui lu en base, jamais celui d'une donnée client.
 */
export async function resolveActiveTenant(db: Db, userId: string, preferredHouseholdId?: string): Promise<ActiveTenant | null> {
  const memberships = await loadMemberships(db, userId);
  const m = (preferredHouseholdId && memberships.find((x) => x.householdId === preferredHouseholdId)) || memberships[0];
  return m ? { userId, householdId: m.householdId, role: m.role } : null;
}

export type HouseholdChoice = { id: string; name: string; role: MembershipRole };

/** Foyers de l'utilisateur (sélecteur de foyer). Lecture via le contexte utilisateur : uniquement SES foyers. */
export async function listHouseholds(db: Db, userId: string): Promise<HouseholdChoice[]> {
  const rows = await withUser(db, userId, (tx) =>
    tx.membership.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { role: true, household: { select: { id: true, name: true } } },
    }),
  );
  return rows.map((r) => ({ id: r.household.id, name: r.household.name, role: r.role }));
}

/** Exécute une opération métier après vérification de la permission du rôle. */
export async function withPermission<T>(
  db: Db,
  tenant: ActiveTenant,
  permission: Permission,
  fn: Parameters<typeof withTenant<T>>[2],
): Promise<T> {
  if (!can(tenant.role, permission)) throw new ForbiddenError(permission);
  return withTenant(db, tenant, fn);
}
