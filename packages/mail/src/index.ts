import { Resend } from "resend";

export type Mail = { to: string; subject: string; html: string; text: string };

/** Transport d'emails interchangeable (Resend en production, journal ou boîte d'envoi en développement et en test). */
export interface MailTransport {
  send(mail: Mail): Promise<void>;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * Gabarit sobre aux couleurs de la marque. Tout texte variable est échappé : un libellé d'échéance issu d'un document
 * (donc non fiable) ne peut pas injecter de HTML.
 */
export function actionEmail(opts: { title: string; intro: string; cta: string; url: string; outro?: string }): Pick<Mail, "html" | "text"> {
  const { title, intro, cta, url, outro } = opts;
  const out = outro ?? "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.";
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f5f5;font-family:Inter,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:32px;max-width:480px">
<tr><td style="font-size:14px;font-weight:600;padding-bottom:24px">Mon Agent IA</td></tr>
<tr><td style="font-size:22px;line-height:1.3;padding-bottom:12px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#555;padding-bottom:24px">${escapeHtml(intro)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${escapeHtml(url)}" style="background:#49A8FF;color:#111;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;display:inline-block">${escapeHtml(cta)}</a></td></tr>
<tr><td style="font-size:13px;color:#777;line-height:1.5">${escapeHtml(out)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title}\n\n${intro}\n\n${cta} : ${url}\n\n${out}`;
  return { html, text };
}

export type MailConfig = {
  apiKey?: string;
  from: string;
  appEnv: "dev" | "staging" | "production";
  /** Boîte d'envoi de test (E2E) : réservée à appEnv=dev. */
  outbox?: Mail[];
};

/** Choisit le transport. Sans clé : journal console en développement, erreur en staging/production. */
export function createMailTransport(cfg: MailConfig): MailTransport {
  return {
    async send(mail) {
      if (cfg.outbox && cfg.appEnv === "dev") cfg.outbox.push(mail);
      if (!cfg.apiKey) {
        if (cfg.appEnv !== "dev") throw new Error("RESEND_API_KEY manquant");
        console.info(`[mail:dev] à=${mail.to} objet="${mail.subject}"\n${mail.text}`);
        return;
      }
      const client = new Resend(cfg.apiKey);
      const { error } = await client.emails.send({ from: cfg.from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
      if (error) throw new Error(`Envoi email échoué : ${error.name}`);
    },
  };
}
