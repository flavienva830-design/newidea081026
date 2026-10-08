import { describe, expect, it, vi } from "vitest";
import { actionEmail, createMailTransport, escapeHtml, type Mail } from "../src/index.ts";

const mail: Mail = { to: "a@b.test", subject: "S", html: "<p>x</p>", text: "x" };

describe("emails", () => {
  it("échappe tout contenu variable", () => {
    expect(escapeHtml(`<script>"a"&'b'</script>`)).toBe("&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;");
    const m = actionEmail({ title: "<b>t</b>", intro: "<img src=x onerror=1>", cta: "go", url: 'https://x.test/?a="><script>1</script>' });
    expect(m.html).not.toMatch(/<script>|<img |<b>t/);
    expect(m.text).toContain("go : https://x.test");
  });

  it("dev sans clé : journalise et alimente la boîte d'envoi de test", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const outbox: Mail[] = [];
    await createMailTransport({ from: "f", appEnv: "dev", outbox }).send(mail);
    expect(outbox).toEqual([mail]);
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it("staging et production sans clé : erreur explicite, jamais d'envoi silencieux", async () => {
    for (const appEnv of ["staging", "production"] as const) {
      await expect(createMailTransport({ from: "f", appEnv }).send(mail)).rejects.toThrow("RESEND_API_KEY");
    }
  });

  it("la boîte d'envoi est ignorée hors développement", async () => {
    const outbox: Mail[] = [];
    await expect(createMailTransport({ from: "f", appEnv: "production", outbox }).send(mail)).rejects.toThrow();
    expect(outbox).toEqual([]);
  });
});
