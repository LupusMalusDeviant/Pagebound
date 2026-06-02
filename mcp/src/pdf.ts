// =============================================================================
// PDF operations for the Pagebound MCP server. Pure bytes-in/bytes-out — the
// transport layer (index.ts) resolves inputs from a local path OR inline base64
// and emits to a path OR base64, so the same tools serve both the local stdio
// build and the hosted HTTP build. Engines identical to the Pagebound web app:
// pdf-lib (structure/manipulation) + pdfjs-dist (text). No native deps, no network.
// =============================================================================
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  PDFDocument,
  PDFName,
  PDFRef,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  StandardFonts,
  rgb,
  degrees,
} from "pdf-lib";

/** Erwartbare, dem Agenten erklärbare Fehler (vs. unerwartete Exceptions). */
export class ToolError extends Error {}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Seiten-Limit für den gehosteten (tokenlosen) Betrieb. 0/leer = unbegrenzt
// (lokaler stdio-Modus). Der HTTP-Container setzt MCP_MAX_PAGES per env.
const MAX_PAGES = Number(process.env.MCP_MAX_PAGES) || 0;

function enforcePages(count: number): void {
  if (MAX_PAGES && count > MAX_PAGES) {
    throw new ToolError(`PDF hat ${count} Seiten — das Limit dieses Servers liegt bei ${MAX_PAGES}.`);
  }
}

async function loadDoc(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (e) {
    const m = errMsg(e);
    if (/encrypt/i.test(m)) throw new ToolError(`PDF ist passwortgeschützt/verschlüsselt — bitte zuerst entschlüsseln. (${m})`);
    throw new ToolError(`Keine gültige PDF oder beschädigt (${m}).`);
  }
  enforcePages(doc.getPageCount());
  return doc;
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

// --- Page-spec parsing -------------------------------------------------------

/**
 * Parst eine 1-basierte Seitenangabe wie "1-3,5,8-10" in eine Liste von
 * Seitennummern. Reihenfolge bleibt erhalten, Bereiche dürfen rückwärts laufen
 * ("3-1" → 3,2,1). Validiert gegen [1,total].
 */
export function parsePageSpec(spec: string, total: number): number[] {
  const out: number[] = [];
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new ToolError(`Leere Seitenangabe. Beispiel: "1-3,5,8".`);
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const step = a <= b ? 1 : -1;
      for (let p = a; step > 0 ? p <= b : p >= b; p += step) out.push(p);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    } else {
      throw new ToolError(`Ungültiges Seiten-Token: '${part}'. Erlaubt: einzelne Seiten und Bereiche, z. B. "1-3,5,8".`);
    }
  }
  for (const p of out) {
    if (p < 1 || p > total) throw new ToolError(`Seite ${p} liegt außerhalb des Dokuments (1–${total}).`);
  }
  return out;
}

// --- Operations (bytes in / bytes out) ---------------------------------------

export interface PdfInfo {
  pageCount: number;
  title?: string;
  author?: string;
  pages: { page: number; widthPt: number; heightPt: number }[];
}

export async function getInfo(bytes: Uint8Array): Promise<PdfInfo> {
  const doc = await loadDoc(bytes);
  const pages = doc.getPages();
  return {
    pageCount: pages.length,
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
    pages: pages.map((pg, i) => {
      const { width, height } = pg.getSize();
      return { page: i + 1, widthPt: round(width), heightPt: round(height) };
    }),
  };
}

export async function merge(inputs: Uint8Array[]): Promise<{ bytes: Uint8Array; pageCount: number }> {
  if (inputs.length < 2) throw new ToolError("Zum Zusammenführen werden mindestens zwei Eingabe-PDFs benötigt.");
  const out = await PDFDocument.create();
  for (const input of inputs) {
    const src = await loadDoc(input);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return { bytes: await save(out), pageCount: out.getPageCount() };
}

export async function extractPages(input: Uint8Array, pages: string): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const src = await loadDoc(input);
  const want = parsePageSpec(pages, src.getPageCount());
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, want.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  return { bytes: await save(out), pageCount: out.getPageCount() };
}

export async function deletePages(input: Uint8Array, pages: string): Promise<{ bytes: Uint8Array; pageCount: number; deleted: number }> {
  const src = await loadDoc(input);
  const total = src.getPageCount();
  const remove = new Set(parsePageSpec(pages, total));
  if (remove.size >= total) throw new ToolError(`Es würden alle ${total} Seiten gelöscht — mindestens eine muss bleiben.`);
  const keep = [...Array(total).keys()].map((i) => i + 1).filter((p) => !remove.has(p));
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keep.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  return { bytes: await save(out), pageCount: out.getPageCount(), deleted: remove.size };
}

export async function rotatePages(input: Uint8Array, pages: string, deg: number): Promise<{ bytes: Uint8Array; rotated: number }> {
  if (deg % 90 !== 0) throw new ToolError("Drehwinkel muss ein Vielfaches von 90 sein (z. B. -90, 90, 180, 270).");
  const doc = await loadDoc(input);
  const want = new Set(parsePageSpec(pages, doc.getPageCount()));
  const all = doc.getPages();
  for (const p of want) {
    const page = all[p - 1];
    const current = page.getRotation().angle;
    page.setRotation(degrees((((current + deg) % 360) + 360) % 360));
  }
  return { bytes: await save(doc), rotated: want.size };
}

export async function reorderPages(input: Uint8Array, order: number[]): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const src = await loadDoc(input);
  const total = src.getPageCount();
  if (order.length !== total) throw new ToolError(`Die Reihenfolge muss genau ${total} Seiten enthalten. Erhalten: ${order.length}.`);
  if (new Set(order).size !== total) throw new ToolError("Jede Seite darf in der Reihenfolge genau einmal vorkommen.");
  for (const p of order) if (p < 1 || p > total) throw new ToolError(`Seite ${p} liegt außerhalb (1–${total}).`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, order.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  return { bytes: await save(out), pageCount: out.getPageCount() };
}

export type PageSizeMode = "image" | "a4" | "letter";
const PAGE_SIZES: Record<Exclude<PageSizeMode, "image">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export async function imagesToPdf(images: Uint8Array[], pageSize: PageSizeMode): Promise<{ bytes: Uint8Array; pageCount: number }> {
  if (images.length === 0) throw new ToolError("Mindestens ein Bild angeben.");
  const doc = await PDFDocument.create();
  for (const bytes of images) {
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) throw new ToolError("Ein Bild ist weder PNG noch JPG (nur diese werden unterstützt).");
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
  return { bytes: await save(doc), pageCount: doc.getPageCount() };
}

// --- Split (multiple parts) --------------------------------------------------

/**
 * Teilt eine PDF in mehrere Teil-PDFs. `afterPages` ist eine 1-basierte
 * Seitenangabe der Schnittpunkte: nach jeder genannten Seite beginnt ein neuer
 * Teil. Beispiel total=8, afterPages="3,5" → [1-3] [4-5] [6-8]. Entspricht der
 * Split-Funktion der Web-App (`splitPdf`).
 */
export async function split(input: Uint8Array, afterPages: string): Promise<{ parts: Uint8Array[]; pageCounts: number[] }> {
  const src = await loadDoc(input);
  const total = src.getPageCount();
  const points = [...new Set(parsePageSpec(afterPages, total))].filter((p) => p >= 1 && p < total).sort((a, b) => a - b);
  if (points.length === 0) throw new ToolError(`Keine gültigen Schnittpunkte in "${afterPages}" (erlaubt: 1 .. ${total - 1}).`);

  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  for (const sp of points) { ranges.push([cursor, sp]); cursor = sp; }
  ranges.push([cursor, total]);

  const parts: Uint8Array[] = [];
  const pageCounts: number[] = [];
  for (const [start, end] of ranges) {
    const out = await PDFDocument.create();
    const idx: number[] = [];
    for (let i = start; i < end; i++) idx.push(i);
    const copied = await out.copyPages(src, idx);
    copied.forEach((p) => out.addPage(p));
    parts.push(await save(out));
    pageCounts.push(out.getPageCount());
  }
  return { parts, pageCounts };
}

// --- Stamp: watermark + page numbers / Bates ---------------------------------

export type PageNumberPosition = "bottom-center" | "bottom-right" | "bottom-left";

export interface StampOptions {
  watermarkText?: string | null;
  pageNumbers?: boolean;
  pageNumberFormat?: string;
  pageNumberPosition?: PageNumberPosition;
  pageNumberStartAt?: number;
}

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Stempelt ein diagonales Text-Wasserzeichen (45°, halbtransparent) und/oder
 * Seitenzahlen/Bates auf jede Seite. Port der Web-App-Funktion `stampPdf`.
 */
export async function stamp(input: Uint8Array, opts: StampOptions): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const wmText = (opts.watermarkText ?? "").trim();
  const pnOn = !!opts.pageNumbers;
  if (!wmText && !pnOn) throw new ToolError("Nichts zu stempeln: 'watermarkText' und/oder 'pageNumbers' angeben.");

  const doc = await loadDoc(input);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;

  const pnFmt = opts.pageNumberFormat || "{n} / {total}";
  const pnPos = opts.pageNumberPosition || "bottom-center";
  const startAt = Number.isFinite(opts.pageNumberStartAt) ? (opts.pageNumberStartAt as number) : 1;
  const wmSize = 48;
  const pnSize = 10;
  const margin = 24;

  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    if (wmText) {
      const tw = font.widthOfTextAtSize(wmText, wmSize);
      const angle = Math.PI / 4; // 45° — rotierte Baseline mittig durch die Seite
      page.drawText(wmText, {
        x: width / 2 - (tw / 2) * Math.cos(angle),
        y: height / 2 - (tw / 2) * Math.sin(angle),
        size: wmSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: 0.12,
        rotate: degrees(45),
      });
    }
    if (pnOn) {
      const label = pnFmt.replace("{n}", String(i + startAt)).replace("{total}", String(total));
      const tw = font.widthOfTextAtSize(label, pnSize);
      let x = (width - tw) / 2;
      if (pnPos === "bottom-right") x = width - tw - margin;
      else if (pnPos === "bottom-left") x = margin;
      page.drawText(label, { x, y: margin, size: pnSize, font, color: rgb(0.3, 0.3, 0.3) });
    }
  });

  void clampNum; // (reserviert für künftige konfigurierbare Größen/Opazität)
  return { bytes: await save(doc), pageCount: total };
}

// --- AcroForms: read + fill --------------------------------------------------

export interface FormFieldDto {
  name: string;
  type: "Text" | "Checkbox" | "Radio" | "Dropdown" | "ListBox";
  /** Aktuelle Werte: Text/Radio/Dropdown 0..1, Checkbox ["true"]|[], ListBox 0..n. */
  value: string[];
  /** Wählbare Optionen bei Radio/Dropdown/ListBox; leer bei Text/Checkbox. */
  options: string[];
  readOnly: boolean;
  required: boolean;
  /** 1-basierte Seitenzahl, 0 = nicht ermittelbar. */
  pageNumber: number;
}

export interface FormFieldValue {
  name: string;
  value: string[];
}

function classifyFormField(field: unknown): FormFieldDto["type"] | null {
  if (field instanceof PDFTextField) return "Text";
  if (field instanceof PDFCheckBox) return "Checkbox";
  if (field instanceof PDFRadioGroup) return "Radio";
  if (field instanceof PDFDropdown) return "Dropdown";
  if (field instanceof PDFOptionList) return "ListBox";
  return null; // Buttons / Signaturfelder bewusst ignorieren
}

const safeBool = (fn: () => boolean): boolean => { try { return fn(); } catch { return false; } };

/** Map Widget-Dict → 1-basierte Seitenzahl (über die Annots-Arrays der Seiten). */
function buildWidgetPageMap(doc: PDFDocument): Map<unknown, number> {
  const map = new Map<unknown, number>();
  doc.getPages().forEach((page, idx) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (const ref of annots.asArray()) {
      try {
        const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
        if (obj) map.set(obj, idx + 1);
      } catch { /* defekte Referenz überspringen */ }
    }
  });
  return map;
}

function formFieldPageNumber(field: any, widgetPageMap: Map<unknown, number>): number {
  try {
    for (const widget of field.acroField.getWidgets()) {
      const page = widgetPageMap.get(widget.dict);
      if (page) return page;
    }
  } catch { /* Feld ohne auflösbare Widgets */ }
  return 0;
}

export async function getFormFields(input: Uint8Array): Promise<FormFieldDto[]> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true });
  const fields = doc.getForm().getFields();
  if (!fields || fields.length === 0) return [];

  const widgetPageMap = buildWidgetPageMap(doc);
  const result: FormFieldDto[] = [];
  for (const field of fields) {
    const type = classifyFormField(field);
    if (!type) continue;

    let value: string[] = [];
    let options: string[] = [];
    switch (type) {
      case "Text": { const t = (field as PDFTextField).getText(); value = t ? [t] : []; break; }
      case "Checkbox": value = (field as PDFCheckBox).isChecked() ? ["true"] : []; break;
      case "Radio": { const rg = field as PDFRadioGroup; options = rg.getOptions(); const sel = rg.getSelected(); value = sel ? [sel] : []; break; }
      case "Dropdown": { const dd = field as PDFDropdown; options = dd.getOptions(); value = dd.getSelected() ?? []; break; }
      case "ListBox": { const ol = field as PDFOptionList; options = ol.getOptions(); value = ol.getSelected() ?? []; break; }
    }
    result.push({
      name: field.getName(),
      type,
      value,
      options,
      readOnly: safeBool(() => field.isReadOnly()),
      required: safeBool(() => field.isRequired()),
      pageNumber: formFieldPageNumber(field, widgetPageMap),
    });
  }
  return result;
}

export async function fillForm(
  input: Uint8Array,
  values: FormFieldValue[],
  flatten: boolean
): Promise<{ bytes: Uint8Array; filled: number; skipped: string[] }> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true });
  const form = doc.getForm();
  const skipped: string[] = [];
  let filled = 0;

  for (const entry of values ?? []) {
    let field: any;
    try { field = form.getField(entry.name); } catch { skipped.push(entry.name); continue; }
    const vals = entry.value ?? [];
    try {
      if (field instanceof PDFTextField) field.setText(vals.length > 0 ? vals[0] : undefined);
      else if (field instanceof PDFCheckBox) { if (vals.includes("true")) field.check(); else field.uncheck(); }
      else if (field instanceof PDFRadioGroup) { if (vals.length > 0) field.select(vals[0]); else field.clear(); }
      else if (field instanceof PDFDropdown) { field.clear(); if (vals.length > 0) field.select(vals); }
      else if (field instanceof PDFOptionList) { field.clear(); if (vals.length > 0) field.select(vals); }
      else { skipped.push(entry.name); continue; }
      filled++;
    } catch { skipped.push(entry.name); }
  }

  if (flatten) form.flatten();
  else { try { form.updateFieldAppearances(); } catch { /* best effort */ } }

  return { bytes: await doc.save(), filled, skipped };
}

// --- Text extraction (pdfjs-dist) --------------------------------------------

let pdfjsMod: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

async function getPdfjs() {
  if (pdfjsMod) return pdfjsMod;
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    const require = createRequire(import.meta.url);
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
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

export async function extractText(bytes: Uint8Array, pages?: string): Promise<{ pageCount: number; pages: PageText[]; totalChars: number }> {
  const pdfjs = await getPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise;
  } catch (e) {
    throw new ToolError(`Text-Extraktion fehlgeschlagen (${errMsg(e)}).`);
  }
  try {
    const total = doc.numPages;
    enforcePages(total);
    const want = pages
      ? [...new Set(parsePageSpec(pages, total))].sort((a, b) => a - b)
      : Array.from({ length: total }, (_, i) => i + 1);
    const result: PageText[] = [];
    let totalChars = 0;
    for (const p of want) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
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
