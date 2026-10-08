import type { Metadata } from "next";

// Rendu dynamique (nonce CSP posé par le middleware) ; jamais indexé ; le jeton de l'URL n'est jamais transmis en Referer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invitation à un foyer", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <main>{children}</main>;
}
