import { PDFDocument, StandardFonts } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";

export async function makePdf(lines: string[], pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    lines.forEach((l, i) => page.drawText(l, { x: 40, y: 780 - i * 18, size: 11, font }));
  }
  return doc.save();
}

export async function makeBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

export function makeDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`),
  });
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
