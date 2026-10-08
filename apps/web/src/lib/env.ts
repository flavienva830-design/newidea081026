import "server-only";
import { loadEnv, type Env } from "@mon-agent-ia/config";

let cached: Env | undefined;

/** Environnement validé (échec immédiat à la première utilisation côté serveur). */
export function env(): Env {
  return (cached ??= loadEnv());
}
