import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@mon-agent-ia/db";
import type { Mail, MailTransport } from "@mon-agent-ia/mail";
import { dispatchReminders } from "../src/reminders.ts";

const adminUrl = process.env["TEST_ADMIN_URL"];
const svcUrl = process.env["TEST_SERVICE_URL"];
if (process.env["CI"] && !(adminUrl && svcUrl)) throw new Error("TEST_ADMIN_URL / TEST_SERVICE_URL requis en CI");
const run = adminUrl && svcUrl ? describe : describe.skip;

const NOW = new Date("2026-10-08T10:00:00Z");
const DUE = new Date("2026-10-15T00:00:00Z");

class Inbox implements MailTransport {
  sent: Mail[] = [];
  failFor = new Set<string>();
  async send(m: Mail) {
    if (this.failFor.has(m.to)) throw new Error("boîte pleine");
    this.sent.push(m);
  }
}

run("envoi des rappels", () => {
  let admin: Db;
  let svc: Db;

  async function setup(opts: { members?: { role: "OWNER" | "READ" | "WRITE"; pref?: boolean; banned?: boolean }[]; deadline?: Partial<{ status: "OPEN" | "DONE"; title: string; amountCents: number | null }>; channels?: ("EMAIL" | "IN_APP")[]; remindAt?: Date } = {}) {
    const householdId = randomUUID();
    await admin.household.create({ data: { id: householdId, name: "T", wrappedDek: Buffer.from("x") } });
    const users: { id: string; email: string }[] = [];
    for (const m of opts.members ?? [{ role: "OWNER" as const }]) {
      const id = `u-${randomUUID()}`;
      const email = `${id}@t.test`;
      await admin.user.create({ data: { id, name: "T", email, bannedAt: m.banned ? NOW : null } });
      await admin.membership.create({ data: { householdId, userId: id, role: m.role } });
      if (m.pref === false) await admin.notificationPreference.createMany({ data: [{ userId: id, type: "deadline_reminder", channel: "EMAIL", enabled: false }, { userId: id, type: "deadline_reminder", channel: "IN_APP", enabled: false }] });
      users.push({ id, email });
    }
    const dl = await admin.deadline.create({ data: { householdId, kind: "PAYMENT", title: opts.deadline?.title ?? "Payer la facture", dueDate: DUE, amountCents: opts.deadline?.amountCents === undefined ? 8420 : opts.deadline.amountCents, status: opts.deadline?.status ?? "OPEN" } });
    const reminders = [];
    for (const channel of opts.channels ?? ["EMAIL", "IN_APP"]) {
      reminders.push(await admin.reminder.create({ data: { householdId, deadlineId: dl.id, channel, remindAt: opts.remindAt ?? new Date(NOW.getTime() - 60_000) } }));
    }
    return { householdId, users, deadline: dl, reminders };
  }
  const go = (mail: MailTransport, over: Record<string, unknown> = {}) => dispatchReminders({ db: svc, mail, appUrl: "https://app.test", now: () => NOW, ...over });

  beforeAll(() => { admin = createDb(adminUrl!); svc = createDb(svcUrl!); });
  afterAll(async () => { await admin.$disconnect(); await svc.$disconnect(); });

  it("envoie l'email et la notification aux membres qui peuvent agir, puis marque envoyé", async () => {
    const s = await setup({ members: [{ role: "OWNER" }, { role: "WRITE" }, { role: "READ" }] });
    const inbox = new Inbox();
    await go(inbox);
    const to = inbox.sent.filter((m) => s.users.some((u) => u.email === m.to)).map((m) => m.to).sort();
    expect(to).toEqual([s.users[0]!.email, s.users[1]!.email].sort()); // le lecteur n'est pas prévenu
    const mail = inbox.sent.find((m) => m.to === s.users[0]!.email)!;
    expect(mail.subject).toBe("Rappel : Payer la facture");
    expect(mail.text).toContain("15 octobre 2026");
    expect(mail.text).toContain("dans 7 jours");
    expect(mail.text).toMatch(/84,20\s€/);
    expect(mail.text).toContain("https://app.test/app/deadlines");
    const notifs = await admin.notification.findMany({ where: { householdId: s.householdId } });
    expect(notifs).toHaveLength(2);
    expect(notifs[0]).toMatchObject({ type: "deadline_reminder", title: "Rappel : Payer la facture" });
    const rows = await admin.reminder.findMany({ where: { householdId: s.householdId } });
    expect(rows.every((r) => r.status === "SENT" && r.sentAt)).toBe(true);
  });

  it("ne renvoie jamais un rappel déjà envoyé", async () => {
    const s = await setup();
    const inbox = new Inbox();
    await go(inbox);
    const first = inbox.sent.length;
    await go(inbox);
    expect(inbox.sent.length).toBe(first);
  });

  it("n'envoie rien avant l'heure prévue", async () => {
    const s = await setup({ remindAt: new Date(NOW.getTime() + 3_600_000) });
    const inbox = new Inbox();
    const st = await go(inbox);
    expect(inbox.sent.some((m) => s.users.some((u) => u.email === m.to))).toBe(false);
    expect((await admin.reminder.findFirstOrThrow({ where: { householdId: s.householdId } })).status).toBe("PENDING");
    void st;
  });

  it("annule le rappel d'une échéance déjà traitée", async () => {
    const s = await setup({ deadline: { status: "DONE" } });
    const inbox = new Inbox();
    await go(inbox);
    expect(inbox.sent.some((m) => s.users.some((u) => u.email === m.to))).toBe(false);
    expect((await admin.reminder.findMany({ where: { householdId: s.householdId } })).every((r) => r.status === "CANCELLED")).toBe(true);
  });

  it("respecte les préférences et ignore les comptes bannis", async () => {
    const s = await setup({ members: [{ role: "OWNER", pref: false }, { role: "OWNER", banned: true }, { role: "OWNER" }] });
    const inbox = new Inbox();
    await go(inbox);
    const to = inbox.sent.filter((m) => s.users.some((u) => u.email === m.to)).map((m) => m.to);
    expect(to).toEqual([s.users[2]!.email]);
    expect(await admin.notification.count({ where: { householdId: s.householdId } })).toBe(1);
  });

  it("panne d'envoi : rappel conservé avec un bail, repris plus tard, puis échec définitif", async () => {
    const s = await setup({ channels: ["EMAIL"] });
    const inbox = new Inbox();
    inbox.failFor.add(s.users[0]!.email);
    let t = NOW;
    for (let i = 1; i <= 5; i++) {
      const st = await go(inbox, { now: () => t, maxAttempts: 5 });
      const row = await admin.reminder.findUniqueOrThrow({ where: { id: s.reminders[0]!.id } });
      expect(row.attempts).toBe(i);
      if (i < 5) { expect(row.status).toBe("PENDING"); expect(st.retried).toBe(1); expect(row.remindAt.getTime()).toBeGreaterThan(t.getTime()); }
      else { expect(row.status).toBe("FAILED"); expect(st.failed).toBe(1); }
      t = new Date(t.getTime() + 16 * 60_000); // après la fin du bail
    }
  });

  it("le bail empêche une reprise immédiate par un autre worker", async () => {
    const s = await setup({ channels: ["EMAIL"] });
    const inbox = new Inbox();
    inbox.failFor.add(s.users[0]!.email);
    await go(inbox);
    const st = await go(inbox); // même instant : le rappel est sous bail
    expect(st.claimed).toBe(0);
  });

  it("deux workers simultanés : chaque rappel est envoyé une seule fois", async () => {
    const homes = await Promise.all(Array.from({ length: 6 }, () => setup({ channels: ["EMAIL", "IN_APP"] })));
    const inbox = new Inbox();
    await Promise.all([go(inbox, { batch: 4 }), go(inbox, { batch: 4 }), go(inbox, { batch: 4 })]);
    await go(inbox);
    for (const h of homes) {
      expect(inbox.sent.filter((m) => m.to === h.users[0]!.email)).toHaveLength(1);
      expect(await admin.notification.count({ where: { householdId: h.householdId } })).toBe(1);
    }
  });

  it("échappe le libellé de l'échéance dans l'email (donnée non fiable)", async () => {
    const s = await setup({ deadline: { title: "<script>alert(1)</script> Payer" }, channels: ["EMAIL"] });
    const inbox = new Inbox();
    await go(inbox);
    const mail = inbox.sent.find((m) => m.to === s.users[0]!.email)!;
    expect(mail.html).not.toContain("<script>");
  });
});
