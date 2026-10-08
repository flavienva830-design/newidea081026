import "server-only";
import { actionEmail, createMailTransport, escapeHtml, type Mail, type MailTransport } from "@mon-agent-ia/mail";
import { env } from "./env";

export { actionEmail, escapeHtml };
export type { Mail };

const g = globalThis as unknown as { __outbox?: Mail[]; __mail?: MailTransport };
const outbox = (): Mail[] => (g.__outbox ??= []);

/** Lecture de la boîte d'envoi de test (E2E uniquement). */
export const readOutbox = (to: string) => outbox().filter((m) => m.to === to);

export function mailTransport(): MailTransport {
  const e = env();
  return (g.__mail ??= createMailTransport({
    apiKey: e.RESEND_API_KEY,
    from: e.EMAIL_FROM ?? "Mon Agent IA <no-reply@monagentia.com>",
    appEnv: e.APP_ENV,
    outbox: e.E2E_OUTBOX === "1" ? outbox() : undefined,
  }));
}

export const sendMail = (mail: Mail) => mailTransport().send(mail);
