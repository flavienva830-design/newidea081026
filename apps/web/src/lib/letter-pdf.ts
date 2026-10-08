/**
 * Génère un PDF A4 d'un courrier, EN MÉMOIRE dans le navigateur de l'utilisateur : le serveur n'en voit jamais le contenu.
 * Les polices standard n'encodent que WinAnsi : les caractères typographiques courants sont convertis, le reste devient « ? ».
 */
const MAP: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " ", " ": " ", " ": " ", "•": "-" };

export function winAnsiSafe(text: string): string {
  return Array.from(text.normalize("NFC"))
    .map((c) => {
      if (MAP[c]) return MAP[c]!;
      const code = c.codePointAt(0)!;
      return c === "\n" || c === "\t" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || c === "€" ? c : "?";
    })
    .join("");
}

export async function letterToPdf(text: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Courrier");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 11;
  const lineHeight = 16;
  const margin = 64;
  const width = 595;
  const height = 842;
  const maxWidth = width - margin * 2;

  const lines: string[] = [];
  for (const para of winAnsiSafe(text).replace(/\t/g, "    ").split("\n")) {
    if (!para.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else {
        if (line) lines.push(line);
        // Mot plus long qu'une ligne : coupé.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > maxWidth) {
          let n = rest.length;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > maxWidth) n--;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
    }
    lines.push(line);
  }

  let page = doc.addPage([width, height]);
  let y = height - margin;
  for (const l of lines) {
    if (y < margin) { page = doc.addPage([width, height]); y = height - margin; }
    if (l) page.drawText(l, { x: margin, y, size, font, color: rgb(0.07, 0.07, 0.07) });
    y -= lineHeight;
  }
  return doc.save();
}
