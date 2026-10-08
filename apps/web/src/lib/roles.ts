import type { MembershipRole } from "@mon-agent-ia/core";

/** Libellés français des rôles (interface et emails). Aucune logique de droits ici : voir `packages/core/src/rbac.ts`. */
export const ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: "Propriétaire",
  ADMIN: "Administrateur",
  WRITE: "Lecture et écriture",
  READ: "Lecture seule",
};

export const ROLE_HELP: Record<MembershipRole, string> = {
  OWNER: "Gère tout : abonnement, membres, données du foyer.",
  ADMIN: "Gère les membres et les profils, supprime des documents.",
  WRITE: "Ajoute et modifie des documents, des échéances et des actions.",
  READ: "Consulte uniquement : aucune modification possible.",
};

export const RELATION_LABEL: Record<string, string> = {
  SELF: "Moi",
  SPOUSE: "Conjoint ou conjointe",
  CHILD: "Enfant",
  PARENT: "Parent",
  OTHER: "Autre proche",
};
