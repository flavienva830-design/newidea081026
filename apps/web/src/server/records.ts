"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withTenant } from "@mon-agent-ia/db";
import { can, type Permission } from "@mon-agent-ia/core";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "./audit";
import { requireTenant } from "./session";
import { clientInfo } from "./security";

export type Result = { ok: true } | { ok: false; error: string };

const id = z.uuid();

async function guard(permission: Permission) {
  const { tenant } = await requireTenant();
  if (!can(tenant.role, permission)) return null;
  return { tenant, info: clientInfo(await headers()), pepper: env().HASH_PEPPER };
}
const denied: Result = { ok: false, error: "Vous n'avez pas le droit d'effectuer cette action." };
const invalid: Result = { ok: false, error: "Demande invalide." };

export async function setActionStatus(input: unknown): Promise<Result> {
  const p = z.object({ id, status: z.enum(["ACCEPTED", "DONE", "DISMISSED"]) }).safeParse(input);
  if (!p.success) return invalid;
  const g = await guard("action:write");
  if (!g) return denied;
  const r = await withTenant(db(), g.tenant, (tx) =>
    tx.recommendedAction.updateMany({ where: { id: p.data.id }, data: { status: p.data.status, resolvedAt: p.data.status === "ACCEPTED" ? null : new Date() } }),
  );
  if (r.count === 0) return invalid; // id inconnu ou d'un autre foyer : même réponse (RLS)
  await audit(db(), { actorId: g.tenant.userId, householdId: g.tenant.householdId, action: "action.status", targetType: "action", targetId: p.data.id, ip: g.info.ip, metadata: { status: p.data.status } }, g.pepper);
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function setDeadlineStatus(input: unknown): Promise<Result> {
  const p = z.object({ id, status: z.enum(["DONE", "DISMISSED", "OPEN"]) }).safeParse(input);
  if (!p.success) return invalid;
  const g = await guard("deadline:write");
  if (!g) return denied;
  const r = await withTenant(db(), g.tenant, async (tx) => {
    const res = await tx.deadline.updateMany({ where: { id: p.data.id }, data: { status: p.data.status } });
    // Une échéance traitée n'a plus à rappeler quoi que ce soit.
    if (res.count && p.data.status !== "OPEN") await tx.reminder.updateMany({ where: { deadlineId: p.data.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    return res;
  });
  if (r.count === 0) return invalid;
  await audit(db(), { actorId: g.tenant.userId, householdId: g.tenant.householdId, action: "deadline.status", targetType: "deadline", targetId: p.data.id, ip: g.info.ip, metadata: { status: p.data.status } }, g.pepper);
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function setSavingStatus(input: unknown): Promise<Result> {
  const p = z.object({ id, status: z.enum(["ACCEPTED", "DISMISSED", "REALIZED"]) }).safeParse(input);
  if (!p.success) return invalid;
  const g = await guard("action:write");
  if (!g) return denied;
  const r = await withTenant(db(), g.tenant, (tx) => tx.saving.updateMany({ where: { id: p.data.id }, data: { status: p.data.status } }));
  if (r.count === 0) return invalid;
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Supprime un document analysé ET tout ce qui en découle (échéances, rappels, économies, actions). */
export async function deleteDocument(input: unknown): Promise<Result> {
  const p = z.object({ id }).safeParse(input);
  if (!p.success) return invalid;
  const g = await guard("document:delete");
  if (!g) return denied;
  const done = await withTenant(db(), g.tenant, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!doc) return false;
    await tx.reminder.deleteMany({ where: { deadline: { documentId: doc.id } } });
    await tx.deadline.deleteMany({ where: { documentId: doc.id } });
    await tx.saving.deleteMany({ where: { documentId: doc.id } });
    await tx.recommendedAction.deleteMany({ where: { documentId: doc.id } });
    await tx.documentTag.deleteMany({ where: { documentId: doc.id } });
    await tx.document.delete({ where: { id: doc.id } });
    return true;
  });
  if (!done) return invalid;
  await audit(db(), { actorId: g.tenant.userId, householdId: g.tenant.householdId, action: "document.deleted", targetType: "document", targetId: p.data.id, ip: g.info.ip }, g.pepper);
  revalidatePath("/app", "layout");
  return { ok: true };
}
