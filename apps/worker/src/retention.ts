import { RETENTION_DAYS } from "@mon-agent-ia/core";
import { Prisma, type Db } from "@mon-agent-ia/db";

export { RETENTION_DAYS };

export type RetentionStats = Record<keyof typeof RETENTION_DAYS, number>;

const DAY = 86_400_000;
const BATCH = 5_000;
const MAX_BATCHES = 200;

export type RetentionDeps = { db: Db; now?: () => Date; batchSize?: number };

/**
 * Supprime par lots (un lot = une transaction courte : pas de verrou long, pas de journal de réplication géant),
 * en s'arrêtant quand un lot n'est pas plein. `table` et `where` viennent de CE fichier, jamais d'une entrée externe.
 */
async function deleteOld(db: Db, table: string, where: Prisma.Sql, batch: number): Promise<number> {
  const t = Prisma.raw(`"${table}"`);
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await db.$executeRaw`DELETE FROM ${t} WHERE "id" IN (SELECT "id" FROM ${t} WHERE ${where} LIMIT ${batch})`;
    total += n;
    if (n < batch) break;
  }
  return total;
}

/**
 * Purge quotidienne. Chaque catégorie est traitée indépendamment : l'échec de l'une (verrou, délai dépassé) ne bloque pas
 * les autres et est remontée dans `failed` ; le reste sera repris au passage suivant.
 */
export async function purgeExpiredData(deps: RetentionDeps): Promise<{ deleted: RetentionStats; failed: string[] }> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const batch = deps.batchSize ?? BATCH;
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const D = RETENTION_DAYS;

  const jobs: { key: keyof RetentionStats; run: () => Promise<number> }[] = [
    { key: "loginEvents", run: () => deleteOld(db, "login_events", Prisma.sql`"createdAt" < ${before(D.loginEvents)}::timestamp`, batch) },
    { key: "aiRuns", run: () => deleteOld(db, "ai_runs", Prisma.sql`"createdAt" < ${before(D.aiRuns)}::timestamp`, batch) },
    {
      key: "auditLogs",
      // Seule voie de suppression du journal (fonction réservée au rôle de service ; la base refuse < 12 mois).
      run: async () => Number(((await db.$queryRaw<{ n: bigint }[]>`SELECT purge_audit_logs(make_interval(days => ${D.auditLogs})) AS n`)[0]?.n) ?? 0),
    },
    { key: "stripeEvents", run: () => deleteOld(db, "stripe_events", Prisma.sql`"receivedAt" < ${before(D.stripeEvents)}::timestamp`, batch) },
    {
      key: "notificationsRead",
      run: () => deleteOld(db, "notifications", Prisma.sql`"readAt" IS NOT NULL AND "createdAt" < ${before(D.notificationsRead)}::timestamp`, batch),
    },
    { key: "notificationsAny", run: () => deleteOld(db, "notifications", Prisma.sql`"createdAt" < ${before(D.notificationsAny)}::timestamp`, batch) },
    { key: "reminders", run: () => deleteOld(db, "reminders", Prisma.sql`"status" <> 'PENDING' AND "remindAt" < ${before(D.reminders)}::timestamp`, batch) },
    { key: "sessions", run: () => deleteOld(db, "sessions", Prisma.sql`"expiresAt" < ${before(D.sessions)}::timestamp`, batch) },
    { key: "verifications", run: () => deleteOld(db, "verifications", Prisma.sql`"expiresAt" < ${before(D.verifications)}::timestamp`, batch) },
    {
      key: "invitations",
      run: () => {
        const c = before(D.invitations);
        return deleteOld(
          db, "invitations",
          Prisma.sql`("acceptedAt" IS NOT NULL AND "acceptedAt" < ${c}::timestamp) OR ("revokedAt" IS NOT NULL AND "revokedAt" < ${c}::timestamp) OR "expiresAt" < ${c}::timestamp`,
          batch,
        );
      },
    },
    {
      key: "privacyRequests",
      run: async () => {
        const c = before(D.privacyRequests);
        return (
          (await deleteOld(db, "deletion_requests", Prisma.sql`"status" IN ('COMPLETED', 'FAILED', 'CANCELLED') AND "createdAt" < ${c}::timestamp`, batch)) +
          (await deleteOld(db, "data_export_requests", Prisma.sql`"createdAt" < ${c}::timestamp`, batch))
        );
      },
    },
    { key: "supportNotes", run: () => deleteOld(db, "support_notes", Prisma.sql`"createdAt" < ${before(D.supportNotes)}::timestamp`, batch) },
    {
      key: "usageCounters",
      // « AAAA-MM » se compare comme du texte : tout mois strictement antérieur au mois limite.
      run: () => deleteOld(db, "usage_counters", Prisma.sql`"period" < ${before(D.usageCounters).toISOString().slice(0, 7)}`, batch),
    },
  ];

  const deleted = Object.fromEntries(jobs.map((j) => [j.key, 0])) as RetentionStats;
  const failed: string[] = [];
  for (const j of jobs) {
    try {
      deleted[j.key] = await j.run();
    } catch {
      failed.push(j.key); // jamais le message : il pourrait citer une donnée
    }
  }

  // Trace de la purge elle-même (comptes uniquement), pour pouvoir démontrer que la politique est appliquée.
  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  if (total > 0 || failed.length > 0) {
    await db.auditLog
      .create({ data: { actorId: "worker", action: "retention.purged", metadata: { ...deleted, failed: failed.join(",") } } })
      .catch(() => {});
  }
  return { deleted, failed };
}
