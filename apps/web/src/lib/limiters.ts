import "server-only";
import { Redis } from "ioredis";
import { MemoryStore, POLICIES, RateLimiter, RedisStore, type RateLimitStore } from "@mon-agent-ia/core";
import { env } from "./env";

function store(): RateLimitStore {
  const url = env().REDIS_URL;
  if (!url) return new MemoryStore();
  const g = globalThis as unknown as { __redis?: Redis };
  g.__redis ??= new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  return new RedisStore(g.__redis);
}

export type Limiters = Record<
  "loginIp" | "loginAccount" | "signupIp" | "magic" | "reset" | "totp" | "upload" | "api" | "invite" | "inviteHousehold" | "inviteRecipient" | "inviteAccept",
  RateLimiter
>;

/** Limiteurs partagés (Redis en production, mémoire en développement). */
export function limiters(): Limiters {
  const g = globalThis as unknown as { __limiters?: Limiters };
  if (!g.__limiters) {
    const s = store();
    g.__limiters = {
      loginIp: new RateLimiter(s, POLICIES.loginByIp),
      loginAccount: new RateLimiter(s, POLICIES.loginByAccount),
      signupIp: new RateLimiter(s, POLICIES.signupByIp),
      magic: new RateLimiter(s, POLICIES.magicLinkByEmail),
      reset: new RateLimiter(s, POLICIES.passwordResetByEmail),
      totp: new RateLimiter(s, POLICIES.totpByUser),
      upload: new RateLimiter(s, POLICIES.uploadByHousehold),
      api: new RateLimiter(s, POLICIES.apiByUser),
      invite: new RateLimiter(s, POLICIES.inviteByUser),
      inviteHousehold: new RateLimiter(s, POLICIES.inviteByHousehold),
      inviteRecipient: new RateLimiter(s, POLICIES.inviteByRecipient),
      inviteAccept: new RateLimiter(s, POLICIES.inviteAcceptByUser),
    };
  }
  return g.__limiters;
}
