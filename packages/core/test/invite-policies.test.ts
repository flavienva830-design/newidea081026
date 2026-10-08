import { describe, expect, it } from "vitest";
import { MemoryStore, POLICIES, RateLimiter } from "../src/rate-limit.ts";

describe("limites de débit des invitations", () => {
  it("bornent l'expéditeur, le foyer et le destinataire (anti-spam et anti-harcèlement)", () => {
    expect(POLICIES.inviteByUser).toEqual({ limit: 10, windowSec: 3600 });
    expect(POLICIES.inviteByHousehold).toEqual({ limit: 30, windowSec: 86_400 });
    expect(POLICIES.inviteByRecipient).toEqual({ limit: 3, windowSec: 86_400 });
    expect(POLICIES.inviteAcceptByUser.limit).toBeLessThanOrEqual(30);
  });

  it("une même adresse ne peut pas être inondée d'invitations, quel que soit l'expéditeur", async () => {
    const rl = new RateLimiter(new MemoryStore(), POLICIES.inviteByRecipient);
    const t0 = 5_000_000;
    for (let i = 0; i < 3; i++) expect((await rl.check("invite:to:hash-de-l-adresse", t0 + i)).allowed).toBe(true);
    const blocked = await rl.check("invite:to:hash-de-l-adresse", t0 + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(3600);
    expect((await rl.check("invite:to:hash-d-une-autre-adresse", t0 + 10)).allowed).toBe(true); // les autres destinataires ne sont pas touchés
  });

  it("l'expéditeur est limité à 10 invitations par heure, puis libéré", async () => {
    const rl = new RateLimiter(new MemoryStore(), POLICIES.inviteByUser);
    const t0 = 9_000_000;
    for (let i = 0; i < 10; i++) expect((await rl.check("invite:u:1", t0 + i)).allowed).toBe(true);
    expect((await rl.check("invite:u:1", t0 + 20)).allowed).toBe(false);
    expect((await rl.check("invite:u:1", t0 + 3_601_000)).allowed).toBe(true);
  });
});
