import { NextResponse, type NextRequest } from "next/server";

const isDev = process.env.NODE_ENV !== "production";

/** Cookie de session Better Auth (préfixe « mai », variante __Secure- en HTTPS). Simple test de présence : léger pour l'Edge. */
const hasSessionCookie = (req: NextRequest) => req.cookies.has("mai.session_token") || req.cookies.has("__Secure-mai.session_token");

/**
 * CSP.
 *  - Zones authentifiées et formulaires : nonce par requête + 'strict-dynamic' (aucun script inline non autorisé).
 *  - Pages marketing statiques : pas de contenu utilisateur ni de session ; 'unsafe-inline' sur les scripts est
 *    toléré pour permettre la génération statique (CDN, TTFB), tout le reste reste verrouillé.
 */
function csp(nonce: string | null): string {
  const script = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`
    : `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`;
  return [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com" + (isDev ? " ws:" : ""),
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const secured = pathname.startsWith("/app") || pathname.startsWith("/admin");

  // Garde de première ligne (présence du cookie). La vraie vérification a lieu côté serveur dans chaque layout/action.
  if (secured && !hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  const dynamicZone = secured || ["/login", "/signup", "/forgot-password", "/reset-password", "/invite"].some((p) => pathname.startsWith(p));
  const nonce = dynamicZone ? btoa(crypto.randomUUID()) : null;
  const policy = csp(nonce);

  const requestHeaders = new Headers(req.headers);
  if (nonce) requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", policy);
  if (secured) res.headers.set("cache-control", "private, no-store");
  return res;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|webp|woff2?)$).*)"],
};
