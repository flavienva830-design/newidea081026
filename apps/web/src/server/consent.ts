import type { Db } from "@mon-agent-ia/db";

export type ConsentKind = "TERMS" | "PRIVACY" | "SENSITIVE_DATA_PROCESSING" | "AI_PROCESSING" | "MARKETING_EMAIL";

/**
 * Un consentement est actif si sa DERNIÈRE décision pour ce type est « accordé » (le retrait est tracé comme une décision).
 * Tous les types demandés doivent être actifs.
 */
export async function hasConsent(db: Db, userId: string, types: ConsentKind[]): Promise<boolean> {
  const rows = await db.consent.findMany({ where: { userId, type: { in: types } }, orderBy: { createdAt: "desc" }, select: { type: true, granted: true } });
  const latest = new Map<string, boolean>();
  for (const r of rows) if (!latest.has(r.type)) latest.set(r.type, r.granted);
  return types.every((t) => latest.get(t) === true);
}
