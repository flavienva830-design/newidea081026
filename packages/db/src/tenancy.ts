import type { Db } from "./index.ts";
import type { Prisma } from "./generated/prisma/client.ts";

export type TenantContext = {
  userId: string;
  /** Foyer actif. L'appartenance de userId à ce foyer DOIT avoir été vérifiée avant l'appel. */
  householdId: string;
};

type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exécute `fn` dans une transaction dont le contexte RLS est positionné.
 * set_config(..., true) : portée limitée à la transaction, donc sans fuite entre
 * requêtes qui se partagent une même connexion du pool.
 */
export async function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.householdId)) throw new Error("householdId invalide");
  if (!ctx.userId) throw new Error("userId manquant");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true), set_config('app.household_id', ${ctx.householdId}, true)`;
    return fn(tx);
  });
}

/** Contexte utilisateur seul (ex. lister ses foyers avant d'en choisir un). */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId) throw new Error("userId manquant");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}
