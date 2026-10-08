import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env["APP_URL"] ?? "http://localhost:3000"),
  title: { default: "Mon Agent IA — Votre assistant administratif", template: "%s · Mon Agent IA" },
  description: "Mon Agent IA lit vos courriers, factures et contrats, suit vos échéances, prépare vos réponses et repère l'argent perdu.",
  openGraph: { title: "Mon Agent IA", description: "Votre assistant administratif, disponible 24h/24.", type: "website", locale: "fr_FR" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
