import type { Metadata } from "next";
import { RETENTION_DAYS, formatRetention } from "@mon-agent-ia/core";
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
        <li><strong>Documents que vous transférez : traités en mémoire le temps de l'analyse, jamais conservés.</strong> Ni le fichier, ni son texte, ni les courriers générés ne sont enregistrés. Ils peuvent contenir des données de santé ou financières : traitées uniquement avec votre <strong>consentement explicite</strong>.</li>
        <li>Données structurées issues de l'analyse, conservées pour vos rappels : organisme, nature du document, dates limites, montants, économies repérées. Jamais de numéro de compte, de carte ou de sécurité sociale. Vous pouvez les supprimer à tout moment.</li>
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
      <p>Minimisation par conception : aucun fichier ni texte de document n'est stocké. Données restantes hébergées dans l'Union européenne ; chiffrement en transit et au repos ; isolation stricte entre foyers ; journal d'audit ; aucun contenu de document dans les journaux techniques.</p>
      <h2>Intelligence artificielle</h2>
      <p>Le contenu de vos documents est transmis à un prestataire d'IA situé dans l'Union européenne uniquement pour produire votre analyse. Il n'est ni conservé par ce prestataire ni utilisé pour entraîner des modèles. [À confirmer contractuellement avec le prestataire retenu : conservation zéro et résidence des données dans l'Union européenne.]</p>
      <h2>Durée de conservation</h2>
      <p>Documents : aucune conservation (traitement en mémoire). Données structurées : jusqu'à leur suppression par vous ou la clôture de votre compte, puis effacement définitif à l'issue du délai de rétractation de 14 jours (ou immédiatement sur demande) ; les sauvegardes sont purgées sous [x] jours.</p>
      <p>Données d'exploitation, purgées automatiquement chaque nuit : historique de connexions, {formatRetention(RETENTION_DAYS.loginEvents)} (adresses IP et appareils conservés sous forme d'empreintes) ; appels techniques à l'IA, sans aucun contenu, {formatRetention(RETENTION_DAYS.aiRuns)} ; journal d'audit, {formatRetention(RETENTION_DAYS.auditLogs)} ; événements de paiement reçus, {formatRetention(RETENTION_DAYS.stripeEvents)} ; notifications, {formatRetention(RETENTION_DAYS.notificationsRead)} si lues et {formatRetention(RETENTION_DAYS.notificationsAny)} sinon ; invitations terminées, {formatRetention(RETENTION_DAYS.invitations)}.</p>
      <h2>Vos droits</h2>
      <p>Accès, rectification, effacement, limitation, portabilité, opposition et retrait du consentement : écrivez à [email]. Vous pouvez aussi saisir la CNIL (cnil.fr).</p>
      <h2>Sous-traitants</h2>
      <p>[Liste : hébergeur, base de données et stockage, prestataire d'IA, envoi d'emails, paiement, supervision d'erreurs — avec leur localisation et les garanties associées.]</p>
    </LegalPage>
  );
}
