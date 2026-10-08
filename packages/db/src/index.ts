import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "./generated/prisma/client.ts";

export * from "./generated/prisma/client.ts";
export { Prisma };
export { withTenant, withUser, type TenantContext } from "./tenancy.ts";

export type Db = PrismaClient;

/**
 * Crée un client Prisma.
 * - `DATABASE_URL`  : rôle applicatif `mai_app`, soumis à la RLS (requêtes web).
 * - `DATABASE_SERVICE_URL` : rôle `mai_service` (worker, webhooks, admin) : accès inter-foyers.
 */
export function createDb(connectionString: string): Db {
  if (!connectionString) throw new Error("connectionString manquant pour createDb");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
