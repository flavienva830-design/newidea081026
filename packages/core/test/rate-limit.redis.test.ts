import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { RateLimiter, RedisStore } from "../src/rate-limit.ts";

const url = process.env["TEST_REDIS_URL"];
if (process.env["CI"] && !url) throw new Error("TEST_REDIS_URL requis en CI");
const run = url ? describe : describe.skip;

run("limiteur Redis (fenêtre glissante atomique)", () => {
  const redis = new Redis(url!);
  afterAll(() => redis.quit());

  it("limite, isole et réinitialise", async () => {
    const rl = new RateLimiter(new RedisStore(redis, "t:"), { limit: 3, windowSec: 5 });
    const key = `k-${Date.now()}`;
    const t = Date.now();
    for (let i = 0; i < 3; i++) expect((await rl.check(key, t + i)).allowed).toBe(true);
    const blocked = await rl.check(key, t + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await rl.check(key + "-autre", t)).allowed).toBe(true);
    await rl.reset(key);
    expect((await rl.check(key, t + 20)).allowed).toBe(true);
  });

  it("reste exact sous concurrence", async () => {
    const rl = new RateLimiter(new RedisStore(redis, "t:"), { limit: 10, windowSec: 5 });
    const key = `c-${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 30 }, () => rl.check(key)));
    expect(results.filter((r) => r.allowed).length).toBe(10);
  });
});
