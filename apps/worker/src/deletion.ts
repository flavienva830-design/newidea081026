import { mrrCents } from "@mon-agent-ia/billing";
import type { Db } from "@mon-agent-ia/db";

export type DeletionDeps = {
  db: Db;
  now?: () => Date;
  /** Supprime le client chez le prestataire de paiement (annule l'abonnement). Une erreur reporte la purge : jamais d'abonnement orphelin. */
  deleteBillingCustomer?: (stripeCustomerId: string) => Promise<void>;
};

export type PurgeStats = { due: number; purged: number; failed: number };

/**
 * Exécute les suppressions de compte arrivées à échéance.
 *  - Foyer dont l'utilisateur est le seul membre : supprimé entièrement (cascade sur toutes ses données) + client Stripe supprimé.
 *  - Foyer partagé : l'utilisateur le quitte ; si c'était le dernier propriétaire, le plus ancien autre membre (administrateur d'abord) le devient.
 *  - L'utilisateur est supprimé (sessions, comptes, secrets 2FA, consentements, notifications en cascade).
 *  - Le journal d'audit n'est pas touché : il ne contient que des identifiants opaques, sans donnée personnelle.
 */
export async function purgeDueDeletions(deps: DeletionDeps): Promise<PurgeStats> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const due = await db.deletionRequest.findMany({ where: { status: "PENDING", scheduledFor: { lte: now } }, select: { id: true, userId: true } });
  const stats: PurgeStats = { due: due.length, purged: 0, failed: 0 };

  for (const req of due) {
    // Réservation : une seule instance traite une demande.
    const claimed = await db.deletionRequest.updateMany({ where: { id: req.id, status: "PENDING" }, data: { status: "PROCESSING" } });
    if (claimed.count === 0) continue;
    try {
      await purgeUser(deps, req.userId);
      stats.purged++;
    } catch {
      await db.deletionRequest.update({ where: { id: req.id }, data: { status: "PENDING", scheduledFor: new Date(now.getTime() + 3_600_000) } }); // réessai dans 1 h
      stats.failed++;
    }
  }
  return stats;
}

async function purgeUser(deps: DeletionDeps, userId: string): Promise<void> {
  const { db } = deps;
  const memberships = await db.membership.findMany({ where: { userId }, select: { householdId: true, role: true } });

  for (const m of memberships) {
    const others = await db.membership.findMany({ where: { householdId: m.householdId, userId: { not: userId } }, orderBy: { createdAt: "asc" }, select: { userId: true, role: true } });
    if (others.length === 0) {
      const billing = await db.billingSubscription.findUnique({ where: { householdId: m.householdId }, select: { stripeCustomerId: true, plan: true, status: true, interval: true, currentPeriodEnd: true } });
      if (billing && deps.deleteBillingCustomer) await deps.deleteBillingCustomer(billing.stripeCustomerId);
      // Le revenu disparaît avec le foyer : on le trace pour que le MRR historique reste exact.
      const mrr = billing ? mrrCents(billing, new Date()) : 0;
      if (billing && mrr > 0) {
        await db.billingHistory.create({ data: { householdId: m.householdId, fromPlan: billing.plan, toPlan: "FREE", fromStatus: billing.status, toStatus: "CANCELED", interval: billing.interval, mrrBeforeCents: mrr, mrrAfterCents: 0, reason: "account_deleted" } });
      }
      await db.household.delete({ where: { id: m.householdId } }); // cascade : tout ce que contient le foyer
    } else if (m.role === "OWNER") {
      const owners = await db.membership.count({ where: { householdId: m.householdId, role: "OWNER", userId: { not: userId } } });
      if (owners === 0) {
        const heir = others.find((o) => o.role === "ADMIN") ?? others.find((o) => o.role === "WRITE") ?? others[0]!;
        await db.membership.updateMany({ where: { householdId: m.householdId, userId: heir.userId }, data: { role: "OWNER" } });
      }
    }
  }

  await db.$transaction(async (tx) => {
    await tx.profile.updateMany({ where: { userId }, data: { userId: null, archivedAt: new Date() } }); // profil conservé sans lien d'identité
    await tx.document.updateMany({ where: { uploadedById: userId }, data: { uploadedById: null } });
    await tx.user.delete({ where: { id: userId } });
  });
}
