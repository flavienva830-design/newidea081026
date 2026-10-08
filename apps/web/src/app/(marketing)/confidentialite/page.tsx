import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function Page() {
  return (
    <LegalPage title="Politique de confidentialité" updated="8 octobre 2026">
      <h2>Responsable du traitement</h2>
      <p>[Raison sociale], [adresse]. Contact protection des données : [email du DPO ou référent].</p>
      <h2>Données traitées</h2>
      <ul>
        <li>Compte : nom, adresse email, mot de passe (stocké sous forme hachée), journal de connexion (adresse IP pseudonymisée, pays, appareil).</li>
        <li>Documents que vous transférez et informations qui en sont extraites. Ils peuvent contenir des données de santé ou financières : traitées uniquement avec votre <strong>consentement explicite</strong>.</li>
        <li>Facturation : gérée par notre prestataire de paiement ; nous ne stockons pas vos données bancaires.</li>
      </ul>
      <h2>Finalités et bases légales</h2>
      <ul>
        <li>Fournir le service (exécution du contrat) : analyse, rappels, courriers.</li>
        <li>Sécurité et prévention de la fraude (intérêt légitime).</li>
        <li>Traitement de données sensibles et par IA (consentement, retirable à tout moment).</li>
        <li>Actualités du produit (consentement, facultatif).</li>
      </ul>
      <h2>Sécurité</h2>
      <p>Données hébergées dans l'Union européenne ; chiffrement en transit et au repos ; une clé de chiffrement propre à chaque foyer ; isolation stricte entre foyers ; journal d'audit.</p>
      <h2>Intelligence artificielle</h2>
      <p>Le contenu de vos documents est transmis à un prestataire d'IA situé dans l'Union européenne uniquement pour produire votre analyse. Il n'est ni conservé par ce prestataire ni utilisé pour entraîner des modèles. [À confirmer contractuellement avec le prestataire retenu.]</p>
      <h2>Durée de conservation</h2>
      <p>Pendant la durée de votre compte, puis suppression sous [x] jours après sa clôture. Journaux de sécurité : [durée].</p>
      <h2>Vos droits</h2>
      <p>Accès, rectification, effacement, limitation, portabilité, opposition et retrait du consentement : écrivez à [email]. Vous pouvez aussi saisir la CNIL (cnil.fr).</p>
      <h2>Sous-traitants</h2>
      <p>[Liste : hébergeur, base de données et stockage, prestataire d'IA, envoi d'emails, paiement, supervision d'erreurs — avec leur localisation et les garanties associées.]</p>
    </LegalPage>
  );
}
