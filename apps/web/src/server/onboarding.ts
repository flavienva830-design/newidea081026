"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { withTenant } from "@mon-agent-ia/db";
import { checkProfileQuota, hmac } from "@mon-agent-ia/core";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "./audit";
import { currentPlan } from "./plan";
import { requireTenant } from "./session";
import { clientInfo } from "./security";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const CONSENT_VERSION = "2026-10";

const consentsSchema = z.object({
  sensitive: z.literal(true, { error: "Ce consentement est nécessaire pour analyser vos documents." }),
  ai: z.literal(true, { error: "Le traitement par IA est nécessaire au fonctionnement du service." }),
  marketing: z.boolean(),
});

const profileSchema = z.object({
  name: z.string().trim().min(2, "Saisissez votre nom.").max(80),
  timezone: z.enum(["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/Luxembourg", "America/Montreal"]),
});

const householdSchema = z.object({
  householdName: z.string().trim().min(2, "Donnez un nom à votre foyer.").max(60),
  members: z
    .array(z.object({ displayName: z.string().trim().min(1).max(60), relation: z.enum(["SPOUSE", "CHILD", "PARENT", "OTHER"]) }))
    .max(10),
});

async function ctx() {
  const { session, tenant } = await requireTenant();
  const info = clientInfo(await headers());
  return { session, tenant, info, pepper: env().HASH_PEPPER };
}

const fail = (error: string): ActionResult => ({ ok: false, error });

export async function acceptConsents(input: unknown): Promise<ActionResult> {
  const p = consentsSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Consentements invalides.");
  const { session, tenant, info, pepper } = await ctx();
  const rows = [
    { type: "TERMS" as const, granted: true },
    { type: "PRIVACY" as const, granted: true },
    { type: "SENSITIVE_DATA_PROCESSING" as const, granted: true },
    { type: "AI_PROCESSING" as const, granted: true },
    { type: "MARKETING_EMAIL" as const, granted: p.data.marketing },
  ];
  await db().consent.createMany({ data: rows.map((r) => ({ userId: session.user.id, type: r.type, granted: r.granted, version: CONSENT_VERSION, ipHash: hmac(info.ip, pepper) })) });
  await db().user.update({ where: { id: session.user.id }, data: { onboardingStep: 1 } });
  await audit(db(), { actorId: session.user.id, householdId: tenant.householdId, action: "consent.granted", ip: info.ip, userAgent: info.userAgent, metadata: { version: CONSENT_VERSION, marketing: p.data.marketing } }, pepper);
  return { ok: true };
}

export async function saveProfile(input: unknown): Promise<ActionResult> {
  const p = profileSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Profil invalide.");
  const { session, tenant } = await ctx();
  await db().user.update({ where: { id: session.user.id }, data: { name: p.data.name, timezone: p.data.timezone, onboardingStep: 2 } });
  await withTenant(db(), tenant, (tx) => tx.profile.updateMany({ where: { userId: session.user.id }, data: { displayName: p.data.name } }));
  return { ok: true };
}

export async function saveHousehold(input: unknown): Promise<ActionResult> {
  const p = householdSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Foyer invalide.");
  const { session, tenant, info, pepper } = await ctx();

  const result = await withTenant(db(), tenant, async (tx) => {
    const plan = await currentPlan(tx, tenant.householdId);
    const existing = await tx.profile.count({ where: { archivedAt: null } });
    const quota = checkProfileQuota(plan, existing + p.data.members.length - 1);
    if (p.data.members.length > 0 && !quota.allowed) return { error: "Les profils supplémentaires sont inclus dans l'offre Famille. Vous pourrez les ajouter plus tard." };
    await tx.household.update({ where: { id: tenant.householdId }, data: { name: p.data.householdName } });
    if (p.data.members.length) await tx.profile.createMany({ data: p.data.members.map((m) => ({ householdId: tenant.householdId, displayName: m.displayName, relation: m.relation })) });
    return {};
  });
  if ("error" in result && result.error) return fail(result.error);
  await db().user.update({ where: { id: session.user.id }, data: { onboardingStep: 3 } });
  await audit(db(), { actorId: session.user.id, householdId: tenant.householdId, action: "household.configured", ip: info.ip, userAgent: info.userAgent, metadata: { members: p.data.members.length } }, pepper);
  return { ok: true };
}

export async function finishOnboarding(): Promise<ActionResult> {
  const { session, tenant, info, pepper } = await ctx();
  const consents = await db().consent.count({ where: { userId: session.user.id, type: { in: ["SENSITIVE_DATA_PROCESSING", "AI_PROCESSING"] }, granted: true } });
  if (consents < 2) return fail("Les consentements doivent être validés avant de continuer.");
  await db().user.update({ where: { id: session.user.id }, data: { onboardingStep: 4, onboardedAt: new Date() } });
  await audit(db(), { actorId: session.user.id, householdId: tenant.householdId, action: "onboarding.completed", ip: info.ip, userAgent: info.userAgent }, pepper);
  return { ok: true };
}
