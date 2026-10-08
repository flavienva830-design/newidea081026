import { createHash } from "node:crypto";
import type { AnalysisOutcome } from "@mon-agent-ia/ai";
import type { Prisma } from "@mon-agent-ia/db";

const REMINDER_OFFSETS_DAYS = [7, 1];

export const actionDedupeKey = (type: string, org: string | null, title: string) =>
  createHash("sha256").update(`${type}|${(org ?? "").toLowerCase()}|${title.toLowerCase().replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 32);

export type PersistResult = {
  documentId: string;
  deadlines: number;
  savings: number;
  actions: number;
  reminders: number;
  savingsAnnualCents: number;
};

/**
 * Écrit UNIQUEMENT l'enregistrement minimal issu de l'analyse (voir `PersistableAnalysis`).
 * Le résumé, les points clés et les risques (`outcome.display`) ne sont jamais écrits.
 * À appeler dans une transaction portant le contexte RLS du foyer.
 */
export async function persistAnalysis(
  tx: Prisma.TransactionClient,
  ctx: { householdId: string; userId: string; source: "WEB_UPLOAD" | "EMAIL" | "MOBILE"; now: Date },
  outcome: AnalysisOutcome,
): Promise<PersistResult> {
  const a = outcome.persistable;
  const { householdId } = ctx;

  const doc = await tx.document.create({
    data: {
      householdId, uploadedById: ctx.userId, source: ctx.source,
      kind: a.kind, title: a.title, organization: a.organization, amountCents: a.amountCents,
      documentDate: a.documentDate, urgencyScore: a.urgencyScore,
    },
    select: { id: true },
  });

  if (a.tags.length) {
    // createMany + skipDuplicates : sûr sous concurrence (deux analyses simultanées créant la même étiquette).
    await tx.tag.createMany({ data: a.tags.map((name) => ({ householdId, name, system: true })), skipDuplicates: true });
    const tags = await tx.tag.findMany({ where: { name: { in: a.tags } }, select: { id: true } });
    await tx.documentTag.createMany({ data: tags.map((t) => ({ householdId, documentId: doc.id, tagId: t.id })), skipDuplicates: true });
  }

  let deadlines = 0;
  let reminders = 0;
  if (a.deadlines.length) {
    // La base garantit l'unicité (foyer, type, date, libellé) : seules les échéances réellement nouvelles sont retournées.
    const created = await tx.deadline.createManyAndReturn({
      data: a.deadlines.map((d) => ({ householdId, documentId: doc.id, kind: d.kind, title: d.title, dueDate: d.dueDate, amountCents: d.amountCents, confidence: d.confidence, source: "AI" as const })),
      skipDuplicates: true,
      select: { id: true, dueDate: true },
    });
    deadlines = created.length;
    const rows = created.flatMap((dl) =>
      REMINDER_OFFSETS_DAYS.flatMap((days) => {
        const remindAt = new Date(dl.dueDate.getTime() - days * 86_400_000);
        return remindAt <= ctx.now ? [] : (["EMAIL", "IN_APP"] as const).map((channel) => ({ householdId, deadlineId: dl.id, channel, remindAt }));
      }),
    );
    if (rows.length) reminders = (await tx.reminder.createMany({ data: rows })).count;
  }

  for (const s of a.savings) {
    await tx.saving.create({
      data: { householdId, documentId: doc.id, kind: s.kind, title: s.title, rationale: s.rationale, monthlyCents: s.monthlyCents, annualCents: s.annualCents, confidence: s.confidence, priority: Math.min(100, Math.round(s.annualCents / 100)) },
    });
  }

  let actions = 0;
  if (a.actions.length) {
    const res = await tx.recommendedAction.createMany({
      data: a.actions.map((x) => ({
        householdId, documentId: doc.id, type: x.type, title: x.title, rationale: x.rationale, priority: x.priority,
        dedupeKey: actionDedupeKey(x.type, a.organization, x.title),
      })),
      skipDuplicates: true,
    });
    actions = res.count;
  }

  const savingsAnnualCents = a.savings.reduce((n, s) => n + s.annualCents, 0);
  if (savingsAnnualCents > 0) {
    const euros = Math.round(savingsAnnualCents / 100).toLocaleString("fr-FR");
    await tx.notification.create({
      data: { userId: ctx.userId, householdId, type: "saving_detected", title: `J'ai détecté ${euros} € d'économies potentielles`, body: "Souhaitez-vous préparer les démarches ?", data: { documentId: doc.id } },
    });
  }

  return { documentId: doc.id, deadlines, savings: a.savings.length, actions, reminders, savingsAnnualCents };
}
