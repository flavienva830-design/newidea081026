import { randomUUID } from "node:crypto";
import { withTenant, type Db } from "@mon-agent-ia/db";
import { generateDek, wrapDek, type Kek } from "@mon-agent-ia/core";

/**
 * Crée le foyer initial d'un nouvel utilisateur : clé de données propre, adhésion OWNER, profil « moi ».
 * Utilise le rôle applicatif (RLS) : le contexte est positionné sur le NOUVEAU foyer avant l'insertion.
 */
export async function provisionHousehold(db: Db, user: { id: string; name: string }, kek: Kek): Promise<string> {
  const householdId = randomUUID();
  const wrappedDek = new Uint8Array(wrapDek(generateDek(), kek, householdId));
  await withTenant(db, { userId: user.id, householdId }, async (tx) => {
    await tx.household.create({
      data: { id: householdId, name: `Foyer de ${user.name}`.slice(0, 80), wrappedDek, kekVersion: kek.version },
    });
    await tx.membership.create({ data: { householdId, userId: user.id, role: "OWNER" } });
    await tx.profile.create({ data: { householdId, userId: user.id, displayName: user.name, relation: "SELF" } });
  });
  return householdId;
}
