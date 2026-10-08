import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { FakeProvider } from "@mon-agent-ia/ai";
import { hmac } from "@mon-agent-ia/core";
import { createDb, withTenant, type Db } from "@mon-agent-ia/db";

const adminUrl = process.env["TEST_ADMIN_URL"];
const appUrl = process.env["TEST_APP_URL"];
if (process.env["CI"] && !(adminUrl && appUrl)) throw new Error("TEST_ADMIN_URL / TEST_APP_URL requis en CI");
const run = adminUrl && appUrl ? describe : describe.skip;

const NOW = new Date("2026-10-08T10:00:00Z");
const DAY = 86_400_000;
const PEPPER = "p".repeat(40);
// La base de test persiste : tout identifiant (email, empreinte) porte un suffixe propre à l'exécution, pour que ce fichier soit relançable.
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const E = (local: string) => `${local}.${RUN}@t.test`;
const MIXED = `Invité.${RUN}@Exemple.TEST`; // casse et accents mélangés

type Role = "OWNER" | "ADMIN" | "WRITE" | "READ";
type U = { id: string; name: string; email: string };

async function pdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  [
    "Madame, Monsieur, chez la société Nova, le tarif de votre abonnement internet passera de 29,99 €",
    "à 35,99 € par mois à compter du 01/12/2026. Vous pouvez résilier sans frais avant le 15 novembre 2026.",
    "Nous restons à votre disposition pour toute question concernant cette modification tarifaire de votre forfait.",
  ].forEach((l, i) => p.drawText(l, { x: 30, y: 800 - i * 16, size: 9, font: f }));
  return d.save();
}

run("espace Famille : rôles, invitations, places, profils, isolation (base réelle, RLS)", () => {
  let admin: Db;
  let app: Db;
  let svc: typeof import("../src/server/family-service");
  let tn: typeof import("../src/server/tenant");
  let analyzeUpload: typeof import("../src/server/analyze-service").analyzeUpload;
  const sent: import("../src/server/family-service").InvitationMail[] = [];

  // ───────── fabriques ─────────
  const newUser = async (name = "Alice Test", email?: string): Promise<U> => {
    const id = `u-${randomUUID()}`;
    const mail = email ?? `${id}@t.test`;
    await admin.user.create({ data: { id, name, email: mail, emailVerified: true } });
    return { id, name, email: mail };
  };
  const newHousehold = async (owner: U, plan?: "SOLO" | "FAMILLE", name = "Foyer test") => {
    const id = randomUUID();
    await admin.household.create({ data: { id, name, wrappedDek: Buffer.from("x") } });
    await admin.membership.create({ data: { householdId: id, userId: owner.id, role: "OWNER", createdAt: new Date(Date.now() - 60_000) } });
    await admin.profile.create({ data: { householdId: id, userId: owner.id, displayName: owner.name, relation: "SELF" } });
    if (plan) await admin.billingSubscription.create({ data: { householdId: id, stripeCustomerId: `cus_${id}`, plan, status: "ACTIVE" } });
    return id;
  };
  const join = async (h: string, u: U, role: Role) => {
    await admin.membership.create({ data: { householdId: h, userId: u.id, role } });
    await admin.profile.create({ data: { householdId: h, userId: u.id, displayName: u.name, relation: "SELF" } });
  };
  const setPlan = (h: string, plan: "FREE" | "SOLO" | "FAMILLE") =>
    admin.billingSubscription.upsert({ where: { householdId: h }, create: { householdId: h, stripeCustomerId: `cus_${h}`, plan, status: "ACTIVE" }, update: { plan, status: "ACTIVE" } });
  const T = (h: string, u: U, role: Role) => ({ userId: u.id, householdId: h, role });
  const mid = async (h: string, u: U) => (await admin.membership.findFirstOrThrow({ where: { householdId: h, userId: u.id } })).id;
  const roleOf = async (h: string, u: U) => (await admin.membership.findFirst({ where: { householdId: h, userId: u.id } }))?.role ?? null;
  const owners = (h: string) => admin.membership.count({ where: { householdId: h, role: "OWNER" } });

  // ───────── appels ─────────
  const sender = async (m: import("../src/server/family-service").InvitationMail) => { sent.push(m); };
  const D = (o: { now?: Date; send?: (m: import("../src/server/family-service").InvitationMail) => Promise<void> } = {}) => ({ db: app, pepper: PEPPER, now: () => o.now ?? NOW, send: o.send ?? sender });
  const invite = (t: ReturnType<typeof T>, email: string, role: "READ" | "WRITE" | "ADMIN" = "READ", o: Parameters<typeof D>[0] = {}) => svc.inviteMember(D(o), t, { email, role });
  const tokenFor = (email: string) => [...sent].reverse().find((m) => m.to === email.trim().toLowerCase())!.token;
  const asUser = (u: U, over: Partial<{ email: string; emailVerified: boolean }> = {}) => ({ id: u.id, name: u.name, email: u.email, emailVerified: true, ...over });
  const accept = (u: U, token: string, o: Parameters<typeof D>[0] = {}, over: Parameters<typeof asUser>[1] = {}) => svc.acceptInvitation(D(o), asUser(u, over), token);
  const denied = (h: string, rule?: string) => admin.auditLog.count({ where: { householdId: h, action: "member.denied", ...(rule ? { metadata: { path: ["rule"], equals: rule } } : {}) } });

  beforeAll(async () => {
    Object.assign(process.env, { NODE_ENV: "test", APP_ENV: "dev", DATABASE_URL: appUrl, AUTH_SECRET: "s".repeat(48), KEK_BASE64: randomBytes(32).toString("base64"), HASH_PEPPER: PEPPER });
    admin = createDb(adminUrl!);
    app = createDb(appUrl!);
    svc = await import("../src/server/family-service");
    tn = await import("../src/server/tenant");
    ({ analyzeUpload } = await import("../src/server/analyze-service"));
  });
  afterAll(async () => { await admin.$disconnect(); await app.$disconnect(); });

  // ═════════════════════════ Rôles ═════════════════════════

  describe("rôles et anti-élévation de privilèges", () => {
    it("OWNER nomme un administrateur ; il ne peut ni changer son propre rôle, ni dépasser sa hiérarchie", async () => {
      const O = await newUser(); const A = await newUser("Admin"); const W = await newUser("Écriture");
      const h = await newHousehold(O, "FAMILLE");
      await join(h, A, "WRITE"); await join(h, W, "READ");

      expect(await svc.changeMemberRole(D(), T(h, O, "OWNER"), { membershipId: await mid(h, A), role: "ADMIN" })).toEqual({ ok: true, changed: true });
      expect(await roleOf(h, A)).toBe("ADMIN");
      // jamais soi-même, même pour un propriétaire
      expect(await svc.changeMemberRole(D(), T(h, O, "OWNER"), { membershipId: await mid(h, O), role: "READ" })).toMatchObject({ ok: false, code: "SELF" });
      expect(await roleOf(h, O)).toBe("OWNER");
      // sans changement : rien n'est écrit
      expect(await svc.changeMemberRole(D(), T(h, O, "OWNER"), { membershipId: await mid(h, W), role: "READ" })).toEqual({ ok: true, changed: false });
      expect(await denied(h, "SELF")).toBe(1); // la tentative sur soi-même est tracée
    });

    it("ADMIN : ne change aucun rôle, n'invite pas en ADMIN, ne retire ni propriétaire ni pair ; retire un rôle inférieur", async () => {
      const O = await newUser(); const A = await newUser("Admin"); const A2 = await newUser("Admin 2"); const W = await newUser("Écriture");
      const h = await newHousehold(O, "FAMILLE");
      await join(h, A, "ADMIN"); await join(h, A2, "ADMIN"); await join(h, W, "WRITE");
      const tA = T(h, A, "ADMIN");

      expect(await svc.changeMemberRole(D(), tA, { membershipId: await mid(h, W), role: "READ" })).toMatchObject({ ok: false, code: "FORBIDDEN" }); // member:set_role est réservé au propriétaire
      expect(await invite(tA, E("x"), "ADMIN")).toMatchObject({ ok: false, code: "ROLE_RANK" });
      expect(await svc.removeMember(D(), tA, { membershipId: await mid(h, O) })).toMatchObject({ ok: false, code: "ROLE_RANK" });
      expect(await svc.removeMember(D(), tA, { membershipId: await mid(h, A2) })).toMatchObject({ ok: false, code: "ROLE_RANK" });
      expect(await roleOf(h, O)).toBe("OWNER");
      expect(await roleOf(h, A2)).toBe("ADMIN");
      expect(await svc.removeMember(D(), tA, { membershipId: await mid(h, W) })).toMatchObject({ ok: true, userId: W.id });
      expect(await roleOf(h, W)).toBeNull();
      expect(await denied(h, "ROLE_RANK")).toBeGreaterThanOrEqual(3); // chaque tentative d'élévation est tracée
    });

    it("WRITE et READ n'ont aucun pouvoir sur les membres, les invitations, les profils ni le nom du foyer", async () => {
      const O = await newUser(); const W = await newUser("W"); const R = await newUser("R");
      const h = await newHousehold(O, "FAMILLE");
      await join(h, W, "WRITE"); await join(h, R, "READ");
      for (const [u, role] of [[W, "WRITE"], [R, "READ"]] as const) {
        const t = T(h, u, role);
        expect((await invite(t, E("z"))).ok).toBe(false);
        expect(await svc.changeMemberRole(D(), t, { membershipId: await mid(h, O), role: "READ" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
        expect(await svc.removeMember(D(), t, { membershipId: await mid(h, O) })).toMatchObject({ ok: false, code: "FORBIDDEN" });
        expect(await svc.addProfile(D(), t, { displayName: "Léa", relation: "CHILD" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
        expect(await svc.renameHousehold(D(), t, { name: "Piraté" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
        expect(await svc.revokeInvitation(D(), t, { invitationId: randomUUID() })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      }
      expect(await roleOf(h, O)).toBe("OWNER");
      expect((await admin.household.findUniqueOrThrow({ where: { id: h } })).name).toBe("Foyer test");
    });

    it("un rôle PÉRIMÉ côté requête n'élève rien : le rôle de l'acteur est relu en base dans la transaction", async () => {
      const O = await newUser(); const R = await newUser("R"); const V = await newUser("V");
      const h = await newHousehold(O, "FAMILLE");
      await join(h, R, "READ"); await join(h, V, "WRITE");
      const stale = T(h, R, "OWNER"); // la requête croit R propriétaire ; la base dit READ
      expect(await svc.changeMemberRole(D(), stale, { membershipId: await mid(h, V), role: "ADMIN" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await svc.removeMember(D(), stale, { membershipId: await mid(h, V) })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await invite(stale, E("q"))).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await roleOf(h, V)).toBe("WRITE");
    });
  });

  describe("dernier propriétaire", () => {
    it("ne peut être ni rétrogradé ni retiré ni partir ; deux propriétaires peuvent se partager la charge", async () => {
      const A = await newUser("A"); const B = await newUser("B"); const other = await newUser("Autre");
      const h = await newHousehold(A, "FAMILLE");
      await newHousehold(A); // A a un autre foyer : seul « dernier propriétaire » peut le retenir
      await join(h, B, "OWNER");
      expect(await owners(h)).toBe(2);

      // A rétrograde B : permis (il reste A)
      expect(await svc.changeMemberRole(D(), T(h, A, "OWNER"), { membershipId: await mid(h, B), role: "ADMIN" })).toMatchObject({ ok: true, changed: true });
      expect(await owners(h)).toBe(1);
      // B (administrateur) ne peut pas retirer le dernier propriétaire ; A ne peut pas partir
      expect(await svc.removeMember(D(), T(h, B, "ADMIN"), { membershipId: await mid(h, A) })).toMatchObject({ ok: false, code: "ROLE_RANK" });
      expect(await svc.leaveHousehold(D(), T(h, A, "OWNER"))).toMatchObject({ ok: false, code: "LAST_OWNER" });
      expect(await owners(h)).toBe(1);
      // un autre propriétaire nommé, A peut partir
      await join(h, other, "WRITE");
      await svc.changeMemberRole(D(), T(h, A, "OWNER"), { membershipId: await mid(h, other), role: "OWNER" });
      expect(await svc.leaveHousehold(D(), T(h, A, "OWNER"))).toEqual({ ok: true });
      expect(await owners(h)).toBe(1);
    });

    it("un propriétaire peut en retirer un autre ; le propriétaire restant est ensuite protégé", async () => {
      const A = await newUser("A"); const B = await newUser("B");
      const h = await newHousehold(A, "FAMILLE");
      await join(h, B, "OWNER");
      // B retire A : permis, B devient le seul propriétaire ; ensuite plus personne ne peut retirer B
      expect(await svc.removeMember(D(), T(h, B, "OWNER"), { membershipId: await mid(h, A) })).toMatchObject({ ok: true });
      expect(await owners(h)).toBe(1);
      const C = await newUser("C"); await join(h, C, "ADMIN");
      expect(await svc.removeMember(D(), T(h, C, "ADMIN"), { membershipId: await mid(h, B) })).toMatchObject({ ok: false });
      expect(await roleOf(h, B)).toBe("OWNER");
    });

    it("concurrence : deux propriétaires qui se rétrogradent mutuellement en même temps → il en reste toujours un", async () => {
      for (let i = 0; i < 4; i++) {
        const A = await newUser("A"); const B = await newUser("B");
        const h = await newHousehold(A, "FAMILLE");
        await join(h, B, "OWNER");
        const [r1, r2] = await Promise.all([
          svc.changeMemberRole(D(), T(h, A, "OWNER"), { membershipId: await mid(h, B), role: "ADMIN" }),
          svc.changeMemberRole(D(), T(h, B, "OWNER"), { membershipId: await mid(h, A), role: "ADMIN" }),
        ]);
        expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
        expect(await owners(h)).toBe(1);
      }
    });

    it("concurrence : deux propriétaires qui quittent le foyer en même temps → il en reste toujours un", async () => {
      const A = await newUser("A"); const B = await newUser("B");
      const h = await newHousehold(A, "FAMILLE");
      await join(h, B, "OWNER");
      await newHousehold(A); await newHousehold(B); // chacun garde un autre foyer
      const results = await Promise.all([svc.leaveHousehold(D(), T(h, A, "OWNER")), svc.leaveHousehold(D(), T(h, B, "OWNER"))]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await owners(h)).toBe(1);
    });

    it("le comptage ne déborde pas sur les AUTRES foyers de l'acteur (filtre explicite par foyer sous RLS)", async () => {
      const U1 = await newUser("U1"); const M = await newUser("M");
      const h1 = await newHousehold(U1, "FAMILLE");
      await newHousehold(U1); // U1 est aussi propriétaire d'un autre foyer : il ne doit pas compter comme « second propriétaire » de h1
      await join(h1, M, "ADMIN");
      expect(await svc.leaveHousehold(D(), T(h1, U1, "OWNER"))).toMatchObject({ ok: false, code: "LAST_OWNER" });
    });
  });

  describe("quitter, retirer", () => {
    it("quitter : adhésion supprimée, profil archivé et délié ; impossible de quitter son dernier foyer", async () => {
      const O = await newUser(); const M = await newUser("Membre");
      const h = await newHousehold(O, "FAMILLE");
      await join(h, M, "READ");
      expect(await svc.leaveHousehold(D(), T(h, M, "READ"))).toMatchObject({ ok: false, code: "LAST_HOUSEHOLD" }); // son seul foyer
      await newHousehold(M); // M a aussi son foyer personnel
      expect(await svc.leaveHousehold(D(), T(h, M, "READ"))).toEqual({ ok: true });
      expect(await roleOf(h, M)).toBeNull();
      const prof = await admin.profile.findFirstOrThrow({ where: { householdId: h, displayName: "Membre" } });
      expect(prof.userId).toBeNull();
      expect(prof.archivedAt).not.toBeNull();
      expect(await admin.auditLog.count({ where: { householdId: h, action: "member.left", actorId: M.id } })).toBe(1);
    });

    it("retirer : l'ancien membre perd l'accès, est notifié (sans lien au foyer), l'action est auditée", async () => {
      const O = await newUser(); const M = await newUser("Membre");
      const h = await newHousehold(O, "FAMILLE");
      await join(h, M, "WRITE");
      const r = await svc.removeMember(D(), T(h, O, "OWNER"), { membershipId: await mid(h, M) });
      expect(r).toMatchObject({ ok: true, userId: M.id, name: "Membre" });
      expect(await tn.resolveTenant(app, M.id, h)).toBeNull(); // plus membre
      const n = await admin.notification.findFirstOrThrow({ where: { userId: M.id, type: "member_removed" } });
      expect(n.householdId).toBeNull();
      expect(await admin.auditLog.count({ where: { householdId: h, action: "member.removed", targetId: M.id } })).toBe(1);
    });

    it("on ne se retire pas soi-même par « retirer » (passer par « quitter »)", async () => {
      const O = await newUser(); const h = await newHousehold(O, "FAMILLE");
      expect(await svc.removeMember(D(), T(h, O, "OWNER"), { membershipId: await mid(h, O) })).toMatchObject({ ok: false, code: "SELF" });
    });
  });

  // ═════════════════════════ Invitations ═════════════════════════

  describe("invitations", () => {
    it("offres Gratuit et Solo : l'invitation est refusée avec incitation à l'abonnement", async () => {
      const O = await newUser();
      const free = await newHousehold(O);
      expect(await invite(T(free, O, "OWNER"), E("a"))).toMatchObject({ ok: false, code: "PLAN", upgrade: true });
      const solo = await newHousehold(O, "SOLO");
      expect(await invite(T(solo, O, "OWNER"), E("a"))).toMatchObject({ ok: false, code: "PLAN", upgrade: true });
      expect(await admin.invitation.count({ where: { householdId: { in: [free, solo] } } })).toBe(0);
    });

    it("le jeton n'est stocké que haché (aucun clair en base), l'invitation expire à 7 jours, l'email est envoyé", async () => {
      const O = await newUser("Alice"); const h = await newHousehold(O, "FAMILLE", "Chez Alice");
      const r = await invite(T(h, O, "OWNER"), `  ${MIXED} `, "WRITE");
      expect(r).toMatchObject({ ok: true });
      const mail = sent.at(-1)!;
      expect(mail).toMatchObject({ to: `invité.${RUN}@exemple.test`, householdName: "Chez Alice", inviterName: "Alice", role: "WRITE" });
      expect(mail.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const row = await admin.invitation.findFirstOrThrow({ where: { householdId: h } });
      expect(row.tokenHash).toBe(hmac(mail.token, PEPPER));
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.tokenHash).not.toContain(mail.token);
      expect(row.email).toBe(`invité.${RUN}@exemple.test`);
      expect(row.expiresAt.getTime() - NOW.getTime()).toBe(7 * DAY);
      expect(row).toMatchObject({ role: "WRITE", invitedById: O.id, acceptedAt: null, revokedAt: null });

      // le jeton en clair n'existe ni dans les lignes d'invitation, ni dans l'audit, ni dans les notifications
      const asText = JSON.stringify(await admin.invitation.findMany({ where: { householdId: h } }));
      expect(asText).not.toContain(mail.token);
      expect(JSON.stringify(await admin.auditLog.findMany({ where: { householdId: h } }))).not.toContain(mail.token);
      expect(JSON.stringify(await admin.auditLog.findMany({ where: { householdId: h } }))).not.toContain("exemple.test"); // ni l'adresse de l'invité
      expect(await admin.auditLog.count({ where: { householdId: h, action: "invitation.created" } })).toBe(1);
    });

    it("la base elle-même refuse un jeton en clair, et une seconde invitation en attente pour le même email (casse ignorée)", async () => {
      const O = await newUser(); const h = await newHousehold(O, "FAMILLE");
      const base = { householdId: h, role: "READ" as const, invitedById: O.id, expiresAt: new Date(Date.now() + DAY) };
      await expect(admin.invitation.create({ data: { ...base, email: E("a"), tokenHash: "jeton-en-clair" } })).rejects.toThrow();
      await expect(admin.invitation.create({ data: { ...base, email: E("a"), tokenHash: randomBytes(32).toString("base64url") } })).rejects.toThrow(); // 43 caractères : ce n'est pas une empreinte
      const first = await admin.invitation.create({ data: { ...base, email: E("a"), tokenHash: hmac(`t1-${RUN}`, PEPPER) } });
      await expect(admin.invitation.create({ data: { ...base, email: E("a").toUpperCase(), tokenHash: hmac(`t2-${RUN}`, PEPPER) } })).rejects.toThrow();
      await admin.invitation.update({ where: { id: first.id }, data: { revokedAt: new Date() } });
      await expect(admin.invitation.create({ data: { ...base, email: E("a").toUpperCase(), tokenHash: hmac(`t2-${RUN}`, PEPPER) } })).resolves.toBeTruthy();
    });

    it("une seule invitation active par (foyer, email) ; déjà membre ; une invitation expirée est remplacée", async () => {
      const O = await newUser(); const M = await newUser("Membre", E("membre"));
      const h = await newHousehold(O, "FAMILLE"); await join(h, M, "READ");
      const t = T(h, O, "OWNER");
      expect(await invite(t, E("membre"))).toMatchObject({ ok: false, code: "ALREADY_MEMBER" });
      expect(await invite(t, E("new"))).toMatchObject({ ok: true });
      expect(await invite(t, E("new").toUpperCase())).toMatchObject({ ok: false, code: "DUPLICATE" });
      expect(await admin.invitation.count({ where: { householdId: h, email: E("new"), revokedAt: null } })).toBe(1);
      // 8 jours plus tard l'ancienne est expirée : une nouvelle invitation la remplace (l'ancienne est révoquée)
      const later = new Date(NOW.getTime() + 8 * DAY);
      expect(await invite(t, E("new"), "READ", { now: later })).toMatchObject({ ok: true });
      expect(await admin.invitation.count({ where: { householdId: h, email: E("new"), revokedAt: null, acceptedAt: null } })).toBe(1);
      expect(await admin.invitation.count({ where: { householdId: h, email: E("new"), revokedAt: { not: null } } })).toBe(1);
    });

    it("places : membres + profils sans compte + invitations en attente ≤ 5 (offre Famille) ; révoquer ou archiver libère", async () => {
      const O = await newUser(); const h = await newHousehold(O, "FAMILLE"); const t = T(h, O, "OWNER");
      for (const e of ["a", "b", "c"]) expect(await invite(t, E(e))).toMatchObject({ ok: true }); // 1 + 3 = 4
      expect(await svc.addProfile(D(), t, { displayName: "Léa", relation: "CHILD" })).toMatchObject({ ok: true }); // 5
      const full = await invite(t, E("d"));
      expect(full).toMatchObject({ ok: false, code: "QUOTA" });
      expect(await svc.addProfile(D(), t, { displayName: "Tom", relation: "CHILD" })).toMatchObject({ ok: false, code: "QUOTA" });
      expect(await admin.invitation.count({ where: { householdId: h } })).toBe(3);

      const inv = await admin.invitation.findFirstOrThrow({ where: { householdId: h, email: E("a") } });
      expect(await svc.revokeInvitation(D(), t, { invitationId: inv.id })).toEqual({ ok: true });
      expect(await invite(t, E("d"))).toMatchObject({ ok: true }); // la place libérée est reprise
      const lea = await admin.profile.findFirstOrThrow({ where: { householdId: h, displayName: "Léa" } });
      expect(await invite(t, E("e"))).toMatchObject({ ok: false, code: "QUOTA" });
      expect(await svc.archiveProfile(D(), t, { profileId: lea.id })).toEqual({ ok: true });
      expect(await invite(t, E("e"))).toMatchObject({ ok: true });
    });

    it("les invitations expirées ne comptent plus dans les places", async () => {
      const O = await newUser(); const h = await newHousehold(O, "FAMILLE"); const t = T(h, O, "OWNER");
      for (const e of ["a", "b", "c", "d"]) expect(await invite(t, E(e))).toMatchObject({ ok: true }); // complet
      expect(await invite(t, E("e"))).toMatchObject({ ok: false, code: "QUOTA" });
      const later = new Date(NOW.getTime() + 8 * DAY);
      expect(await invite(t, E("e"), "READ", { now: later })).toMatchObject({ ok: true });
    });

    it("échec d'envoi de l'email : aucune invitation fantôme, la place n'est pas consommée", async () => {
      const O = await newUser(); const h = await newHousehold(O, "FAMILLE"); const t = T(h, O, "OWNER");
      const r = await invite(t, E("panne"), "READ", { send: async () => { throw new Error("SMTP indisponible"); } });
      expect(r).toMatchObject({ ok: false, code: "MAIL_FAILED" });
      const row = await admin.invitation.findFirstOrThrow({ where: { householdId: h } });
      expect(row.revokedAt).not.toBeNull();
      expect(await invite(t, E("panne"))).toMatchObject({ ok: true }); // on peut réessayer tout de suite
    });

    it("renvoyer : nouveau jeton, l'ancien lien cesse de fonctionner, l'échéance repart à 7 jours", async () => {
      const O = await newUser(); const G = await newUser("Invité", E("invite"));
      const h = await newHousehold(O, "FAMILLE"); const t = T(h, O, "OWNER");
      await invite(t, E("invite"), "WRITE");
      const first = tokenFor(E("invite"));
      const inv = await admin.invitation.findFirstOrThrow({ where: { householdId: h } });
      const later = new Date(NOW.getTime() + 3 * DAY);
      expect(await svc.resendInvitation(D({ now: later }), t, { invitationId: inv.id })).toMatchObject({ ok: true });
      const second = tokenFor(E("invite"));
      expect(second).not.toBe(first);
      const after = await admin.invitation.findUniqueOrThrow({ where: { id: inv.id } });
      expect(after.tokenHash).toBe(hmac(second, PEPPER));
      expect(after.expiresAt.getTime()).toBe(later.getTime() + 7 * DAY);
      expect(await accept(G, first, { now: later })).toMatchObject({ ok: false, code: "INVALID_INVITE" }); // ancien lien mort
      expect(await accept(G, second, { now: later })).toMatchObject({ ok: true, alreadyMember: false });
    });

    it("révoquer : le lien ne fonctionne plus", async () => {
      const O = await newUser(); const G = await newUser("Invité", E("rev"));
      const h = await newHousehold(O, "FAMILLE"); const t = T(h, O, "OWNER");
      await invite(t, E("rev"));
      const inv = await admin.invitation.findFirstOrThrow({ where: { householdId: h } });
      expect(await svc.revokeInvitation(D(), t, { invitationId: inv.id })).toEqual({ ok: true });
      expect(await accept(G, tokenFor(E("rev")))).toMatchObject({ ok: false, code: "INVALID_INVITE" });
      expect(await roleOf(h, G)).toBeNull();
      expect(await svc.revokeInvitation(D(), t, { invitationId: inv.id })).toMatchObject({ ok: false, code: "NOT_FOUND" }); // déjà révoquée
    });
  });

  describe("acceptation d'une invitation", () => {
    it("crée l'adhésion avec le rôle invité et un profil, consomme l'invitation, notifie l'inviteur et audite ; casse de l'email ignorée", async () => {
      const O = await newUser("Alice"); const G = await newUser("Bruno", E("Bruno.Invite"));
      const h = await newHousehold(O, "FAMILLE"); const t = T(h, O, "OWNER");
      await invite(t, E("bruno.invite"), "WRITE");
      const r = await accept(G, tokenFor(E("bruno.invite")));
      expect(r).toMatchObject({ ok: true, householdId: h, alreadyMember: false });
      expect(await roleOf(h, G)).toBe("WRITE");
      expect(await admin.profile.count({ where: { householdId: h, userId: G.id, displayName: "Bruno", relation: "SELF", archivedAt: null } })).toBe(1);
      expect((await admin.invitation.findFirstOrThrow({ where: { householdId: h } })).acceptedAt).not.toBeNull();
      expect(await admin.notification.count({ where: { userId: O.id, type: "member_joined", householdId: h } })).toBe(1);
      expect(await admin.auditLog.count({ where: { householdId: h, action: "invitation.accepted", actorId: G.id } })).toBe(1);
      expect(await admin.auditLog.count({ where: { householdId: h, action: "member.joined", actorId: G.id } })).toBe(1);
      // le nouveau membre est résolu par le foyer préféré (cookie) avec le rôle lu en base
      expect(await tn.resolveActiveTenant(app, G.id, h)).toEqual({ userId: G.id, householdId: h, role: "WRITE" });
    });

    it("usage unique : un second usage du même lien échoue, même par le même compte", async () => {
      const O = await newUser(); const G = await newUser("Invité", E("u"));
      const h = await newHousehold(O, "FAMILLE");
      await invite(T(h, O, "OWNER"), E("u"));
      const token = tokenFor(E("u"));
      expect(await accept(G, token)).toMatchObject({ ok: true });
      expect(await accept(G, token)).toMatchObject({ ok: false, code: "INVALID_INVITE" });
      expect(await admin.membership.count({ where: { householdId: h, userId: G.id } })).toBe(1);
    });

    it("course : deux acceptations simultanées → une seule réussit, une seule adhésion", async () => {
      for (let i = 0; i < 3; i++) {
        const O = await newUser(); const G = await newUser("Invité", `race${i}-${randomUUID()}@t.test`);
        const h = await newHousehold(O, "FAMILLE");
        await invite(T(h, O, "OWNER"), G.email, "ADMIN");
        const token = tokenFor(G.email);
        const results = await Promise.all([accept(G, token), accept(G, token), accept(G, token)]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && r.code === "INVALID_INVITE")).toHaveLength(2);
        expect(await admin.membership.count({ where: { householdId: h, userId: G.id } })).toBe(1);
        expect(await admin.profile.count({ where: { householdId: h, userId: G.id } })).toBe(1);
      }
    });

    it("mauvaise adresse ou email non vérifié : refus sans rien consommer (et sans dire à qui l'invitation est destinée)", async () => {
      const O = await newUser(); const G = await newUser("Invité", E("bonne")); const X = await newUser("Intrus", E("autre"));
      const h = await newHousehold(O, "FAMILLE");
      await invite(T(h, O, "OWNER"), E("bonne"));
      const token = tokenFor(E("bonne"));
      const wrong = await accept(X, token);
      expect(wrong).toMatchObject({ ok: false, code: "WRONG_EMAIL" });
      expect(JSON.stringify(wrong)).not.toContain(E("bonne"));
      expect(await accept(G, token, {}, { emailVerified: false })).toMatchObject({ ok: false, code: "WRONG_EMAIL" });
      expect(await roleOf(h, X)).toBeNull();
      expect((await admin.invitation.findFirstOrThrow({ where: { householdId: h } })).acceptedAt).toBeNull();
      expect(await accept(G, token)).toMatchObject({ ok: true }); // la bonne personne peut encore l'utiliser
    });

    it("jeton inconnu, mal formé, expiré, révoqué ou déjà utilisé : toujours le même message générique", async () => {
      const O = await newUser(); const G = await newUser("Invité", E("g"));
      const h = await newHousehold(O, "FAMILLE"); const t = T(h, O, "OWNER");
      await invite(t, E("g"));
      const good = tokenFor(E("g"));
      const later = new Date(NOW.getTime() + 8 * DAY);

      const unknown = await accept(G, randomBytes(32).toString("base64url"));
      const malformed = await accept(G, "pas un jeton !");
      const expired = await accept(G, good, { now: later });
      expect([unknown, malformed, expired].every((r) => !r.ok && r.code === "INVALID_INVITE")).toBe(true);

      await invite(t, E("g"), "READ", { now: later }); // remplace l'expirée
      const second = tokenFor(E("g"));
      const inv = await admin.invitation.findFirstOrThrow({ where: { householdId: h, revokedAt: null } });
      await svc.revokeInvitation(D({ now: later }), t, { invitationId: inv.id });
      const revoked = await accept(G, second, { now: later });
      expect(revoked).toMatchObject({ ok: false, code: "INVALID_INVITE" });

      await invite(t, E("g"), "READ", { now: later });
      const third = tokenFor(E("g"));
      await accept(G, third, { now: later });
      const used = await accept(G, third, { now: later });
      const messages = new Set([unknown, malformed, expired, revoked, used].map((r) => (r.ok ? "ok" : r.error)));
      expect(messages.size).toBe(1);
      expect([...messages][0]).not.toBe("ok");
    });

    it("l'aperçu de la page d'invitation ne distingue que : invalide, mauvaise adresse, déjà membre, ok", async () => {
      const O = await newUser(); const G = await newUser("Invité", E("p")); const X = await newUser("Intrus");
      const h = await newHousehold(O, "FAMILLE", "Chez les Martin");
      await invite(T(h, O, "OWNER"), E("p"), "ADMIN");
      const token = tokenFor(E("p"));
      expect(await svc.previewInvitation(D(), asUser(G), "x".repeat(43))).toEqual({ state: "invalid" });
      expect(await svc.previewInvitation(D(), asUser(X), token)).toEqual({ state: "wrong_email" });
      expect(await svc.previewInvitation(D(), asUser(G), token)).toEqual({ state: "ok", householdName: "Chez les Martin", role: "ADMIN" });
      await accept(G, token);
      expect(await svc.previewInvitation(D(), asUser(G), token)).toEqual({ state: "invalid" }); // consommée
    });

    it("offre rétrogradée entre l'envoi et l'acceptation : refus, l'invitation n'est PAS consommée", async () => {
      const O = await newUser(); const G = await newUser("Invité", E("dg"));
      const h = await newHousehold(O, "FAMILLE");
      await invite(T(h, O, "OWNER"), E("dg"));
      await setPlan(h, "SOLO");
      const token = tokenFor(E("dg"));
      expect(await accept(G, token)).toMatchObject({ ok: false, code: "PLAN" });
      expect((await admin.invitation.findFirstOrThrow({ where: { householdId: h } })).acceptedAt).toBeNull();
      await setPlan(h, "FAMILLE");
      expect(await accept(G, token)).toMatchObject({ ok: true });
    });

    it("l'invitant a supprimé son compte entre-temps : l'acceptation réussit quand même (l'invitation appartient au foyer)", async () => {
      const O = await newUser(); const A = await newUser("Admin"); const G = await newUser("Invité", E("orphelin"));
      const h = await newHousehold(O, "FAMILLE"); await join(h, A, "ADMIN");
      await invite(T(h, A, "ADMIN"), E("orphelin"), "READ");
      await admin.user.delete({ where: { id: A.id } });
      expect(await accept(G, tokenFor(E("orphelin")))).toMatchObject({ ok: true, alreadyMember: false });
      expect(await roleOf(h, G)).toBe("READ");
      expect(await admin.notification.count({ where: { userId: A.id } })).toBe(0);
    });

    it("déjà membre : l'invitation est consommée sans changer le rôle (ni promotion ni rétrogradation)", async () => {
      const O = await newUser(); const G = await newUser("Invité", E("dm"));
      const h = await newHousehold(O, "FAMILLE");
      await invite(T(h, O, "OWNER"), E("dm"), "ADMIN");
      await join(h, G, "READ"); // devenu membre par un autre biais
      expect(await accept(G, tokenFor(E("dm")))).toMatchObject({ ok: true, alreadyMember: true });
      expect(await roleOf(h, G)).toBe("READ");
    });
  });

  // ═════════════════════════ Isolation ═════════════════════════

  describe("isolation entre foyers (IDOR)", () => {
    it("on ne peut ni lire, ni révoquer, ni renvoyer, ni modifier, ni retirer ce qui appartient à un autre foyer", async () => {
      const O1 = await newUser("O1"); const O2 = await newUser("O2"); const M2 = await newUser("M2");
      const h1 = await newHousehold(O1, "FAMILLE"); const h2 = await newHousehold(O2, "FAMILLE");
      await join(h2, M2, "READ");
      await invite(T(h2, O2, "OWNER"), E("secret"));
      const inv2 = await admin.invitation.findFirstOrThrow({ where: { householdId: h2 } });
      const prof2 = await admin.profile.create({ data: { householdId: h2, displayName: "Enfant H2", relation: "CHILD" } });
      const t1 = T(h1, O1, "OWNER");

      expect(await svc.revokeInvitation(D(), t1, { invitationId: inv2.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await svc.resendInvitation(D(), t1, { invitationId: inv2.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await svc.changeMemberRole(D(), t1, { membershipId: await mid(h2, M2), role: "OWNER" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await svc.removeMember(D(), t1, { membershipId: await mid(h2, M2) })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await svc.archiveProfile(D(), t1, { profileId: prof2.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await roleOf(h2, M2)).toBe("READ");
      expect((await admin.invitation.findUniqueOrThrow({ where: { id: inv2.id } })).revokedAt).toBeNull();
      expect((await admin.profile.findUniqueOrThrow({ where: { id: prof2.id } })).archivedAt).toBeNull();

      // lecture : la vue Famille d'un foyer ne montre jamais les données d'un autre
      const v1 = await svc.loadFamily(app, t1, NOW);
      expect(v1.members.map((m) => m.userId)).toEqual([O1.id]);
      expect(v1.invitations).toHaveLength(0);
      expect(v1.profiles).toHaveLength(0);
      const v2 = await svc.loadFamily(app, T(h2, O2, "OWNER"), NOW);
      expect(v2.members.map((m) => m.userId).sort()).toEqual([O2.id, M2.id].sort());
      expect(v2.invitations.map((i) => i.email)).toEqual([E("secret")]);
    });

    it("RLS : sans contexte de foyer, aucune invitation n'est lisible ; avec un foyer, seulement les siennes", async () => {
      const O1 = await newUser(); const O2 = await newUser();
      const h1 = await newHousehold(O1, "FAMILLE"); const h2 = await newHousehold(O2, "FAMILLE");
      await invite(T(h1, O1, "OWNER"), E("r1")); await invite(T(h2, O2, "OWNER"), E("r2"));
      expect(await app.invitation.findMany()).toEqual([]);
      const mine = await withTenant(app, { userId: O1.id, householdId: h1 }, (tx) => tx.invitation.findMany());
      expect(mine.map((i) => i.email)).toEqual([E("r1")]);
      const cross = await withTenant(app, { userId: O1.id, householdId: h1 }, (tx) => tx.invitation.findMany({ where: { householdId: h2 } }));
      expect(cross).toEqual([]);
    });

    it("la fonction de recherche par empreinte ne donne qu'une ligne, et seulement pour une empreinte exacte", async () => {
      const O = await newUser(); const h = await newHousehold(O, "FAMILLE", "Chez les Dupont");
      await invite(T(h, O, "OWNER"), E("f"), "ADMIN");
      const token = tokenFor(E("f"));
      const hit = await svc.lookupInvitation(app, token, PEPPER);
      expect(hit).toMatchObject({ householdId: h, householdName: "Chez les Dupont", email: E("f"), role: "ADMIN", acceptedAt: null, revokedAt: null });
      expect(hit!.expiresAt).toBeInstanceOf(Date);
      expect(await svc.lookupInvitation(app, randomBytes(32).toString("base64url"), PEPPER)).toBeNull();
      expect(await svc.lookupInvitation(app, token, "autre-pepper-autre-pepper-autre-pepper!")).toBeNull(); // mauvais secret serveur : pas d'empreinte correspondante
      // l'empreinte elle-même n'est PAS un jeton valable, et le jeton brut n'est pas non plus une empreinte
      const stored = (await admin.invitation.findFirstOrThrow({ where: { householdId: h } })).tokenHash;
      expect(await svc.lookupInvitation(app, stored, PEPPER)).toBeNull();
      expect(await app.$queryRaw`SELECT * FROM invitation_lookup(${token})`).toEqual([]); // la fonction exige une empreinte hexadécimale
      expect(await app.$queryRaw`SELECT * FROM invitation_lookup(${"' OR '1'='1"})`).toEqual([]);
    });

    it("le contexte « foyer actif » : un foyer dont on n'est pas membre n'est jamais retenu (cookie forgé)", async () => {
      const U = await newUser(); const V = await newUser();
      const h1 = await newHousehold(U); const hOther = await newHousehold(V);
      const h2 = await newHousehold(V, "FAMILLE"); await join(h2, U, "READ");
      expect(await tn.resolveActiveTenant(app, U.id, h2)).toEqual({ userId: U.id, householdId: h2, role: "READ" });
      expect(await tn.resolveActiveTenant(app, U.id, hOther)).toEqual({ userId: U.id, householdId: h1, role: "OWNER" }); // repli sur son premier foyer
      expect(await tn.resolveActiveTenant(app, U.id, undefined)).toEqual({ userId: U.id, householdId: h1, role: "OWNER" });
      expect(await tn.resolveActiveTenant(app, "inconnu", h1)).toBeNull();
      expect(await tn.resolveTenant(app, U.id, hOther)).toBeNull(); // la version stricte reste stricte
      const list = await tn.listHouseholds(app, U.id);
      expect(list.map((x) => [x.id, x.role])).toEqual([[h1, "OWNER"], [h2, "READ"]]);
    });

    it("lecture du cookie `mai_hh` dans un en-tête Cookie brut : seule une valeur UUID valide est retenue", () => {
      const hh = randomUUID();
      expect(tn.householdIdFromCookieHeader(`a=1; mai_hh=${hh}; b=2`)).toBe(hh);
      expect(tn.householdIdFromCookieHeader(`mai_hh=${hh.toUpperCase()}`)).toBe(hh);
      expect(tn.householdIdFromCookieHeader(`mai_hh="${hh}"`)).toBe(hh);
      expect(tn.householdIdFromCookieHeader(`mai_hh=${hh}; mai_hh=${randomUUID()}`)).toBe(hh); // le premier l'emporte
      for (const bad of ["mai_hh=pas-un-uuid", `mai_hh=${hh}%00`, `xmai_hh=${hh}`, `mai_hh=${hh}x`, "mai_hh=", "autre=1", "mai_hh=%E0%A4%A"]) {
        expect(tn.householdIdFromCookieHeader(bad), bad).toBeUndefined();
      }
      expect(tn.householdIdFromCookieHeader(null)).toBeUndefined();
      expect(tn.householdIdFromCookieHeader("x".repeat(9000))).toBeUndefined();
      expect(tn.householdCookieOptions("dev")).toMatchObject({ httpOnly: true, sameSite: "lax", secure: false, path: "/" });
      expect(tn.householdCookieOptions("production")).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    });
  });

  // ═════════════════════════ Profils ═════════════════════════

  describe("profils (personnes sans compte)", () => {
    it("ajout et archivage par OWNER/ADMIN ; refusés sur l'offre Solo avec incitation ; distincts des membres", async () => {
      const O = await newUser(); const A = await newUser("Admin");
      const h = await newHousehold(O, "FAMILLE"); await join(h, A, "ADMIN");
      const added = await svc.addProfile(D(), T(h, A, "ADMIN"), { displayName: "  Léa  ", relation: "CHILD" });
      expect(added).toMatchObject({ ok: true });
      const lea = await admin.profile.findFirstOrThrow({ where: { householdId: h, displayName: "Léa" } });
      expect(lea).toMatchObject({ userId: null, relation: "CHILD", archivedAt: null });
      expect((await svc.loadFamily(app, T(h, O, "OWNER"), NOW)).profiles.map((p) => p.displayName)).toEqual(["Léa"]); // les membres n'y figurent pas
      expect(await svc.archiveProfile(D(), T(h, A, "ADMIN"), { profileId: lea.id })).toEqual({ ok: true });
      expect((await admin.profile.findUniqueOrThrow({ where: { id: lea.id } })).archivedAt).not.toBeNull();
      expect(await svc.archiveProfile(D(), T(h, A, "ADMIN"), { profileId: lea.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });

      const solo = await newHousehold(O, "SOLO");
      expect(await svc.addProfile(D(), T(solo, O, "OWNER"), { displayName: "Tom", relation: "CHILD" })).toMatchObject({ ok: false, code: "PLAN", upgrade: true });
      expect(await admin.auditLog.count({ where: { householdId: h, action: { in: ["profile.created", "profile.archived"] } } })).toBe(2);
    });

    it("le profil d'un membre ne s'archive pas à la main (il suit l'adhésion)", async () => {
      const O = await newUser(); const h = await newHousehold(O, "FAMILLE");
      const own = await admin.profile.findFirstOrThrow({ where: { householdId: h, userId: O.id } });
      expect(await svc.archiveProfile(D(), T(h, O, "OWNER"), { profileId: own.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    });

    it("renommer le foyer : propriétaire et administrateur", async () => {
      const O = await newUser(); const A = await newUser("A"); const h = await newHousehold(O, "FAMILLE"); await join(h, A, "ADMIN");
      expect(await svc.renameHousehold(D(), T(h, A, "ADMIN"), { name: "  Chez nous  " })).toEqual({ ok: true });
      expect((await admin.household.findUniqueOrThrow({ where: { id: h } })).name).toBe("Chez nous");
      expect(await admin.auditLog.count({ where: { householdId: h, action: "household.renamed" } })).toBe(1);
    });
  });

  // ═════════════════════════ Vue Famille ═════════════════════════

  describe("vue Famille", () => {
    it("les invitations (adresses email) ne sont montrées qu'à ceux qui peuvent inviter ; places comptées", async () => {
      const O = await newUser("Alice"); const R = await newUser("Lecteur"); const h = await newHousehold(O, "FAMILLE");
      await join(h, R, "READ");
      await invite(T(h, O, "OWNER"), E("attente"));
      const owner = await svc.loadFamily(app, T(h, O, "OWNER"), NOW);
      const reader = await svc.loadFamily(app, T(h, R, "READ"), NOW);
      expect(owner.invitations.map((i) => i.email)).toEqual([E("attente")]);
      expect(reader.invitations).toEqual([]);
      expect(owner.seats).toEqual({ used: 3, limit: 5 }); // 2 membres + 1 invitation en attente
      expect(owner.members.find((m) => m.isYou)?.userId).toBe(O.id);
      expect(owner).toMatchObject({ plan: "FAMILLE", familyIncluded: true });
    });
  });

  // ═════════════════════════ Documents ↔ personne ═════════════════════════

  describe("« Pour qui est ce document ? » (profileId)", () => {
    const ai = { provider: new FakeProvider(), models: { mini: "m-mini", full: "m-full" }, pricing: { "m-mini": { inPerMTok: 1_000_000, outPerMTok: 2_000_000 } } };
    const analyze = (t: ReturnType<typeof T>, bytes: Uint8Array, profileId?: string | null) =>
      analyzeUpload({ db: app, ai, pepper: PEPPER, now: () => NOW }, t, { bytes }, { profileId });
    const withConsent = async (u: U) => { await admin.consent.createMany({ data: ["SENSITIVE_DATA_PROCESSING", "AI_PROCESSING"].map((type) => ({ userId: u.id, type: type as "AI_PROCESSING", granted: true, version: "test" })) }); };

    it("rattache le document à un profil actif du foyer ; sans profil, rien n'est rattaché", async () => {
      const O = await newUser(); await withConsent(O);
      const h = await newHousehold(O, "FAMILLE");
      const lea = await admin.profile.create({ data: { householdId: h, displayName: "Léa", relation: "CHILD" } });
      const t = T(h, O, "OWNER");
      const file = await pdf();
      const r = await analyze(t, file, lea.id);
      expect(r.ok).toBe(true);
      if (r.ok) expect((await admin.document.findUniqueOrThrow({ where: { id: r.saved.documentId } })).profileId).toBe(lea.id);
      const r2 = await analyze(t, file, null);
      if (r2.ok) expect((await admin.document.findUniqueOrThrow({ where: { id: r2.saved.documentId } })).profileId).toBeNull();
      // le profil du membre lui-même est aussi une cible valable
      const own = await admin.profile.findFirstOrThrow({ where: { householdId: h, userId: O.id } });
      const r3 = await analyze(t, file, own.id);
      expect(r3.ok).toBe(true);
    });

    it("IDOR : le profil d'un AUTRE foyer est refusé, sans consommer de quota ni créer de document", async () => {
      const O = await newUser(); await withConsent(O); const V = await newUser();
      const h = await newHousehold(O, "FAMILLE"); const hOther = await newHousehold(V, "FAMILLE");
      const foreign = await admin.profile.create({ data: { householdId: hOther, displayName: "Enfant d'ailleurs", relation: "CHILD" } });
      const r = await analyze(T(h, O, "OWNER"), await pdf(), foreign.id);
      expect(r).toMatchObject({ ok: false, error: { code: "PROFILE" } });
      expect(await admin.document.count({ where: { householdId: h } })).toBe(0);
      expect(await admin.usageCounter.count({ where: { householdId: h } })).toBe(0);
      expect(await admin.document.count({ where: { profileId: foreign.id } })).toBe(0);
      // identifiant inexistant et profil archivé : même refus
      expect(await analyze(T(h, O, "OWNER"), await pdf(), randomUUID())).toMatchObject({ ok: false, error: { code: "PROFILE" } });
      const archived = await admin.profile.create({ data: { householdId: h, displayName: "Ancien", relation: "OTHER", archivedAt: new Date() } });
      expect(await analyze(T(h, O, "OWNER"), await pdf(), archived.id)).toMatchObject({ ok: false, error: { code: "PROFILE" } });
    });

    it("un lecteur ne peut toujours pas analyser, avec ou sans profil", async () => {
      const O = await newUser(); const R = await newUser("R"); await withConsent(R);
      const h = await newHousehold(O, "FAMILLE"); await join(h, R, "READ");
      const own = await admin.profile.findFirstOrThrow({ where: { householdId: h, userId: R.id } });
      expect(await analyze(T(h, R, "READ"), await pdf(), own.id)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    });

    it("la liste des personnes proposées = profils actifs du foyer actif uniquement", async () => {
      const O = await newUser("Alice"); const V = await newUser("Voisin");
      const h = await newHousehold(O, "FAMILLE"); await newHousehold(V, "FAMILLE");
      await admin.profile.create({ data: { householdId: h, displayName: "Léa", relation: "CHILD" } });
      await admin.profile.create({ data: { householdId: h, displayName: "Archivée", relation: "CHILD", archivedAt: new Date() } });
      const people = await svc.listPeople(app, T(h, O, "OWNER"));
      expect(people.map((p) => [p.label, p.isYou])).toEqual([["Alice", true], ["Léa", false]]);
    });
  });
});
