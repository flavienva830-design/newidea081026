import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { withTenant } from "@mon-agent-ia/db";
import { db } from "@/lib/db";
import { currentPlan } from "@/server/plan";
import { requireTenant } from "@/server/session";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "Bienvenue" };

export default async function OnboardingPage() {
  const { session, tenant } = await requireTenant();
  if (!session.user.emailVerified) redirect("/login");
  const user = await db().user.findUniqueOrThrow({ where: { id: session.user.id }, select: { onboardedAt: true, onboardingStep: true, name: true } });
  if (user.onboardedAt) redirect("/app");
  const { household, plan } = await withTenant(db(), tenant, async (tx) => ({
    household: await tx.household.findUniqueOrThrow({ where: { id: tenant.householdId }, select: { name: true } }),
    plan: await currentPlan(tx, tenant.householdId),
  }));
  return <OnboardingWizard initialStep={Math.min(user.onboardingStep, 3)} name={user.name} householdName={household.name} plan={plan} />;
}
