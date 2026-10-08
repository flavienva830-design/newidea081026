import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Conditions générales de vente" };

export default function Page() {
  return (
    <LegalPage title="Conditions générales de vente" updated="8 octobre 2026">
      <h2>Offres et prix</h2>
      <p>Gratuit (0 €, 5 documents par mois), Solo (9,90 € TTC par mois ou 99 € TTC par an, 500 documents par mois) et Famille (19,90 € TTC par mois ou 199 € TTC par an, jusqu'à 5 profils). Les prix peuvent évoluer ; vous en êtes informé au moins [30] jours avant toute modification.</p>
      <h2>Abonnement et renouvellement</h2>
      <p>L'abonnement se renouvelle automatiquement à chaque échéance jusqu'à sa résiliation.</p>
      <h2>Résiliation</h2>
      <p>Vous pouvez résilier à tout moment depuis votre compte. L'accès reste ouvert jusqu'à la fin de la période déjà payée.</p>
      <h2>Droit de rétractation</h2>
      <p>Les consommateurs disposent de 14 jours à compter de la souscription. [Modalités de remboursement et d'exécution anticipée à préciser.]</p>
      <h2>Responsabilité</h2>
      <p>Les analyses automatiques peuvent comporter des erreurs. Mon Agent IA ne se substitue pas à un conseil professionnel. Aucun courrier n'est envoyé sans votre validation explicite. [Limitations de responsabilité à faire valider.]</p>
      <h2>Médiation et droit applicable</h2>
      <p>Droit français. [Médiateur de la consommation à indiquer.]</p>
    </LegalPage>
  );
}
