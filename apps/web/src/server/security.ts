import { assessLoginRisk, hmac, ipPrefix, type KnownHistory, type RiskAssessment } from "@mon-agent-ia/core";
import type { Db } from "@mon-agent-ia/db";

export type ClientInfo = { ip: string; country: string | null; userAgent: string | null };

/** Extrait l'IP / le pays / l'agent depuis les en-têtes (Vercel pose x-vercel-forwarded-for et x-vercel-ip-country). */
export function clientInfo(h: Headers): ClientInfo {
  const raw = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "";
  const ip = raw.split(",")[0]?.trim() || "unknown";
  const country = h.get("x-vercel-ip-country")?.toUpperCase().slice(0, 2) || null;
  return { ip, country, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export type LoginRecord = {
  userId: string | null;
  email: string;
  success: boolean;
  method: string;
  failReason?: string;
  info: ClientInfo;
  pepper: string;
  mfaEnabled?: boolean;
  now?: Date;
};

const HISTORY_DAYS = 90;

async function loadHistory(db: Db, userId: string, now: Date): Promise<KnownHistory> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const events = await db.loginEvent.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { success: true, country: true, deviceHash: true, ipPrefix: true, createdAt: true },
  });
  const ok = events.filter((e) => e.success);
  const lastOk = ok[0];
  let failures = 0;
  for (const e of events) {
    if (e.success) break;
    failures++;
  }
  return {
    countries: new Set(ok.map((e) => e.country).filter((x): x is string => !!x)),
    deviceHashes: new Set(ok.map((e) => e.deviceHash).filter((x): x is string => !!x)),
    ipPrefixes: new Set(ok.map((e) => e.ipPrefix).filter((x): x is string => !!x)),
    last: lastOk ? { country: lastOk.country, at: lastOk.createdAt } : undefined,
    recentFailures: failures,
  };
}

/**
 * Journalise une tentative de connexion et, pour un succès, évalue le risque.
 * L'email et l'IP ne sont jamais stockés en clair : HMAC + préfixe réseau tronqué.
 */
export async function recordLogin(db: Db, r: LoginRecord): Promise<RiskAssessment | null> {
  const now = r.now ?? new Date();
  const prefix = ipPrefix(r.info.ip);
  const deviceHash = r.info.userAgent ? hmac(r.info.userAgent, r.pepper).slice(0, 32) : null;

  let risk: RiskAssessment | null = null;
  if (r.success && r.userId) {
    const history = await loadHistory(db, r.userId, now);
    risk = assessLoginRisk({ ipPrefix: prefix, country: r.info.country, deviceHash, at: now }, history, !!r.mfaEnabled);
  }

  await db.loginEvent.create({
    data: {
      userId: r.userId,
      emailHash: hmac(r.email.trim().toLowerCase(), r.pepper),
      success: r.success,
      method: r.method,
      failReason: r.failReason,
      ipHash: hmac(r.info.ip, r.pepper),
      ipPrefix: prefix,
      country: r.info.country,
      userAgent: r.info.userAgent,
      deviceHash,
      suspicious: risk?.suspicious ?? false,
      riskReasons: risk?.reasons ?? [],
    },
  });
  return risk;
}

/** Vérification Cloudflare Turnstile. Désactivée (retourne true) uniquement si aucune clé n'est configurée hors production. */
export async function verifyTurnstile(
  token: string | null | undefined,
  secret: string | undefined,
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret) return true;
  if (!token || token.length > 2048) return false;
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // échec fermé : en cas de doute, on refuse
  }
}
