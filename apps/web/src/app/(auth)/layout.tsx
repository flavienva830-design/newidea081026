// Rendu dynamique : permet à Next d'appliquer le nonce CSP posé par le middleware.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main>{children}</main>;
}
