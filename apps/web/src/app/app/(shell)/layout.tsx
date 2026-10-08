import { redirect } from "next/navigation";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { db } from "@/lib/db";
import { requireTenant } from "@/server/session";
import { listHouseholds } from "@/server/tenant";
import { withTenant } from "@mon-agent-ia/db";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const { session, tenant } = await requireTenant();
  if (!session.user.emailVerified) redirect("/login");
  const me = await db().user.findUnique({ where: { id: session.user.id }, select: { onboardedAt: true } });
  if (!me?.onboardedAt) redirect("/app/onboarding");
  const household = await withTenant(db(), tenant, (tx) => tx.household.findUniqueOrThrow({ where: { id: tenant.householdId }, select: { name: true } }));
  const households = await listHouseholds(db(), session.user.id);

  return (
    <div className="flex min-h-dvh bg-white">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <Topbar name={session.user.name} email={session.user.email} householdName={household.name} households={households} activeHouseholdId={tenant.householdId} />
        <main className="px-5 py-8 sm:px-8 lg:px-12 lg:py-12">{children}</main>
      </div>
    </div>
  );
}
