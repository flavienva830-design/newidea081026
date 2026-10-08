import { PLANS, type PlanTier } from "@mon-agent-ia/core/plans";
import { Prisma, type Db } from "@mon-agent-ia/db";
import type Stripe from "stripe";
import { planForPrice, type PriceCatalog } from "./catalog.ts";

export type HandlerDeps = { db: Db; catalog: PriceCatalog; now?: () => Date };
export type HandlerResult = { status: "processed" | "duplicate" | "ignored"; detail?: string };

type BillingStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" | "UNPAID";
const STATUS: Record<string, BillingStatus> = {
  trialing: "TRIALING", active: "ACTIVE", past_due: "PAST_DUE", canceled: "CANCELED", unpaid: "UNPAID",
  incomplete: "INCOMPLETE", incomplete_expired: "CANCELED", paused: "UNPAID",
};

const HANDLED = new Set([
  "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "invoice.paid", "invoice.payment_failed", "charge.refunded", "charge.dispute.created",
]);

const customerId = (c: string | { id: string } | null | undefined) => (typeof c === "string" ? c : c?.id ?? null);

/**
 * Traite un événement Stripe DÉJÀ vérifié (signature contrôlée par `verifyWebhook`).
 *  - Idempotent : l'identifiant d'événement est enregistré ; un doublon est ignoré.
 *  - Résistant au désordre : un événement plus ancien que le dernier appliqué ne change rien.
 *  - Jamais de déduction hasardeuse : un prix inconnu n'altère pas l'offre.
 */
export async function handleStripeEvent(deps: HandlerDeps, event: Stripe.Event): Promise<HandlerResult> {
  const { db } = deps;
  if (!HANDLED.has(event.type)) return { status: "ignored", detail: event.type };

  try {
    await db.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const prev = await db.stripeEvent.findUnique({ where: { id: event.id }, select: { processedAt: true } });
      if (prev?.processedAt) return { status: "duplicate" };
      // Tentative précédente interrompue : on retraite (les traitements sont idempotents).
    } else throw e;
  }

  let result: HandlerResult;
  try {
    result = await dispatch(deps, event);
  } catch (e) {
    await db.stripeEvent.update({ where: { id: event.id }, data: { error: e instanceof Error ? e.name : "erreur" } });
    throw e; // 5xx : Stripe renverra l'événement
  }
  await db.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
  return result;
}

async function dispatch(deps: HandlerDeps, event: Stripe.Event): Promise<HandlerResult> {
  switch (event.type) {
    case "checkout.session.completed": return onCheckoutCompleted(deps, event.data.object as Stripe.Checkout.Session, event);
    case "customer.subscription.created":
    case "customer.subscription.updated": return onSubscriptionChanged(deps, event.data.object as Stripe.Subscription, event);
    case "customer.subscription.deleted": return onSubscriptionDeleted(deps, event.data.object as Stripe.Subscription, event);
    case "invoice.paid": return onInvoice(deps, event.data.object as Stripe.Invoice, event, "paid");
    case "invoice.payment_failed": return onInvoice(deps, event.data.object as Stripe.Invoice, event, "failed");
    case "charge.refunded":
    case "charge.dispute.created": return onMoneyMovement(deps, event);
    default: return { status: "ignored" };
  }
}

const eventDate = (e: Stripe.Event) => new Date(e.created * 1000);

async function findByCustomer(db: Db, customer: string | null) {
  return customer ? db.billingSubscription.findUnique({ where: { stripeCustomerId: customer } }) : null;
}

/** Applique `data` seulement si l'événement est plus récent que le dernier appliqué. */
async function applyIfNewer(db: Db, id: string, at: Date, data: Prisma.BillingSubscriptionUpdateInput): Promise<boolean> {
  const res = await db.billingSubscription.updateMany({
    where: { id, OR: [{ lastEventAt: null }, { lastEventAt: { lte: at } }] },
    data: { ...(data as Prisma.BillingSubscriptionUncheckedUpdateManyInput), lastEventAt: at },
  });
  return res.count > 0;
}

async function onCheckoutCompleted(deps: HandlerDeps, s: Stripe.Checkout.Session, event: Stripe.Event): Promise<HandlerResult> {
  if (s.mode !== "subscription") return { status: "ignored", detail: "mode" };
  const householdId = s.client_reference_id;
  const customer = customerId(s.customer as string | { id: string } | null);
  if (!householdId || !customer) return { status: "ignored", detail: "référence manquante" };
  const exists = await deps.db.household.findUnique({ where: { id: householdId }, select: { id: true } });
  if (!exists) return { status: "ignored", detail: "foyer inconnu" };
  const subscription = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
  await deps.db.billingSubscription.upsert({
    where: { householdId },
    create: { householdId, stripeCustomerId: customer, stripeSubscriptionId: subscription, plan: "FREE", status: "INCOMPLETE", lastEventAt: eventDate(event) },
    update: { stripeCustomerId: customer, stripeSubscriptionId: subscription },
  });
  return { status: "processed" };
}

async function onSubscriptionChanged(deps: HandlerDeps, sub: Stripe.Subscription, event: Stripe.Event): Promise<HandlerResult> {
  const { db } = deps;
  const customer = customerId(sub.customer);
  let row = await findByCustomer(db, customer);
  if (!row && sub.metadata?.["householdId"] && customer) {
    // Abonnement créé avant le retour de checkout : on rattache par la métadonnée posée à la création.
    const h = await db.household.findUnique({ where: { id: sub.metadata["householdId"] }, select: { id: true } });
    if (h) row = await db.billingSubscription.upsert({ where: { householdId: h.id }, create: { householdId: h.id, stripeCustomerId: customer, plan: "FREE", status: "INCOMPLETE" }, update: {} });
  }
  if (!row) return { status: "ignored", detail: "client inconnu" };

  const item = sub.items.data[0];
  const price = planForPrice(deps.catalog, item?.price?.id);
  if (!price) return { status: "ignored", detail: "prix inconnu" }; // jamais de changement d'offre sur un prix non reconnu

  const status = STATUS[sub.status] ?? "INCOMPLETE";
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const applied = await applyIfNewer(db, row.id, eventDate(event), {
    plan: price.plan, status, interval: price.interval, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: sub.cancel_at_period_end, stripeSubscriptionId: sub.id,
  });
  if (!applied) return { status: "ignored", detail: "événement plus ancien" };
  await enforcePlanLimits(db, row.householdId, effectivePlan(price.plan, status, periodEnd, deps.now?.() ?? new Date()));
  return { status: "processed" };
}

async function onSubscriptionDeleted(deps: HandlerDeps, sub: Stripe.Subscription, event: Stripe.Event): Promise<HandlerResult> {
  const row = await findByCustomer(deps.db, customerId(sub.customer));
  if (!row) return { status: "ignored", detail: "client inconnu" };
  const applied = await applyIfNewer(deps.db, row.id, eventDate(event), { plan: "FREE", status: "CANCELED", stripeSubscriptionId: null, cancelAtPeriodEnd: false, interval: null, currentPeriodEnd: null });
  if (!applied) return { status: "ignored", detail: "événement plus ancien" };
  await enforcePlanLimits(deps.db, row.householdId, "FREE");
  return { status: "processed" };
}

async function onInvoice(deps: HandlerDeps, inv: Stripe.Invoice, event: Stripe.Event, kind: "paid" | "failed"): Promise<HandlerResult> {
  const { db } = deps;
  const row = await findByCustomer(db, customerId(inv.customer as string | { id: string } | null));
  if (!row) return { status: "ignored", detail: "client inconnu" };
  if (kind === "paid") {
    const applied = await applyIfNewer(db, row.id, eventDate(event), row.status === "PAST_DUE" ? { status: "ACTIVE" } : {});
    return { status: applied ? "processed" : "ignored" };
  }
  const applied = await applyIfNewer(db, row.id, eventDate(event), { status: "PAST_DUE" });
  if (applied) await notifyOwners(db, row.householdId, "payment_failed", "Le paiement de votre abonnement a échoué", "Mettez à jour votre moyen de paiement pour conserver vos avantages.");
  return { status: applied ? "processed" : "ignored" };
}

async function onMoneyMovement(deps: HandlerDeps, event: Stripe.Event): Promise<HandlerResult> {
  const obj = event.data.object as { customer?: string | { id: string } | null; id: string };
  const row = await findByCustomer(deps.db, customerId(obj.customer));
  // Remboursements et litiges sont traités dans Stripe ; on garde seulement une trace d'audit (sans donnée de paiement).
  await deps.db.auditLog.create({ data: { householdId: row?.householdId ?? null, action: `billing.${event.type}`, targetType: "stripe", targetId: obj.id } });
  return { status: "processed" };
}

/** Offre réellement accordée : abonnement actif, en essai, ou impayé encore dans la période payée. */
export function effectivePlan(plan: PlanTier, status: BillingStatus, periodEnd: Date | null, now: Date): PlanTier {
  const active = status === "ACTIVE" || status === "TRIALING" || (status === "PAST_DUE" && (periodEnd?.getTime() ?? 0) > now.getTime());
  return active ? plan : "FREE";
}

/**
 * Rétrogradation : si le foyer dépasse le nombre de profils de sa nouvelle offre, les profils les plus récents sont
 * archivés (jamais supprimés : réversible) et le propriétaire est prévenu.
 */
export async function enforcePlanLimits(db: Db, householdId: string, plan: PlanTier): Promise<number> {
  const limit = PLANS[plan].profiles;
  const profiles = await db.profile.findMany({ where: { householdId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (profiles.length <= limit) return 0;
  const excess = profiles.slice(limit).map((p) => p.id);
  await db.profile.updateMany({ where: { id: { in: excess } }, data: { archivedAt: new Date() } });
  await notifyOwners(db, householdId, "plan_downgrade", "Certains profils ont été archivés", `Votre offre inclut ${limit} profil${limit > 1 ? "s" : ""}. Les profils supplémentaires sont archivés, pas supprimés.`);
  return excess.length;
}

async function notifyOwners(db: Db, householdId: string, type: string, title: string, body: string) {
  const owners = await db.membership.findMany({ where: { householdId, role: "OWNER" }, select: { userId: true } });
  if (owners.length) await db.notification.createMany({ data: owners.map((o) => ({ userId: o.userId, householdId, type, title, body })) });
}
