import { unzipSync } from "fflate";
import { sniffMime, type AllowedMime } from "@mon-agent-ia/core";
import { AnalysisError, type ContentPart } from "./types.ts";

export const LIMITS = {
  maxPdfPages: 25,
  maxTextChars: 60_000,
  /** Sous ce seuil, un PDF est considéré comme un scan : on l'envoie tel quel au modèle de vision. */
  minNativeTextChars: 120,
  maxDocxEntries: 2_000,
  maxDocxUncompressed: 30 * 1024 * 1024,
} as const;

export type Extraction = {
  parts: ContentPart[];
  method: "native_text" | "vision" | "docx_text";
  pageCount?: number;
  truncated: boolean;
  mime: AllowedMime;
};

const b64 = (buf: Uint8Array) => Buffer.from(buf).toString("base64");

/**
 * Extraction EN MÉMOIRE uniquement : aucun fichier temporaire, aucune écriture disque.
 * Les octets reçus sont transformés en parties de requête puis laissés au ramasse-miettes.
 */
export async function extractContent(buf: Uint8Array, declaredMime?: string): Promise<Extraction> {
  const mime = sniffMime(buf);
  if (!mime) throw new AnalysisError("UNSUPPORTED", "Type de fichier non pris en charge.");
  if (declaredMime && declaredMime !== mime) throw new AnalysisError("UNSUPPORTED", "Le type déclaré ne correspond pas au fichier.");

  if (mime === "image/jpeg" || mime === "image/png") {
    return { parts: [{ type: "image", mime, base64: b64(buf) }], method: "vision", truncated: false, mime };
  }
  if (mime === "application/pdf") return extractPdf(buf);
  return extractDocx(buf);
}

async function extractPdf(buf: Uint8Array): Promise<Extraction> {
  let text = "";
  let pages = 0;
  try {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    pages = pdf.numPages;
    if (pages > LIMITS.maxPdfPages) throw new AnalysisError("TOO_LARGE", `PDF trop long (maximum ${LIMITS.maxPdfPages} pages).`);
    const out = await extractText(pdf, { mergePages: true });
    text = (Array.isArray(out.text) ? out.text.join("\n") : out.text).trim();
  } catch (e) {
    if (e instanceof AnalysisError) throw e;
    throw new AnalysisError("UNSUPPORTED", "PDF illisible ou protégé.");
  }

  if (text.length >= LIMITS.minNativeTextChars) {
    const truncated = text.length > LIMITS.maxTextChars;
    return { parts: [{ type: "text", text: text.slice(0, LIMITS.maxTextChars) }], method: "native_text", pageCount: pages, truncated, mime: "application/pdf" };
  }
  // Scan ou PDF image : le modèle de vision lit le PDF directement (toujours en mémoire).
  return { parts: [{ type: "pdf", base64: b64(buf) }], method: "vision", pageCount: pages, truncated: false, mime: "application/pdf" };
}

const XML_ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function extractDocx(buf: Uint8Array): Extraction {
  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, {
      // Le filtre reçoit la taille décompressée AVANT toute décompression : protection contre les bombes zip.
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > LIMITS.maxDocxEntries || total > LIMITS.maxDocxUncompressed) throw new AnalysisError("TOO_LARGE", "Document trop volumineux.");
        return f.name === "word/document.xml";
      },
    });
  } catch (e) {
    if (e instanceof AnalysisError) throw e;
    throw new AnalysisError("UNSUPPORTED", "Document Word illisible.");
  }
  const xml = files["word/document.xml"];
  if (!xml) throw new AnalysisError("UNSUPPORTED", "Document Word invalide.");

  const text = Buffer.from(xml)
    .toString("utf8")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENT[m] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new AnalysisError("EMPTY", "Aucun texte détecté dans le document.");
  const truncated = text.length > LIMITS.maxTextChars;
  return { parts: [{ type: "text", text: text.slice(0, LIMITS.maxTextChars) }], method: "docx_text", truncated, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}
