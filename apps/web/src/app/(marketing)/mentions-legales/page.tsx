import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Mentions légales" };

export default function Page() {
  return (
    <LegalPage title="Mentions légales" updated="8 octobre 2026">
      <h2>Éditeur</h2>
      <p>[Raison sociale], [forme juridique] au capital de [montant] €, immatriculée sous le numéro [SIREN], dont le siège est situé [adresse]. Contact : [email].</p>
      <h2>Directeur de la publication</h2>
      <p>[Nom et qualité].</p>
      <h2>Hébergement</h2>
      <p>[Hébergeur de l'application], [adresse], situé dans l'Union européenne. Base de données et fichiers : [fournisseur et région].</p>
      <h2>Nature du service</h2>
      <p>Mon Agent IA est un outil d'organisation et d'aide à la rédaction. Il ne fournit <strong>aucun conseil juridique, fiscal ou financier</strong>. Les analyses sont produites automatiquement et peuvent comporter des erreurs : l'utilisateur reste responsable de ses démarches et valide chaque courrier avant envoi.</p>
      <h2>Propriété intellectuelle</h2>
      <p>La marque, le site et ses contenus sont protégés. Toute reproduction non autorisée est interdite.</p>
    </LegalPage>
  );
}
