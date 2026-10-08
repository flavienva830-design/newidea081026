import type { Metadata } from "next";
import { withTenant } from "@mon-agent-ia/db";
import { PLANS } from "@mon-agent-ia/core";
import { PageHead } from "@/components/app/page-bits";
import { db } from "@/lib/db";
import { currentPlan } from "@/server/plan";
import { requireTenant } from "@/server/session";
import { LetterForm } from "./letter-form";

export const metadata: Metadata = { title: "Courriers" };

const KINDS = new Set(["CANCELLATION", "CONTESTATION", "COMPLAINT", "REFUND_REQUEST", "FORMAL_NOTICE", "FREE"]);
const BY_ACTION: Record<string, string> = { CANCEL_CONTRACT: "CANCELLATION", CONTEST: "CONTESTATION", REQUEST_REFUND: "REFUND_REQUEST", FOLLOW_UP: "FREE", REPLY_REQUIRED: "FREE" };

export default async function LettersPage({ searchParams }: { searchParams: Promise<{ action?: string; kind?: string }> }) {
  const sp = await searchParams;
  const { session, tenant } = await requireTenant();
  const { plan, action } = await withTenant(db(), tenant, async (tx) => ({
    plan: await currentPlan(tx, tenant.householdId),
    action: sp.action && /^[0-9a-f-]{36}$/i.test(sp.action) ? await tx.recommendedAction.findUnique({ where: { id: sp.action }, select: { id: true, type: true, title: true, document: { select: { organization: true } } } }) : null,
  }));
  const kind = (action && BY_ACTION[action.type]) || (sp.kind && KINDS.has(sp.kind) ? sp.kind : "CANCELLATION");

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHead title="Courriers" subtitle="L'agent rédige un brouillon à partir de votre dossier. Vos coordonnées ne sont jamais envoyées à l'IA, et rien n'est conservé : téléchargez le courrier une fois relu." />
      <LetterForm
        defaultName={session.user.name}
        included={PLANS[plan].lettersPerMonth > 0}
        initial={{ kind, actionId: action?.id ?? null, organization: action?.document?.organization ?? "", topic: action?.title ?? "" }}
      />
    </div>
  );
}
