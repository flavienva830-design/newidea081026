import type { Db } from "@mon-agent-ia/db";
import { actionEmail, type MailTransport } from "@mon-agent-ia/mail";

export type DispatchDeps = {
  db: Db;
  mail: MailTransport;
  appUrl: string;
  now?: () => Date;
  batch?: number;
  maxAttempts?: number;
  /** Bail : tant qu'un rappel est « en cours » chez un worker, les autres ne le reprennent pas. */
  leaseMinutes?: number;
};

export type DispatchStats = { claimed: number; sent: number; cancelled: number; failed: number; retried: number };

type Claimed = { id: string; householdId: string; deadlineId: string; channel: "EMAIL" | "IN_APP" | "PUSH"; attempts: number };

const NOTIF_TYPE = "deadline_reminder";
const fmtDate = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const euro = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function when(due: Date, now: Date): string {
  const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  return days <= 0 ? "aujourd'hui" : days === 1 ? "demain" : `dans ${days} jours`;
}

/**
 * Envoie les rappels arrivés à échéance.
 *  - Réservation atomique (`FOR UPDATE SKIP LOCKED`) : plusieurs workers peuvent tourner sans doubler un envoi.
 *  - Un rappel réservé reçoit un « bail » (remindAt repoussé) : en cas de panne il est repris plus tard, jamais perdu.
 *  - Au-delà de `maxAttempts`, il passe en échec définitif.
 *  - Aucun contenu de document : uniquement le libellé court et la date de l'échéance.
 * Livraison « au moins une fois » : un crash entre l'envoi et le marquage peut, très rarement, renvoyer un email.
 */
export async function dispatchReminders(deps: DispatchDeps): Promise<DispatchStats> {
  const { db, mail } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const batch = deps.batch ?? 50;
  const maxAttempts = deps.maxAttempts ?? 5;
  const lease = deps.leaseMinutes ?? 15;
  const stats: DispatchStats = { claimed: 0, sent: 0, cancelled: 0, failed: 0, retried: 0 };

  const claimed = await db.$queryRaw<Claimed[]>`
    UPDATE reminders
       SET attempts = attempts + 1, "remindAt" = ${now}::timestamptz + make_interval(mins => ${lease}::int)
     WHERE id IN (
       SELECT id FROM reminders
        WHERE status = 'PENDING' AND "remindAt" <= ${now}::timestamptz
        ORDER BY "remindAt" ASC
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED)
    RETURNING id, "householdId", "deadlineId", channel::text AS channel, attempts`;
  stats.claimed = claimed.length;

  for (const r of claimed) {
    const deadline = await db.deadline.findUnique({ where: { id: r.deadlineId }, select: { title: true, dueDate: true, amountCents: true, status: true } });
    if (!deadline || deadline.status !== "OPEN") {
      await db.reminder.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
      stats.cancelled++;
      continue;
    }

    // Destinataires : membres qui peuvent agir sur le foyer, actifs, et dont les préférences l'autorisent.
    const members = await db.membership.findMany({
      where: { householdId: r.householdId, role: { in: ["OWNER", "ADMIN", "WRITE"] }, user: { bannedAt: null, deletionRequestedAt: null } },
      select: { user: { select: { id: true, email: true, notificationPreferences: { where: { type: NOTIF_TYPE, channel: r.channel as "EMAIL" | "IN_APP" }, select: { enabled: true } } } } },
    });
    const recipients = members.map((m) => m.user).filter((u) => u.notificationPreferences[0]?.enabled !== false);

    const subject = `Rappel : ${deadline.title}`;
    const detail = `Échéance le ${fmtDate(deadline.dueDate)} (${when(deadline.dueDate, now)})${deadline.amountCents != null ? ` · ${euro(deadline.amountCents)}` : ""}.`;
    let ok = 0;

    if (r.channel === "IN_APP") {
      if (recipients.length) {
        await db.notification.createMany({ data: recipients.map((u) => ({ userId: u.id, householdId: r.householdId, type: NOTIF_TYPE, title: subject, body: detail, data: { deadlineId: r.deadlineId } })) });
      }
      ok = recipients.length;
    } else if (r.channel === "EMAIL") {
      for (const u of recipients) {
        try {
          const body = actionEmail({ title: subject, intro: detail, cta: "Voir mes échéances", url: `${deps.appUrl}/app/deadlines`, outro: "Vous recevez ce rappel car une échéance a été repérée dans vos documents. Vous pouvez la marquer comme faite dans l'application." });
          await mail.send({ to: u.email, subject, ...body });
          ok++;
        } catch {
          // Échec pour ce destinataire : les autres sont servis ; le rappel n'est retenté que si personne n'a été joint.
        }
      }
    } else {
      await db.reminder.update({ where: { id: r.id }, data: { status: "CANCELLED" } }); // canal non pris en charge
      stats.cancelled++;
      continue;
    }

    if (recipients.length === 0 || ok > 0) {
      await db.reminder.update({ where: { id: r.id }, data: { status: "SENT", sentAt: now } });
      stats.sent++;
    } else if (r.attempts >= maxAttempts) {
      await db.reminder.update({ where: { id: r.id }, data: { status: "FAILED" } });
      stats.failed++;
    } else {
      stats.retried++; // le bail le fera reprendre plus tard
    }
  }
  return stats;
}
