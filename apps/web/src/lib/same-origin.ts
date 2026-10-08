/**
 * Protection CSRF des routes d'API mutantes (les Server Actions Next.js la font déjà ; pas les Route Handlers).
 * L'en-tête Origin doit correspondre à l'URL de l'application ; un navigateur l'envoie toujours sur un POST inter-sites.
 */
export function isSameOrigin(req: Request, appUrl: string): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false; // un POST sans Origin n'est pas un navigateur légitime
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
