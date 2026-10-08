/** Redirection interne uniquement : jamais d'URL externe ni de schéma (anti open-redirect). */
export function safeNext(n: string | null | undefined, fallback = "/app"): string {
  if (!n) return fallback;
  if (!n.startsWith("/") || n.startsWith("//") || n.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(n)) return fallback;
  return n;
}
