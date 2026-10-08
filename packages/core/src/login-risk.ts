export type LoginContext = {
  ipPrefix: string | null;
  country: string | null;
  deviceHash: string | null;
  at: Date;
};
export type KnownHistory = {
  countries: Set<string>;
  deviceHashes: Set<string>;
  ipPrefixes: Set<string>;
  last?: { country: string | null; at: Date };
  recentFailures: number;
};

export type RiskAssessment = { suspicious: boolean; score: number; reasons: string[]; stepUp: "none" | "mfa" | "email" };

/**
 * Évaluation de risque à la connexion. Volontairement simple et explicable :
 * chaque signal ajoute des points ; au-delà du seuil on exige le second facteur (si activé) ou une confirmation par email.
 */
export function assessLoginRisk(ctx: LoginContext, hist: KnownHistory, mfaEnabled: boolean): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;
  const hasHistory = hist.countries.size > 0 || hist.deviceHashes.size > 0;

  if (hasHistory) {
    if (ctx.deviceHash && !hist.deviceHashes.has(ctx.deviceHash)) { score += 25; reasons.push("new_device"); }
    if (ctx.country && !hist.countries.has(ctx.country)) { score += 35; reasons.push("new_country"); }
    if (ctx.ipPrefix && !hist.ipPrefixes.has(ctx.ipPrefix)) { score += 10; reasons.push("new_network"); }
    if (hist.last?.country && ctx.country && hist.last.country !== ctx.country) {
      const hours = (ctx.at.getTime() - hist.last.at.getTime()) / 3_600_000;
      if (hours < 2) { score += 40; reasons.push("impossible_travel"); }
    }
  }
  if (hist.recentFailures >= 3) { score += 20; reasons.push("recent_failures"); }
  if (hist.recentFailures >= 8) { score += 30; reasons.push("many_failures"); }

  const suspicious = score >= 40;
  return { suspicious, score, reasons, stepUp: !suspicious ? "none" : mfaEnabled ? "mfa" : "email" };
}

/** Tronque une IP pour le suivi de zone (IPv4 /24, IPv6 /48) sans conserver l'adresse complète. */
export function ipPrefix(ip: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::/48";
  return null;
}
