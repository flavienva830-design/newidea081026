import type { Prisma } from "@mon-agent-ia/db";

/**
 * Consomme un document du quota mensuel de façon ATOMIQUE (une seule instruction SQL) :
 * deux requêtes simultanées ne peuvent pas dépasser la limite. Retourne false si le quota est épuisé.
 */
export async function consumeDocumentQuota(tx: Prisma.TransactionClient, householdId: string, period: string, limit: number): Promise<boolean> {
  const rows = await tx.$executeRaw`
    INSERT INTO usage_counters (id, "householdId", period, documents, "lettersGenerated", "aiCostMicros")
    VALUES (gen_random_uuid(), ${householdId}::uuid, ${period}, 1, 0, 0)
    ON CONFLICT ("householdId", period)
    DO UPDATE SET documents = usage_counters.documents + 1
    WHERE usage_counters.documents < ${limit}`;
  return rows > 0;
}

/** Rend un document au quota (analyse échouée par notre faute : l'utilisateur n'a rien reçu). */
export async function refundDocumentQuota(tx: Prisma.TransactionClient, householdId: string, period: string): Promise<void> {
  await tx.$executeRaw`UPDATE usage_counters SET documents = GREATEST(documents - 1, 0) WHERE "householdId" = ${householdId}::uuid AND period = ${period}`;
}

export async function addAiCost(tx: Prisma.TransactionClient, householdId: string, period: string, micros: bigint): Promise<void> {
  await tx.$executeRaw`UPDATE usage_counters SET "aiCostMicros" = "aiCostMicros" + ${micros} WHERE "householdId" = ${householdId}::uuid AND period = ${period}`;
}
