import { afterAll, describe, expect, it } from "vitest";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

const url = process.env["TEST_REDIS_URL"];
if (process.env["CI"] && !url) throw new Error("TEST_REDIS_URL requis en CI");
const run = url ? describe : describe.skip;

run("planification BullMQ", () => {
  const conn = new Redis(url!, { maxRetriesPerRequest: null });
  afterAll(() => conn.quit());

  it("le planificateur répétitif déclenche le job, avec des données vides (aucun contenu dans Redis)", async () => {
    const name = `t-${Date.now()}`;
    const queue = new Queue(name, { connection: conn });
    const seen: unknown[] = [];
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const worker = new Worker(name, async (job) => { seen.push(job.data); if (seen.length >= 2) resolve(); }, { connection: conn });
    await queue.upsertJobScheduler("dispatch-reminders", { every: 200 }, { name: "dispatch-reminders", data: {} });
    await done;
    await worker.close(); // hors du traitement : fermer depuis le job lui-même attendrait ce même job (blocage)
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((d) => JSON.stringify(d) === "{}")).toBe(true);
    await queue.obliterate({ force: true });
    await queue.close();
  });
});
