/**
 * Limiteur à fenêtre glissante + verrouillage progressif.
 * Deux implémentations : mémoire (tests, dev) et Redis (production, partagé entre instances).
 */
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

export interface RateLimitStore {
  /** Enregistre un événement et retourne le nombre d'événements dans la fenêtre. */
  hit(key: string, windowSec: number, now?: number): Promise<{ count: number; oldestMs: number }>;
  reset(key: string): Promise<void>;
}

export class MemoryStore implements RateLimitStore {
  private events = new Map<string, number[]>();
  async hit(key: string, windowSec: number, now = Date.now()) {
    const cutoff = now - windowSec * 1000;
    const list = (this.events.get(key) ?? []).filter((t) => t > cutoff);
    list.push(now);
    this.events.set(key, list);
    return { count: list.length, oldestMs: list[0] ?? now };
  }
  async reset(key: string) {
    this.events.delete(key);
  }
}

/** Minimal : compatible ioredis. Fenêtre glissante via sorted set, atomique (script Lua). */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

const LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2]) * 1000
local member = ARGV[3]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
local count = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
return {count, tonumber(oldest[2])}
`;

export class RedisStore implements RateLimitStore {
  private seq = 0;
  constructor(private redis: RedisLike, private prefix = "rl:") {}
  async hit(key: string, windowSec: number, now = Date.now()) {
    const member = `${now}-${process.pid}-${this.seq++}-${Math.random().toString(36).slice(2, 8)}`;
    const res = (await this.redis.eval(LUA, 1, this.prefix + key, now, windowSec, member)) as [number, number];
    return { count: Number(res[0]), oldestMs: Number(res[1]) };
  }
  async reset(key: string) {
    await this.redis.del(this.prefix + key);
  }
}

export class RateLimiter {
  constructor(private store: RateLimitStore, private opts: { limit: number; windowSec: number }) {}

  async check(key: string, now = Date.now()): Promise<RateLimitResult> {
    const { count, oldestMs } = await this.store.hit(key, this.opts.windowSec, now);
    const allowed = count <= this.opts.limit;
    const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((oldestMs + this.opts.windowSec * 1000 - now) / 1000));
    return { allowed, remaining: Math.max(0, this.opts.limit - count), retryAfterSec };
  }
  reset(key: string) {
    return this.store.reset(key);
  }
}

/** Délai de verrouillage après N échecs consécutifs : 0 jusqu'au seuil, puis 30 s doublé, plafonné à 1 h. */
export function lockoutSeconds(consecutiveFailures: number, threshold = 5): number {
  if (consecutiveFailures < threshold) return 0;
  const exp = consecutiveFailures - threshold;
  return Math.min(3600, 30 * 2 ** exp);
}

/** Politiques de référence (clé = type:identifiant). */
export const POLICIES = {
  loginByIp: { limit: 20, windowSec: 600 },
  loginByAccount: { limit: 8, windowSec: 900 },
  signupByIp: { limit: 5, windowSec: 3600 },
  magicLinkByEmail: { limit: 3, windowSec: 900 },
  passwordResetByEmail: { limit: 3, windowSec: 3600 },
  totpByUser: { limit: 6, windowSec: 300 },
  apiByUser: { limit: 120, windowSec: 60 },
  uploadByHousehold: { limit: 30, windowSec: 60 },
  // Invitations de membres : chaque envoi déclenche un email vers une adresse choisie par l'utilisateur (risque d'abus
  // et de harcèlement) ; on borne donc par expéditeur, par foyer et par destinataire (clé = empreinte de l'adresse).
  inviteByUser: { limit: 10, windowSec: 3600 },
  inviteByHousehold: { limit: 30, windowSec: 86_400 },
  inviteByRecipient: { limit: 3, windowSec: 86_400 },
  // Tentatives d'acceptation d'un jeton d'invitation (le jeton fait 256 bits : on borne surtout la charge).
  inviteAcceptByUser: { limit: 20, windowSec: 600 },
} as const;
