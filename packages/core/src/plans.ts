export type PlanTier = "FREE" | "SOLO" | "FAMILLE";

export type PlanLimits = {
  documentsPerMonth: number;
  /** Plafond de courriers rédigés par mois (protège le coût IA). Valeurs provisoires à valider. */
  lettersPerMonth: number;
  profiles: number;
  priceCents: { month: number; year: number };
  features: { letters: boolean; savings: boolean; inboundEmail: boolean; family: boolean };
};

export const PLANS: Record<PlanTier, PlanLimits> = {
  FREE: { documentsPerMonth: 5, lettersPerMonth: 0, profiles: 1, priceCents: { month: 0, year: 0 }, features: { letters: false, savings: true, inboundEmail: false, family: false } },
  SOLO: { documentsPerMonth: 500, lettersPerMonth: 60, profiles: 1, priceCents: { month: 990, year: 9900 }, features: { letters: true, savings: true, inboundEmail: true, family: false } },
  // Le brief fixe « jusqu'à 5 profils » sans quota documentaire : 1 000/mois par foyer (à confirmer).
  FAMILLE: { documentsPerMonth: 1000, lettersPerMonth: 150, profiles: 5, priceCents: { month: 1990, year: 19900 }, features: { letters: true, savings: true, inboundEmail: true, family: true } },
};

export type QuotaCheck = { allowed: true } | { allowed: false; reason: "documents_quota" | "profiles_quota"; limit: number };

export function checkDocumentQuota(plan: PlanTier, usedThisMonth: number): QuotaCheck {
  const limit = PLANS[plan].documentsPerMonth;
  return usedThisMonth < limit ? { allowed: true } : { allowed: false, reason: "documents_quota", limit };
}

export function checkLetterQuota(plan: PlanTier, usedThisMonth: number): QuotaCheck | { allowed: false; reason: "letters_not_included"; limit: 0 } {
  const limit = PLANS[plan].lettersPerMonth;
  if (limit === 0) return { allowed: false, reason: "letters_not_included", limit: 0 };
  return usedThisMonth < limit ? { allowed: true } : { allowed: false, reason: "documents_quota", limit };
}

export function checkProfileQuota(plan: PlanTier, currentProfiles: number): QuotaCheck {
  const limit = PLANS[plan].profiles;
  return currentProfiles < limit ? { allowed: true } : { allowed: false, reason: "profiles_quota", limit };
}

export function usagePeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
