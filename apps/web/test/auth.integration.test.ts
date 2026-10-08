import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const adminUrl = process.env["TEST_ADMIN_URL"];
const appUrl = process.env["TEST_APP_URL"];
if (process.env["CI"] && !(adminUrl && appUrl)) throw new Error("TEST_ADMIN_URL / TEST_APP_URL requis en CI");
const run = adminUrl && appUrl ? describe : describe.skip;

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("../src/lib/mailer", async (orig) => {
  const actual = await orig<typeof import("../src/lib/mailer")>();
  return { ...actual, sendMail: async (m: { to: string; subject: string; text: string }) => void sent.push(m) };
});

const PASSWORD = "Tr0ub4dor&Cheval-Agrafe-92";

run("authentification (Better Auth + Postgres)", () => {
  let admin: import("@mon-agent-ia/db").Db;
  let authFn: typeof import("../src/lib/auth").auth;
  const email = `alice.${Date.now()}@example.test`;
  const hdr = (ip: string) => new Headers({ "x-forwarded-for": ip, "user-agent": "vitest-agent", "x-vercel-ip-country": "FR" });
  const lastLink = (to: string) => {
    const m = [...sent].reverse().find((x) => x.to === to);
    const url = m?.text.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Error("lien introuvable");
    return new URL(url);
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test", APP_ENV: "dev", APP_URL: "http://localhost:3000",
      DATABASE_URL: appUrl, AUTH_SECRET: "s".repeat(48), KEK_BASE64: randomBytes(32).toString("base64"),
      HASH_PEPPER: "p".repeat(40), HIBP_ENABLED: "false",
    });
    delete process.env["REDIS_URL"];
    const { createDb } = await import("@mon-agent-ia/db");
    admin = createDb(adminUrl!);
    ({ auth: authFn } = await import("../src/lib/auth"));
  });
  afterAll(async () => void (await admin.$disconnect()));

  it("inscription : crée l'utilisateur, son foyer, sa clé et son adhésion OWNER", async () => {
    await authFn().api.signUpEmail({ body: { name: "Alice Martin", email, password: PASSWORD }, headers: hdr("203.0.113.10") });
    const user = await admin.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(false);
    const m = await admin.membership.findFirstOrThrow({ where: { userId: user.id }, include: { household: true } });
    expect(m.role).toBe("OWNER");
    expect(m.household.wrappedDek.length).toBeGreaterThan(40);
    expect(await admin.profile.count({ where: { householdId: m.householdId, relation: "SELF" } })).toBe(1);
    expect(sent.some((x) => x.to === email && /confirm/i.test(x.subject))).toBe(true);
  });

  it("mot de passe trop court refusé", async () => {
    await expect(
      authFn().api.signUpEmail({ body: { name: "Bob", email: `bob.${Date.now()}@example.test`, password: "court1!" }, headers: hdr("203.0.113.11") }),
    ).rejects.toThrow();
  });

  it("connexion refusée tant que l'email n'est pas vérifié", async () => {
    await expect(authFn().api.signInEmail({ body: { email, password: PASSWORD }, headers: hdr("203.0.113.10") })).rejects.toThrow();
  });

  it("vérification email puis connexion : journalise un succès", async () => {
    const link = lastLink(email);
    await authFn().api.verifyEmail({ query: { token: link.searchParams.get("token")! }, headers: hdr("203.0.113.10") });
    const res = await authFn().api.signInEmail({ body: { email, password: PASSWORD }, headers: hdr("203.0.113.10") });
    expect(res.user.email).toBe(email);
    const user = await admin.user.findUniqueOrThrow({ where: { email } });
    const ev = await admin.loginEvent.findMany({ where: { userId: user.id, success: true } });
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0]!.ipHash).not.toContain("203.0.113"); // IP jamais en clair
    expect(ev[0]!.emailHash).not.toContain("alice");
  });

  it("mauvais mot de passe : refus + échec journalisé sans fuite d'information", async () => {
    await expect(authFn().api.signInEmail({ body: { email, password: "mauvais-mot-de-passe-1" }, headers: hdr("203.0.113.12") })).rejects.toThrow();
    const fails = await admin.loginEvent.count({ where: { success: false } });
    expect(fails).toBeGreaterThan(0);
  });

  it("verrouillage par compte après trop d'essais (force brute)", async () => {
    let blocked = false;
    for (let i = 0; i < 12 && !blocked; i++) {
      try {
        await authFn().api.signInEmail({ body: { email, password: `faux-${i}-mot-de-passe` }, headers: hdr(`198.51.100.${i + 1}`) });
      } catch (e) {
        if ((e as { status?: string }).status === "TOO_MANY_REQUESTS") blocked = true;
      }
    }
    expect(blocked).toBe(true);
  });
});
