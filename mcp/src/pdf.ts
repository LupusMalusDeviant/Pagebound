// =============================================================================
// PDF operations for the Pagebound MCP server. Pure-JS engines, identical to the
// Pagebound web bridges: pdf-lib for structure/manipulation, pdfjs-dist for text.
// No native dependencies, no network, everything runs locally on the file system.
// =============================================================================
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument, degrees } from "pdf-lib";

/** Erwartbare, dem Agenten erklärbare Fehler (vs. unerwartete Exceptions). */
export class ToolError extends Error {}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- File helpers ------------------------------------------------------------

export async function readBytes(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (e) {
    throw new ToolError(`Datei nicht lesbar: '${path}' (${errMsg(e)}). Bitte einen existierenden, absoluten Pfad angeben.`);
  }
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(path, bytes);
  } catch (e) {
    throw new ToolError(`Ausgabe nicht schreibbar: '${path}' (${errMsg(e)}). Existiert der Zielordner?`);
  }
}

async function loadDoc(path: string): Promise<PDFDocument> {
  const bytes = await readBytes(path);
  try {
    return await PDFDocument.load(bytes);
  } catch (e) {
    const m = errMsg(e);
    if (/encrypt/i.test(m)) {
      throw new ToolError(`'${path}' ist passwortgeschützt/verschlüsselt — bitte zuerst entschlüsseln. (${m})`);
    }
    throw new ToolError(`'${path}' ist keine gültige PDF oder ist beschädigt (${m}).`);
  }
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

// --- Page-spec parsing -------------------------------------------------------

/**
 * Parst eine 1-basierte Seitenangabe wie "1-3,5,8-10" in eine Liste von
 * Seitennummern. Reihenfolge bleibt erhalten (für reorder/extract relevant),
 * Bereiche dürfen rückwärts laufen ("3-1" → 3,2,1). Validiert gegen [1,total].
 */
export function parsePageSpec(spec: string, total: number): number[] {
  const out: number[] = [];
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new ToolError(`Leere Seitenangabe. Beispiel: "1-3,5,8".`);
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      const step = a <= b ? 1 : -1;
      for (let p = a; step > 0 ? p <= b : p >= b; p += step) out.push(p);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    } else {
      throw new ToolError(`Ungültiges Seiten-Token: '${part}'. Erlaubt: einzelne Seiten und Bereiche, z. B. "1-3,5,8".`);
    }
  }
  for (const p of out) {
    if (p < 1 || p > total) {
      throw new ToolError(`Seite ${p} liegt außerhalb des Dokuments (1–${total}).`);
    }
  }
  return out;
}

// --- Operations --------------------------------------------------------------

export interface PdfInfo {
  path: string;
  pageCount: number;
  title?: string;
  author?: string;
  pages: { page: number; widthPt: number; heightPt: number }[];
}

export async function getInfo(path: string): Promise<PdfInfo> {
  const doc = await loadDoc(path);
  const pages = doc.getPages();
  return {
    path,
    pageCount: pages.length,
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
    pages: pages.map((pg, i) => {
      const { width, height } = pg.getSize();
      return { page: i + 1, widthPt: round(width), heightPt: round(height) };
    }),
  };
}

export async function merge(inputs: string[], output: string): Promise<{ output: string; pageCount: number; sources: number }> {
  if (inputs.length < 2) throw new ToolError("Zum Zusammenführen werden mindestens zwei Eingabe-PDFs benötigt.");
  const out = await PDFDocument.create();
  for (const input of inputs) {
    const src = await loadDoc(input);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  await writeBytes(output, await save(out));
  return { output, pageCount: out.getPageCount(), sources: inputs.length };
}

/** Extrahiert Seiten (in der angegebenen Reihenfolge) in eine neue PDF. */
export async function extractPages(input: string, pages: string, output: string): Promise<{ output: string; pageCount: number }> {
  const src = await loadDoc(input);
  const want = parsePageSpec(pages, src.getPageCount());
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, want.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  await writeBytes(output, await save(out));
  return { output, pageCount: out.getPageCount() };
}

/** Löscht die angegebenen Seiten; der Rest bleibt in Originalreihenfolge. */
export async function deletePages(input: string, pages: string, output: string): Promise<{ output: string; pageCount: number; deleted: number }> {
  const src = await loadDoc(input);
  const total = src.getPageCount();
  const remove = new Set(parsePageSpec(pages, total));
  if (remove.size >= total) throw new ToolError(`Es würden alle ${total} Seiten gelöscht — mindestens eine Seite muss bleiben.`);
  const keep = [...Array(total).keys()].map((i) => i + 1).filter((p) => !remove.has(p));
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keep.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  await writeBytes(output, await save(out));
  return { output, pageCount: out.getPageCount(), deleted: remove.size };
}

/** Dreht die angegebenen Seiten um ±90/180/270°, additiv zur bestehenden Drehung. */
export async function rotatePages(input: string, pages: string, deg: number, output: string): Promise<{ output: string; rotated: number }> {
  if (deg % 90 !== 0) throw new ToolError("Drehwinkel muss ein Vielfaches von 90 sein (z. B. -90, 90, 180, 270).");
  const doc = await loadDoc(input);
  const want = new Set(parsePageSpec(pages, doc.getPageCount()));
  const all = doc.getPages();
  for (const p of want) {
    const page = all[p - 1];
    const current = page.getRotation().angle;
    page.setRotation(degrees(((current + deg) % 360 + 360) % 360));
  }
  await writeBytes(output, await save(doc));
  return { output, rotated: want.size };
}

/** Ordnet die Seiten gemäß der angegebenen 1-basierten Reihenfolge neu an. */
export async function reorderPages(input: string, order: number[], output: string): Promise<{ output: string; pageCount: number }> {
  const src = await loadDoc(input);
  const total = src.getPageCount();
  if (order.length !== total) throw new ToolError(`Die Reihenfolge muss genau ${total} Seiten enthalten (jede Seite einmal). Erhalten: ${order.length}.`);
  const seen = new Set(order);
  if (seen.size !== total) throw new ToolError("Jede Seite darf in der Reihenfolge genau einmal vorkommen.");
  for (const p of order) if (p < 1 || p > total) throw new ToolError(`Seite ${p} liegt außerhalb (1–${total}).`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, order.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  await writeBytes(output, await save(out));
  return { output, pageCount: out.getPageCount() };
}

export type PageSizeMode = "image" | "a4" | "letter";
const PAGE_SIZES: Record<Exclude<PageSizeMode, "image">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Erzeugt aus PNG/JPG-Bildern eine PDF (eine Seite je Bild). */
export async function imagesToPdf(images: string[], output: string, pageSize: PageSizeMode): Promise<{ output: string; pageCount: number }> {
  if (images.length === 0) throw new ToolError("Mindestens ein Bild angeben.");
  const doc = await PDFDocument.create();
  for (const imgPath of images) {
    const bytes = await readBytes(imgPath);
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50; // \x89PNG
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8; // FFD8
    if (!isPng && !isJpg) throw new ToolError(`'${imgPath}' ist weder PNG noch JPG (nur diese werden unterstützt).`);
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    if (pageSize === "image") {
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const [pw, ph] = PAGE_SIZES[pageSize];
      const page = doc.addPage([pw, ph]);
      const scale = Math.min(pw / img.width, ph / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  await writeBytes(output, await save(doc));
  return { output, pageCount: doc.getPageCount() };
}

// --- Text extraction (pdfjs-dist) --------------------------------------------

let pdfjsMod: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

async function getPdfjs() {
  if (pdfjsMod) return pdfjsMod;
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // In Node läuft pdfjs ohne echten Web-Worker (Fake-Worker auf dem Main-Thread).
  // workerSrc auf die mitgelieferte Worker-Datei zeigen lassen, damit kein
  // Auflösungsfehler entsteht; verbosity=0 + console-Umleitung halten stdout sauber.
  try {
    const require = createRequire(import.meta.url);
    // Als file://-URL — der Node-ESM-Loader akzeptiert keine nackten
    // Windows-Pfade ("x:\\…"), nur file://-URLs.
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ).href;
  } catch {
    /* Fake-Worker-Fallback genügt */
  }
  pdfjsMod = mod;
  return mod;
}

export interface PageText {
  page: number;
  text: string;
}

export async function extractText(path: string, pages?: string): Promise<{ pageCount: number; pages: PageText[]; totalChars: number }> {
  const bytes = await readBytes(path);
  const pdfjs = await getPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise;
  } catch (e) {
    throw new ToolError(`Text-Extraktion fehlgeschlagen für '${path}' (${errMsg(e)}).`);
  }
  try {
    const total = doc.numPages;
    const want = pages ? [...new Set(parsePageSpec(pages, total))].sort((a, b) => a - b) : Array.from({ length: total }, (_, i) => i + 1);
    const result: PageText[] = [];
    let totalChars = 0;
    for (const p of want) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Glyphen/Items zu Zeilen zusammenfügen: bei item.hasEOL einen Zeilenumbruch.
      let text = "";
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str === "string") text += item.str + (item.hasEOL ? "\n" : "");
      }
      text = text.replace(/[ \t]+\n/g, "\n").trim();
      totalChars += text.length;
      result.push({ page: p, text });
      page.cleanup();
    }
    return { pageCount: total, pages: result, totalChars };
  } finally {
    await doc.destroy();
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
