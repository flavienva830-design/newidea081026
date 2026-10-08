import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export function Footer() {
  const cols = [
    { title: "Produit", links: [["Fonctionnement", "/#fonctionnement"], ["Agent proactif", "/#agent"], ["Sécurité", "/#securite"], ["Tarifs", "/#tarifs"]] },
    { title: "Compte", links: [["Se connecter", "/login"], ["Créer un compte", "/signup"]] },
    { title: "Légal", links: [["Mentions légales", "/mentions-legales"], ["Confidentialité", "/confidentialite"], ["Conditions de vente", "/cgv"]] },
  ] as const;
  return (
    <footer className="hairline mt-32">
      <div className="container-x grid gap-12 py-16 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-[34ch] text-[14px] text-soft">L'assistant administratif des particuliers et des familles. Vos documents restent en Europe.</p>
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="text-[13px] font-medium">{c.title}</p>
            <ul className="mt-4 space-y-3">
              {c.links.map(([l, h]) => (
                <li key={h}><Link href={h} className="text-[14px] text-soft transition-colors hover:text-fg">{l}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="hairline">
        <div className="container-x flex flex-col justify-between gap-2 py-6 text-[12px] text-faint sm:flex-row">
          <p>© 2026 Mon Agent IA. Tous droits réservés.</p>
          <p>Mon Agent IA aide à comprendre et organiser vos démarches ; il ne fournit pas de conseil juridique ou fiscal.</p>
        </div>
      </div>
    </footer>
  );
}
