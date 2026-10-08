export type MembershipRole = "OWNER" | "ADMIN" | "WRITE" | "READ";
export type StaffRole = "NONE" | "SUPPORT" | "ADMIN";

export const PERMISSIONS = [
  "document:read",
  "document:write",
  "document:delete",
  "letter:read",
  "letter:write",
  "letter:validate",
  "deadline:write",
  "action:write",
  "member:read",
  "member:invite",
  "member:remove",
  "member:set_role",
  "billing:manage",
  "household:delete",
  "data:export",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = ["document:read", "letter:read", "member:read"];
const WRITE: Permission[] = [...READ, "document:write", "letter:write", "deadline:write", "action:write"];
const ADMIN: Permission[] = [...WRITE, "document:delete", "letter:validate", "member:invite", "member:remove"];
const OWNER: Permission[] = [...ADMIN, "member:set_role", "billing:manage", "household:delete", "data:export"];

const MATRIX: Record<MembershipRole, ReadonlySet<Permission>> = {
  READ: new Set(READ),
  WRITE: new Set(WRITE),
  ADMIN: new Set(ADMIN),
  OWNER: new Set(OWNER),
};

/** Refus par défaut : un rôle inconnu n'a aucun droit. */
export function can(role: MembershipRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.has(permission) ?? false;
}

export function assertCan(role: MembershipRole | null | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: string) {
    super("Accès refusé");
    this.name = "ForbiddenError";
  }
}

const ROLE_RANK: Record<MembershipRole, number> = { READ: 0, WRITE: 1, ADMIN: 2, OWNER: 3 };

/**
 * Anti-élévation de privilèges : on ne peut attribuer ou modifier qu'un rôle STRICTEMENT inférieur
 * au sien (sauf OWNER, qui peut nommer un autre OWNER), et jamais soi-même.
 */
export function canAssignRole(actor: MembershipRole, target: MembershipRole, actorIsTarget: boolean): boolean {
  if (actorIsTarget) return false;
  if (!can(actor, "member:set_role") && !can(actor, "member:invite")) return false;
  if (actor === "OWNER") return true;
  return ROLE_RANK[target] < ROLE_RANK[actor];
}

/** Le dernier OWNER d'un foyer ne peut être ni rétrogradé ni retiré. */
export function canRemoveOrDemote(currentOwners: number, targetRole: MembershipRole): boolean {
  return !(targetRole === "OWNER" && currentOwners <= 1);
}

export function staffCan(role: StaffRole, action: "read_users" | "read_billing" | "impersonate_readonly" | "manage"): boolean {
  if (role === "ADMIN") return true;
  if (role === "SUPPORT") return action === "read_users" || action === "impersonate_readonly";
  return false;
}
