import { withUser, withTenant, type Db, type TenantContext } from "@mon-agent-ia/db";
import { can, type MembershipRole, type Permission, ForbiddenError } from "@mon-agent-ia/core";

export type ActiveTenant = TenantContext & { role: MembershipRole };

/**
 * Résout le foyer actif d'un utilisateur authentifié et son rôle.
 * Si `preferredHouseholdId` est fourni, l'appartenance est vérifiée (anti-IDOR) ; sinon le premier foyer.
 */
export async function resolveTenant(db: Db, userId: string, preferredHouseholdId?: string): Promise<ActiveTenant | null> {
  const memberships = await withUser(db, userId, (tx) =>
    tx.membership.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { householdId: true, role: true } }),
  );
  const m = preferredHouseholdId ? memberships.find((x) => x.householdId === preferredHouseholdId) : memberships[0];
  return m ? { userId, householdId: m.householdId, role: m.role } : null;
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
