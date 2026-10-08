import { withTenant, type Db } from "@mon-agent-ia/db";
import { can, type MembershipRole } from "@mon-agent-ia/core";

/**
 * Export des données personnelles (RGPD art. 15 et 20), au format JSON structuré.
 * Aucun fichier à joindre : les documents ne sont jamais conservés. L'archive ne contient donc que des données
 * structurées, et aucun secret (mot de passe haché, clés de session, secret TOTP, clé de chiffrement).
 */
export async function buildExport(db: Db, userId: string, now = new Date()) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerified: true, locale: true, timezone: true, createdAt: true, onboardedAt: true, twoFactorEnabled: true },
  });
  const [consents, logins, memberships, notifications, notificationPreferences] = await Promise.all([
    db.consent.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { type: true, version: true, granted: true, createdAt: true } }),
    db.loginEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500, select: { createdAt: true, success: true, method: true, country: true, userAgent: true, suspicious: true } }),
    db.membership.findMany({ where: { userId }, select: { householdId: true, role: true, createdAt: true } }),
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 1000, select: { type: true, title: true, body: true, createdAt: true, readAt: true } }),
    db.notificationPreference.findMany({ where: { userId }, select: { type: true, channel: true, enabled: true } }),
  ]);

  const households = [];
  for (const m of memberships) {
    const tenant = { userId, householdId: m.householdId };
    // Propriétaires et administrateurs : tout le foyer. Autres rôles : seulement ce qu'ils ont eux-mêmes ajouté.
    const wide = can(m.role as MembershipRole, "member:invite");
    households.push(
      await withTenant(db, tenant, async (tx) => {
        const own = wide ? {} : { uploadedById: userId };
        const docs = await tx.document.findMany({ where: { ...own }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, title: true, organization: true, amountCents: true, currency: true, documentDate: true, urgencyScore: true, source: true, createdAt: true } });
        const ids = docs.map((d) => d.id);
        const scope = wide ? {} : { documentId: { in: ids } };
        return {
          householdId: m.householdId, role: m.role,
          household: await tx.household.findUnique({ where: { id: m.householdId }, select: { name: true, createdAt: true } }),
          profiles: wide ? await tx.profile.findMany({ select: { displayName: true, relation: true, birthYear: true, createdAt: true, archivedAt: true } }) : [],
          documents: docs,
          deadlines: await tx.deadline.findMany({ where: scope, orderBy: { dueDate: "asc" }, select: { kind: true, title: true, dueDate: true, amountCents: true, status: true, source: true, confidence: true } }),
          savings: await tx.saving.findMany({ where: scope, select: { kind: true, title: true, rationale: true, monthlyCents: true, annualCents: true, confidence: true, status: true, createdAt: true } }),
          actions: await tx.recommendedAction.findMany({ where: scope, select: { type: true, title: true, rationale: true, priority: true, status: true, createdAt: true, resolvedAt: true } }),
        };
      }),
    );
  }

  return {
    exportedAt: now.toISOString(),
    format: "mon-agent-ia-export/1",
    note: "Vos fichiers ne sont jamais conservés par Mon Agent IA : cette archive contient uniquement les données structurées issues des analyses.",
    account: user,
    consents, notificationPreferences, notifications, loginHistory: logins, households,
  };
}
