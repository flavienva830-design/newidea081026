/**
 * Durées de conservation des données d'EXPLOITATION (jamais de documents : ceux-ci ne sont pas conservés du tout).
 * Principe RGPD de limitation de la conservation : chaque catégorie a une durée, une raison, et une purge qui l'applique
 * (`apps/worker/src/retention.ts`). Source unique : le worker, le portail d'administration et la documentation en dépendent.
 * Les enregistrements structurés de l'utilisateur (échéances, économies…) ne sont pas ici : ils vivent jusqu'à ce qu'il les supprime.
 */
export const RETENTION_DAYS = {
  /** Connexions (empreintes d'adresse IP et d'appareil) : sécurité et détection d'abus. */
  loginEvents: 365,
  /** Appels IA (jetons, coût, latence, jamais de contenu) : suivi des coûts et de la fiabilité. */
  aiRuns: 730,
  /** Journal d'audit : preuve des actions sensibles. Plancher de 12 mois imposé par la base elle-même. */
  auditLogs: 730,
  /** Événements Stripe reçus : diagnostic des paiements (Stripe reste la référence comptable). */
  stripeEvents: 390,
  /** Notifications lues, puis toutes. */
  notificationsRead: 180,
  notificationsAny: 365,
  /** Rappels déjà traités (envoyés, annulés, échoués). */
  reminders: 90,
  /** Sessions expirées et jetons de vérification expirés. */
  sessions: 30,
  verifications: 7,
  /** Invitations terminées (acceptées, révoquées ou expirées) : elles contiennent l'adresse de l'invité. */
  invitations: 30,
  /** Demandes RGPD terminées (suppression annulée ou en échec, export). */
  privacyRequests: 365,
  /** Notes internes du support. */
  supportNotes: 730,
  /** Compteurs d'usage mensuels. */
  usageCounters: 730,
} as const;

export type RetentionKey = keyof typeof RETENTION_DAYS;

/** Durée lisible : « 7 jours », « 6 mois », « 24 mois ». */
export function formatRetention(days: number): string {
  return days >= 60 ? `${Math.round(days / 30.4)} mois` : `${days} jour${days > 1 ? "s" : ""}`;
}

/** Présentation de la politique (portail d'administration, documentation) : une ligne par catégorie purgée. */
export const RETENTION_POLICY: { keys: RetentionKey[]; label: string; why: string }[] = [
  { keys: ["loginEvents"], label: "Historique de connexions", why: "Sécurité et détection d'abus. Adresses IP et appareils sous forme d'empreintes, jamais en clair." },
  { keys: ["aiRuns"], label: "Appels IA (jetons, coût, latence)", why: "Suivi des coûts et de la fiabilité. Aucun contenu de document." },
  { keys: ["auditLogs"], label: "Journal d'audit", why: "Preuve des actions sensibles. Ajout seul : la base refuse toute suppression de moins de 12 mois." },
  { keys: ["stripeEvents"], label: "Événements de paiement reçus", why: "Diagnostic. Stripe reste la référence comptable." },
  { keys: ["notificationsRead", "notificationsAny"], label: "Notifications (lues, puis toutes)", why: "Confort d'usage ; elles reprennent des données structurées déjà visibles dans l'application." },
  { keys: ["reminders"], label: "Rappels déjà traités", why: "Diagnostic des envois. Un rappel à envoyer n'est jamais purgé." },
  { keys: ["sessions", "verifications"], label: "Sessions et jetons expirés", why: "Aucune utilité une fois expirés." },
  { keys: ["invitations"], label: "Invitations terminées", why: "Elles contiennent l'adresse e-mail de la personne invitée." },
  { keys: ["privacyRequests"], label: "Demandes RGPD terminées", why: "Traçabilité. Une suppression en attente n'est jamais purgée." },
  { keys: ["supportNotes"], label: "Notes internes du support", why: "Minimisation : des notes anciennes n'ont plus de raison d'être." },
  { keys: ["usageCounters"], label: "Compteurs d'usage mensuels", why: "Litiges de facturation." },
];
