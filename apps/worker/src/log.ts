import { scrub } from "@mon-agent-ia/core";

/** Journal JSON structuré. Tout champ passe par `scrub` : jamais de contenu de document, d'email ni d'identifiant sensible. */
export function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(scrub(fields) as object) });
  (level === "error" ? console.error : console.log)(line);
}
