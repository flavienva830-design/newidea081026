import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hasConsent } from "@/server/consent";
import { requireSession } from "@/server/session";
import { DataPanel } from "./data-panel";

export const metadata: Metadata = { title: "Mes données" };

export default async function DataPage() {
  const s = await requireSession();
  const [sensitive, ai, marketing, deletion] = await Promise.all([
    hasConsent(db(), s.user.id, ["SENSITIVE_DATA_PROCESSING"]),
    hasConsent(db(), s.user.id, ["AI_PROCESSING"]),
    hasConsent(db(), s.user.id, ["MARKETING_EMAIL"]),
    db().deletionRequest.findFirst({ where: { userId: s.user.id, status: { in: ["PENDING", "PROCESSING"] } }, select: { scheduledFor: true, status: true } }),
  ]);
  return <DataPanel consents={{ sensitive, ai, marketing }} deletion={deletion ? { at: deletion.scheduledFor.toISOString(), status: deletion.status } : null} />;
}
