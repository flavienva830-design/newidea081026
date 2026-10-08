"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { can } from "@mon-agent-ia/core";
import { hmac } from "@mon-agent-ia/core";
import { withTenant } from "@mon-agent-ia/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "./audit";
import { requireSession, requireTenant } from "./session";
import { clientInfo } from "./security";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

const GRACE_DAYS = 14;
const FRESH_MS = 15 * 60 * 1000;

/** Opérations irréversibles : exigent une connexion récente (re-vérification d'identité). */
const stale: Result = { ok: false, error: "Pour votre sécurité, reconnectez-vous avant cette opération (connexion de moins de 15 minutes)." };
const isFresh = (createdAt: Date | string) => Date.now() - new Date(createdAt).getTime() < FRESH_MS;

const CONSENT_TYPES = ["SENSITIVE_DATA_PROCESSING", "AI_PROCESSING", "MARKETING_EMAIL"] as const;

/** Accorde ou retire un consentement. Chaque décision est une nouvelle ligne : l'historique est conservé comme preuve. */
export async function setConsent(input: unknown): Promise<Result> {
  const p = z.object({ type: z.enum(CONSENT_TYPES), granted: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Demande invalide." };
  const s = await requireSession();
  const info = clientInfo(await headers());
  const pepper = env().HASH_PEPPER;
  await db().consent.create({ data: { userId: s.user.id, type: p.data.type, granted: p.data.granted, version: "2026-10", ipHash: hmac(info.ip, pepper) } });
  await audit(db(), { actorId: s.user.id, action: p.data.granted ? "consent.granted" : "consent.withdrawn", metadata: { type: p.data.type } }, pepper);
  revalidatePath("/app/settings/data");
  return { ok: true };
}

/** Efface toutes les données analysées du foyer (documents, échéances, rappels, économies, actions, étiquettes). Garde le compte. */
export async function eraseHouseholdRecords(input: unknown): Promise<Result> {
  if (!z.object({ confirm: z.literal("EFFACER") }).safeParse(input).success) return { ok: false, error: "Saisissez EFFACER pour confirmer." };
  const { session, tenant } = await requireTenant();
  if (!can(tenant.role, "household:delete")) return { ok: false, error: "Seul le propriétaire du foyer peut effacer ses données." };
  if (!isFresh(session.session.createdAt)) return stale;
  const info = clientInfo(await headers());
  const counts = await withTenant(db(), tenant, async (tx) => {
    const reminders = await tx.reminder.deleteMany({});
    const deadlines = await tx.deadline.deleteMany({});
    const savings = await tx.saving.deleteMany({});
    const actions = await tx.recommendedAction.deleteMany({});
    await tx.documentTag.deleteMany({});
    const documents = await tx.document.deleteMany({});
    await tx.tag.deleteMany({});
    await tx.detectedSubscription.deleteMany({});
    return { documents: documents.count, deadlines: deadlines.count, savings: savings.count, actions: actions.count, reminders: reminders.count };
  });
  await audit(db(), { actorId: tenant.userId, householdId: tenant.householdId, action: "household.records_erased", ip: info.ip, metadata: counts }, env().HASH_PEPPER);
  revalidatePath("/app", "layout");
  return { ok: true, message: `${counts.documents} document(s) et leurs données associées ont été effacés.` };
}

/** Demande la suppression du compte : à échéance (délai de réflexion) ou immédiate. Le worker exécute la purge. */
export async function requestAccountDeletion(input: unknown): Promise<Result> {
  const p = z.object({ confirm: z.literal("SUPPRIMER"), immediate: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Saisissez SUPPRIMER pour confirmer." };
  const s = await requireSession();
  if (!isFresh(s.session.createdAt)) return stale;
  const info = clientInfo(await headers());
  const pepper = env().HASH_PEPPER;
  const scheduledFor = new Date(Date.now() + (p.data.immediate ? 0 : GRACE_DAYS * 86_400_000));
  try {
    await db().deletionRequest.create({ data: { userId: s.user.id, scheduledFor } });
  } catch {
    return { ok: false, error: "Une demande de suppression est déjà en cours." }; // index unique : une seule demande active
  }
  await db().user.update({ where: { id: s.user.id }, data: { deletionRequestedAt: new Date() } });
  await audit(db(), { actorId: s.user.id, action: "account.deletion_requested", ip: info.ip, metadata: { immediate: p.data.immediate } }, pepper);
  revalidatePath("/app/settings/data");
  return { ok: true, message: p.data.immediate ? "Suppression en cours : votre compte disparaîtra dans quelques minutes." : `Suppression programmée dans ${GRACE_DAYS} jours. Vous pouvez l'annuler d'ici là.` };
}

export async function cancelAccountDeletion(): Promise<Result> {
  const s = await requireSession();
  const r = await db().deletionRequest.updateMany({ where: { userId: s.user.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (r.count === 0) return { ok: false, error: "Aucune suppression à annuler (elle est peut-être déjà en cours)." };
  await db().user.update({ where: { id: s.user.id }, data: { deletionRequestedAt: null } });
  await audit(db(), { actorId: s.user.id, action: "account.deletion_cancelled" }, env().HASH_PEPPER);
  revalidatePath("/app/settings/data");
  return { ok: true, message: "Suppression annulée." };
}
