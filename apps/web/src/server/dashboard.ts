import { withTenant, type Db } from "@mon-agent-ia/db";
import type { ActiveTenant } from "./tenant";

export type DashboardData = {
  documents: number;
  actionsToDo: number;
  deadlines30d: number;
  savingsAnnualCents: number;
  lettersGenerated: number;
  nextDeadlines: { id: string; title: string; dueDate: Date; amountCents: number | null }[];
  topActions: { id: string; title: string; rationale: string; priority: number }[];
};

/** Toutes les lectures passent par le contexte RLS du foyer actif. */
export async function loadDashboard(db: Db, tenant: ActiveTenant, now = new Date()): Promise<DashboardData> {
  const in30 = new Date(now.getTime() + 30 * 86_400_000);
  return withTenant(db, tenant, async (tx) => {
    const [documents, actionsToDo, deadlines30d, savings, lettersAgg, nextDeadlines, topActions] = await Promise.all([
      tx.document.count({ where: { deletedAt: null } }),
      tx.recommendedAction.count({ where: { status: { in: ["PROPOSED", "ACCEPTED", "IN_PROGRESS"] } } }),
      tx.deadline.count({ where: { status: "OPEN", dueDate: { gte: now, lte: in30 } } }),
      tx.saving.aggregate({ where: { status: { in: ["DETECTED", "ACCEPTED"] } }, _sum: { annualCents: true } }),
      tx.usageCounter.aggregate({ _sum: { lettersGenerated: true } }),
      tx.deadline.findMany({ where: { status: "OPEN", dueDate: { gte: now } }, orderBy: { dueDate: "asc" }, take: 4, select: { id: true, title: true, dueDate: true, amountCents: true } }),
      tx.recommendedAction.findMany({ where: { status: "PROPOSED" }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 4, select: { id: true, title: true, rationale: true, priority: true } }),
    ]);
    return { documents, actionsToDo, deadlines30d, savingsAnnualCents: savings._sum.annualCents ?? 0, lettersGenerated: lettersAgg._sum.lettersGenerated ?? 0, nextDeadlines, topActions };
  });
}
