import { describe, expect, it } from "vitest";
import { actionEmail, escapeHtml } from "../src/lib/mailer";

describe("emails", () => {
  it("échappe le HTML (anti-injection dans les gabarits)", () => {
    expect(escapeHtml(`<script>"a"&'b'</script>`)).toBe("&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;");
    const m = actionEmail({ title: "<b>t</b>", intro: "i", cta: "go", url: 'https://x.test/?a="><script>1</script>' });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>t</b>");
    expect(m.html).toContain("&quot;&gt;&lt;script&gt;");
  });
  it("version texte avec le lien", () => {
    const m = actionEmail({ title: "T", intro: "I", cta: "Aller", url: "https://x.test/a" });
    expect(m.text).toContain("Aller : https://x.test/a");
  });
});
