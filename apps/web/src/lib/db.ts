import "server-only";
import { createDb, type Db } from "@mon-agent-ia/db";
import { env } from "./env";

const g = globalThis as unknown as { __db?: Db; __dbService?: Db };

/** Client applicatif (rôle mai_app, soumis à la RLS). À utiliser avec withTenant / withUser. */
export function db(): Db {
  return (g.__db ??= createDb(env().DATABASE_URL));
}

/**
 * Client de service (rôle mai_service, contourne la RLS) : réservé aux opérations serveur
 * inter-foyers (création de foyer à l'inscription, webhooks, admin). Jamais exposé à une requête
 * dont l'identité n'a pas été vérifiée.
 */
export function dbService(): Db {
  const url = env().DATABASE_SERVICE_URL;
  if (!url) throw new Error("DATABASE_SERVICE_URL requis");
  return (g.__dbService ??= createDb(url));
}
