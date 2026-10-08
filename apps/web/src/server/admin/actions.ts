"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { dbService } from "@/lib/db";
import { env } from "@/lib/env";
import { checkStaff } from "./guard";
import { addNoteOp, banUserOp, revokeSessionsOp, unbanUserOp, updateDeletionOp, type AdminResult, type OpsCtx } from "./ops";

export type { AdminResult };

const reason = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(200);
const userId = z.string().min(1).max(100);
const FORBIDDEN: AdminResult = { ok: false, error: "Action non autorisée." };
const SENSITIVE = true; // connexion récente exigée pour toute action qui modifie quelque chose

const bad = (e: z.ZodError): AdminResult => ({ ok: false, error: e.issues[0]?.message ?? "Demande invalide." });

async function ctxFor(min: "SUPPORT" | "ADMIN", sensitive: boolean): Promise<OpsCtx | null> {
  const { decision, ctx } = await checkStaff(min, sensitive);
  return decision.ok && ctx ? { userId: ctx.userId, ip: ctx.ip, userAgent: ctx.userAgent, pepper: env().HASH_PEPPER } : null;
}

export async function banUser(input: unknown): Promise<AdminResult> {
  const p = z.object({ id: userId, reason }).safeParse(input);
  if (!p.success) return bad(p.error);
  const ctx = await ctxFor("ADMIN", SENSITIVE);
  if (!ctx) return FORBIDDEN;
  const r = await banUserOp(dbService(), ctx, p.data);
  revalidatePath("/admin/users");
  return r;
}

export async function unbanUser(input: unknown): Promise<AdminResult> {
  const p = z.object({ id: userId, reason }).safeParse(input);
  if (!p.success) return bad(p.error);
  const ctx = await ctxFor("ADMIN", SENSITIVE);
  if (!ctx) return FORBIDDEN;
  const r = await unbanUserOp(dbService(), ctx, p.data);
  revalidatePath("/admin/users");
  return r;
}

export async function revokeSessions(input: unknown): Promise<AdminResult> {
  const p = z.object({ id: userId, reason }).safeParse(input);
  if (!p.success) return bad(p.error);
  const ctx = await ctxFor("ADMIN", SENSITIVE);
  return ctx ? revokeSessionsOp(dbService(), ctx, p.data) : FORBIDDEN;
}

/** Note interne : le support et les administrateurs peuvent en ajouter. */
export async function addSupportNote(input: unknown): Promise<AdminResult> {
  const p = z.object({ id: userId, body: z.string().trim().min(1, "La note est vide.").max(500, "500 caractères maximum.") }).safeParse(input);
  if (!p.success) return bad(p.error);
  const ctx = await ctxFor("SUPPORT", false);
  if (!ctx) return FORBIDDEN;
  const r = await addNoteOp(dbService(), ctx, p.data);
  revalidatePath(`/admin/users/${p.data.id}`);
  return r;
}

export async function updateDeletionRequest(input: unknown): Promise<AdminResult> {
  const p = z.object({ id: z.uuid(), action: z.enum(["execute_now", "cancel"]), reason }).safeParse(input);
  if (!p.success) return bad(p.error);
  const ctx = await ctxFor("ADMIN", SENSITIVE);
  if (!ctx) return FORBIDDEN;
  const r = await updateDeletionOp(dbService(), ctx, p.data);
  revalidatePath("/admin/privacy");
  return r;
}
