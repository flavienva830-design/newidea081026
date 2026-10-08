import "server-only";
import { Resend } from "resend";
import { env } from "./env";

export type Mail = { to: string; subject: string; html: string; text: string };

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

let resend: Resend | undefined;

type Outbox = Mail[];
const outbox = (): Outbox => ((globalThis as unknown as { __outbox?: Outbox }).__outbox ??= []);
/** Lecture de la boîte d'envoi de test (E2E uniquement). */
export const readOutbox = (to: string) => outbox().filter((m) => m.to === to);

export async function sendMail(mail: Mail): Promise<void> {
  const e = env();
  if (e.E2E_OUTBOX === "1" && e.APP_ENV === "dev") outbox().push(mail);
  if (!e.RESEND_API_KEY) {
    if (e.APP_ENV === "production") throw new Error("RESEND_API_KEY manquant");
    // Développement seulement : le contenu (liens de connexion) s'affiche dans la console serveur.
    console.info(`[mail:dev] à=${mail.to} objet="${mail.subject}"\n${mail.text}`);
    return;
  }
  resend ??= new Resend(e.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: e.EMAIL_FROM ?? "Mon Agent IA <no-reply@monagentia.com>",
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (error) throw new Error(`Envoi email échoué : ${error.name}`);
}

/** Gabarit sobre, aligné sur la marque. `url` n'est inséré qu'après échappement. */
export function actionEmail(opts: { title: string; intro: string; cta: string; url: string; outro?: string }): Pick<Mail, "html" | "text"> {
  const { title, intro, cta, url, outro } = opts;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f5f5;font-family:Inter,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:32px;max-width:480px">
<tr><td style="font-size:14px;font-weight:600;padding-bottom:24px">Mon Agent IA</td></tr>
<tr><td style="font-size:22px;line-height:1.3;padding-bottom:12px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#555;padding-bottom:24px">${escapeHtml(intro)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${escapeHtml(url)}" style="background:#49A8FF;color:#111;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;display:inline-block">${escapeHtml(cta)}</a></td></tr>
<tr><td style="font-size:13px;color:#777;line-height:1.5">${escapeHtml(outro ?? "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.")}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title}\n\n${intro}\n\n${cta} : ${url}\n\n${outro ?? "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."}`;
  return { html, text };
}
