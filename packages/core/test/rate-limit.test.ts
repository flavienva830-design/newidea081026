import { describe, expect, it } from "vitest";
import { lockoutSeconds, MemoryStore, RateLimiter } from "../src/rate-limit.ts";

describe("limiteur de débit", () => {
  it("bloque au-delà de la limite puis libère après la fenêtre", async () => {
    const rl = new RateLimiter(new MemoryStore(), { limit: 3, windowSec: 10 });
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect((await rl.check("k", t0 + i)).allowed).toBe(true);
    const blocked = await rl.check("k", t0 + 5);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await rl.check("k", t0 + 11_000)).allowed).toBe(true);
  });
  it("isole les clés et se réinitialise", async () => {
    const rl = new RateLimiter(new MemoryStore(), { limit: 1, windowSec: 60 });
    expect((await rl.check("a")).allowed).toBe(true);
    expect((await rl.check("a")).allowed).toBe(false);
    expect((await rl.check("b")).allowed).toBe(true);
    await rl.reset("a");
    expect((await rl.check("a")).allowed).toBe(true);
  });
  it("verrouillage progressif plafonné", () => {
    expect(lockoutSeconds(4)).toBe(0);
    expect(lockoutSeconds(5)).toBe(30);
    expect(lockoutSeconds(6)).toBe(60);
    expect(lockoutSeconds(50)).toBe(3600);
  });
});
