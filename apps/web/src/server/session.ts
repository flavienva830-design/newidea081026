import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { HOUSEHOLD_COOKIE, parseHouseholdId, resolveActiveTenant, type ActiveTenant } from "./tenant";

/** Session courante (mise en cache le temps d'une requête). */
export const getSession = cache(async () => auth().api.getSession({ headers: await headers() }));

export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Inscription terminée ? (mis en cache le temps d'une requête) */
const isOnboarded = cache(async (userId: string) => {
  const u = await db().user.findUnique({ where: { id: userId }, select: { onboardedAt: true } });
  return !!u?.onboardedAt;
});

/**
 * Session + foyer actif + rôle.
 * Le foyer est déduit de l'appartenance en base. Le cookie `mai_hh` n'exprime qu'une PRÉFÉRENCE : s'il désigne un foyer
 * dont l'utilisateur n'est pas membre, il est ignoré. Tant que l'inscription n'est pas terminée, l'assistant de
 * bienvenue configure le foyer personnel : la préférence est alors ignorée (un invité qui rejoint un foyer ne peut
 * pas, par cet assistant, modifier le foyer d'un autre).
 */
export async function requireTenant(): Promise<{ session: NonNullable<Awaited<ReturnType<typeof getSession>>>; tenant: ActiveTenant }> {
  const session = await requireSession();
  let preferred = parseHouseholdId((await cookies()).get(HOUSEHOLD_COOKIE)?.value);
  if (preferred && !(await isOnboarded(session.user.id))) preferred = undefined;
  const tenant = await resolveActiveTenant(db(), session.user.id, preferred);
  if (!tenant) redirect("/login");
  return { session, tenant };
}
