import { hmac } from "@mon-agent-ia/core";
import type { Db } from "@mon-agent-ia/db";

export type AuditEntry = {
  actorId?: string | null;
  householdId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

/** Écrit une ligne d'audit (ajout seul). Ne reçoit jamais de contenu de document : uniquement des identifiants. */
export async function audit(db: Db, e: AuditEntry, pepper: string): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: e.actorId ?? null,
      householdId: e.householdId ?? null,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      ipHash: e.ip ? hmac(e.ip, pepper) : null,
      userAgent: e.userAgent?.slice(0, 300),
      metadata: e.metadata,
    },
  });
}
