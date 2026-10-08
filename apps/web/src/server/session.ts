import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveTenant, type ActiveTenant } from "./tenant";

/** Session courante (mise en cache le temps d'une requête). */
export const getSession = cache(async () => auth().api.getSession({ headers: await headers() }));

export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Session + foyer actif + rôle. Le foyer est toujours déduit de l'appartenance, jamais d'un paramètre client. */
export async function requireTenant(): Promise<{ session: NonNullable<Awaited<ReturnType<typeof getSession>>>; tenant: ActiveTenant }> {
  const session = await requireSession();
  const tenant = await resolveTenant(db(), session.user.id);
  if (!tenant) redirect("/login");
  return { session, tenant };
}
