import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "@mon-agent-ia/config";
import { createDb } from "@mon-agent-ia/db";
import { createMailTransport } from "@mon-agent-ia/mail";
import { log } from "./log.ts";
import { createStripe } from "@mon-agent-ia/billing";
import { purgeDueDeletions } from "./deletion.ts";
import { dispatchReminders } from "./reminders.ts";

/**
 * Worker : tâches planifiées SANS contenu. Les données des jobs BullMQ sont persistées dans Redis ;
 * elles restent donc vides (aucun identifiant de document, aucun texte). Les tâches relisent l'état en base.
 */
const QUEUE = "mai-scheduler";

async function main() {
  const env = loadEnv();
  if (!env.REDIS_URL) throw new Error("REDIS_URL requis pour le worker");
  if (!env.DATABASE_SERVICE_URL) throw new Error("DATABASE_SERVICE_URL requis pour le worker (rôle de service)");

  const db = createDb(env.DATABASE_SERVICE_URL);
  const mail = createMailTransport({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM ?? "Mon Agent IA <no-reply@monagentia.com>", appEnv: env.APP_ENV });
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }); // exigé par BullMQ pour les workers

  const queue = new Queue(QUEUE, { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500, attempts: 1 } });
  await queue.upsertJobScheduler("dispatch-reminders", { every: 60_000 }, { name: "dispatch-reminders", data: {} });

  await queue.upsertJobScheduler("purge-deletions", { every: 10 * 60_000 }, { name: "purge-deletions", data: {} });
  const stripe = env.STRIPE_SECRET_KEY ? createStripe(env.STRIPE_SECRET_KEY) : null;

  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === "dispatch-reminders") {
        const stats = await dispatchReminders({ db, mail, appUrl: env.APP_URL });
        if (stats.claimed) log("info", "rappels traités", stats);
        return stats;
      }
      if (job.name === "purge-deletions") {
        const stats = await purgeDueDeletions({ db, deleteBillingCustomer: stripe ? async (id) => void (await stripe.customers.del(id)) : undefined });
        if (stats.due) log("info", "suppressions de compte", stats);
        return stats;
      }
      log("warn", "job inconnu", { name: job.name });
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, err) => log("error", "job en échec", { name: job?.name, err }));
  log("info", "worker démarré", { queue: QUEUE, appEnv: env.APP_ENV });

  const stop = async () => {
    log("info", "arrêt du worker");
    await worker.close();
    await queue.close();
    await connection.quit();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => {
  log("error", "démarrage impossible", { err });
  process.exit(1);
});
