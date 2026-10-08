import type { PlanTier } from "@mon-agent-ia/core";
import type { Prisma } from "@mon-agent-ia/db";

/** Offre effective d'un foyer : abonnement actif ou en essai, sinon gratuit. Lecture via le contexte RLS du foyer. */
export async function currentPlan(tx: Prisma.TransactionClient, householdId: string): Promise<PlanTier> {
  const b = await tx.billingSubscription.findUnique({ where: { householdId }, select: { plan: true, status: true, currentPeriodEnd: true } });
  if (!b) return "FREE";
  const active = b.status === "ACTIVE" || b.status === "TRIALING" || (b.status === "PAST_DUE" && (b.currentPeriodEnd?.getTime() ?? 0) > Date.now());
  return active ? b.plan : "FREE";
}
