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
import { zipSync } from "fflate";

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
    doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
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
    await doc.loadingTask.destroy();
  }
}

// --- Table extraction (Best-Effort, Heuristik auf Text-Positionen) -----------
// Spiegelt die Bridge-Heuristik der Web-App: Items zeilenweise über y clustern,
// innerhalb der Zeile über horizontale Lücken in Zellen trennen. Kein OCR/ML.

interface TblItem { str: string; x: number; y: number; w: number; h: number; }

function csvEscapeCell(s: string): string {
  const v = s.trim();
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function pageItemsToCsv(items: TblItem[]): string[] {
  if (items.length === 0) return [];
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  const rowTol = Math.max(2, medH * 0.6);
  const colGap = Math.max(4, medH * 1.2);

  const byY = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TblItem[][] = [];
  let cur: TblItem[] = [];
  let curY = byY[0].y;
  for (const it of byY) {
    if (cur.length && Math.abs(it.y - curY) > rowTol) { rows.push(cur); cur = []; }
    if (!cur.length) curY = it.y;
    cur.push(it);
  }
  if (cur.length) rows.push(cur);

  return rows.map((row) => {
    const sorted = row.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let cell = sorted[0].str;
    let prevRight = sorted[0].x + sorted[0].w;
    for (let i = 1; i < sorted.length; i++) {
      const it = sorted[i];
      if (it.x - prevRight > colGap) { cells.push(cell); cell = it.str; }
      else cell += (cell.endsWith(" ") || it.str.startsWith(" ") ? "" : " ") + it.str;
      prevRight = it.x + it.w;
    }
    cells.push(cell);
    return cells.map(csvEscapeCell).join(",");
  });
}

export async function extractTablesCsv(bytes: Uint8Array, pages?: string): Promise<{ pageCount: number; csv: string }> {
  const pdfjs = await getPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  } catch (e) {
    throw new ToolError(`Tabellen-Extraktion fehlgeschlagen (${errMsg(e)}).`);
  }
  try {
    const total = doc.numPages;
    enforcePages(total);
    const want = pages
      ? [...new Set(parsePageSpec(pages, total))].sort((a, b) => a - b)
      : Array.from({ length: total }, (_, i) => i + 1);
    const out: string[] = [];
    for (const p of want) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const items: TblItem[] = (content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>)
        .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
        .map((it) => ({
          str: it.str as string,
          x: it.transform ? it.transform[4] : 0,
          y: vp.height - (it.transform ? it.transform[5] : 0),
          w: it.width ?? 0,
          h: it.height ?? 0,
        }));
      const rows = pageItemsToCsv(items);
      if (rows.length) out.push(rows.join("\n"));
      page.cleanup();
    }
    return { pageCount: total, csv: out.join("\n\n") };
  } finally {
    await doc.loadingTask.destroy();
  }
}

// --- PDF → DOCX + Inline-Text-Ersetzen ---------------------------------------
// Spiegelt die Web-Bridge (convertToDocx / applyTextEdits): Items → Zeilen
// (y-Cluster) → Absätze; DOCX von Hand als OOXML-ZIP via fflate; Text-Ersetzen
// als Cover+Redraw. Best-Effort-Textfluss, keine Layout-Treue. Kein OCR.

const DOCX_XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

interface DocxItem { str: string; x: number; yTop: number; w: number; h: number; }
interface DocxLine { text: string; xMin: number; xMax: number; yTop: number; yBottom: number; medH: number; }

function docxXmlEscape(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/** Items einer Zeile (nach x sortiert) mit Wort-Spacing zusammenfügen. */
function joinDocxLine(items: DocxItem[]): string {
  if (items.length === 0) return "";
  let text = items[0].str;
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1], cur = items[i];
    const gap = cur.x - (prev.x + prev.w);
    const avgGlyph = prev.w / Math.max(prev.str.length, 1);
    const tol = Math.max(1, avgGlyph * 0.5);
    const needsSpace = gap > tol && !/\s$/.test(text) && !/^\s/.test(cur.str);
    text += (needsSpace ? " " : "") + cur.str;
  }
  return text.replace(/[\t ]{2,}/g, " ").trim();
}

/** pdfjs-Text-Items → Top-Left-Geometrie (Punkte). */
function mapDocxItems(rawItems: unknown[], viewportHeight: number): DocxItem[] {
  return (rawItems as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>)
    .filter((it) => typeof it.str === "string" && (it.str as string).length > 0)
    .map((it) => ({
      str: it.str as string,
      x: it.transform ? it.transform[4] : 0,
      yTop: viewportHeight - (it.transform ? it.transform[5] : 0) - (it.height ?? 0) * 0.8,
      w: it.width ?? 0,
      h: it.height ?? 0,
    }));
}

/** Items in Zeilen clustern (y-Nähe), je Zeile Text + Bounding-Box. */
function clusterLines(items: DocxItem[]): DocxLine[] {
  const valid = items.filter((it) => it.str.length > 0);
  if (valid.length === 0) return [];
  const heights = valid.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  const rowTol = Math.max(2, medH * 0.6);
  valid.sort((a, b) => a.yTop - b.yTop || a.x - b.x);
  const lines: DocxLine[] = [];
  let bucket: DocxItem[] = [];
  let curY = valid[0].yTop;
  const flush = () => {
    if (!bucket.length) return;
    const sorted = bucket.slice().sort((a, b) => a.x - b.x);
    const hs = sorted.map((e) => e.h).filter((h) => h > 0).sort((a, b) => a - b);
    lines.push({
      text: joinDocxLine(sorted),
      xMin: Math.min(...sorted.map((e) => e.x)),
      xMax: Math.max(...sorted.map((e) => e.x + e.w)),
      yTop: Math.min(...sorted.map((e) => e.yTop)),
      yBottom: Math.max(...sorted.map((e) => e.yTop + e.h)),
      medH: hs.length ? hs[Math.floor(hs.length / 2)] : medH,
    });
    bucket = [];
  };
  for (const e of valid) {
    if (bucket.length && Math.abs(e.yTop - curY) > rowTol) flush();
    if (!bucket.length) curY = e.yTop;
    bucket.push(e);
  }
  flush();
  return lines;
}

/** Zeilen zu Absätzen gruppieren (vertikale Lücke) + Schriftgröße ableiten. */
function linesToParagraphs(lines: DocxLine[]): { text: string; sizeHalfPt: number }[] {
  if (lines.length === 0) return [];
  const allH = lines.map((l) => l.medH).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = allH.length ? allH[Math.floor(allH.length / 2)] : 10;
  const paraGap = Math.max(medH * 1.8, 2);
  const paras: { text: string; sizeHalfPt: number }[] = [];
  let paraLines: DocxLine[] = [];
  let prevY: number | null = null;
  const pushPara = () => {
    const text = paraLines.map((l) => l.text).join(" ").replace(/[\t ]{2,}/g, " ").trim();
    if (!text) { paraLines = []; return; }
    const hs = paraLines.map((l) => l.medH).filter((h) => h > 0).sort((a, b) => a - b);
    const ptH = hs.length ? hs[Math.floor(hs.length / 2)] : medH;
    // PDF-Item-Höhe ≈ Schriftgröße in pt → Word-half-points (pt*2), geklemmt.
    paras.push({ text, sizeHalfPt: Math.min(96, Math.max(12, Math.round(ptH * 2))) });
    paraLines = [];
  };
  for (const ln of lines) {
    if (!ln.text) continue;
    if (prevY !== null && ln.yTop - prevY > paraGap) pushPara();
    paraLines.push(ln);
    prevY = ln.yTop;
  }
  pushPara();
  return paras;
}

/**
 * PDF → DOCX: Best-Effort-Textfluss (Absätze rekonstruiert, keine 1:1-Layout-
 * Treue). Minimal-gültiges .docx von Hand als OOXML-ZIP (fflate).
 */
export async function toDocx(bytes: Uint8Array): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const pdfjs = await getPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  } catch (e) {
    throw new ToolError(`DOCX-Konvertierung fehlgeschlagen (${errMsg(e)}).`);
  }
  try {
    const total = doc.numPages;
    enforcePages(total);
    const enc = new TextEncoder();
    const bodyParts: string[] = [];
    for (let p = 1; p <= total; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const paras = linesToParagraphs(clusterLines(mapDocxItems(content.items, vp.height)));
      if (p > 1) bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      if (paras.length === 0) { bodyParts.push("<w:p/>"); page.cleanup(); continue; }
      for (const par of paras) {
        bodyParts.push(
          '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>' +
          `<w:r><w:rPr><w:sz w:val="${par.sizeHalfPt}"/><w:szCs w:val="${par.sizeHalfPt}"/></w:rPr>` +
          `<w:t xml:space="preserve">${docxXmlEscape(par.text)}</w:t></w:r></w:p>`
        );
      }
      page.cleanup();
    }
    if (bodyParts.length === 0) bodyParts.push("<w:p/>");

    const documentXml = DOCX_XML_DECL +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      bodyParts.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
      "</w:sectPr></w:body></w:document>";
    const contentTypesXml = DOCX_XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>";
    const rootRels = DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";
    const docRels = DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
    const stylesXml = DOCX_XML_DECL +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
      '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      "</w:styles>";

    const files: Record<string, Uint8Array> = {
      "[Content_Types].xml": enc.encode(contentTypesXml),
      "_rels/.rels": enc.encode(rootRels),
      "word/document.xml": enc.encode(documentXml),
      "word/_rels/document.xml.rels": enc.encode(docRels),
      "word/styles.xml": enc.encode(stylesXml),
    };
    return { bytes: zipSync(files, { level: 6 }), pageCount: total };
  } finally {
    await doc.loadingTask.destroy();
  }
}

function hexToRgbColor(hex: string | undefined | null, fallback: ReturnType<typeof rgb>): ReturnType<typeof rgb> {
  if (!hex) return fallback;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return fallback;
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

/** WinAnsi-sichere Teilmenge: nicht kodierbare Zeichen entfernen. */
function winAnsiSafe(s: string): string {
  return Array.from(s)
    .filter((c) => { const code = c.charCodeAt(0); return code >= 0x20 && code <= 0xff && !(code >= 0x7f && code <= 0x9f); })
    .join("");
}

export interface TextReplacement { find: string; replace: string; }
export interface TextEditOptions { pages?: string; color?: string; bgColor?: string; }

/**
 * Inline-Text-Ersetzen (Suchen & Ersetzen) als Cover + Redraw: Zeilen, die
 * `find` enthalten, werden opak übermalt und mit `find`→`replace` neu gezeichnet.
 * KEIN Reflow; die Zeile wird in Helvetica (WinAnsi) neu gezeichnet. Der
 * ursprüngliche Text bleibt im Content-Stream (übermalt, weiterhin extrahierbar)
 * — für garantierte Entfernung ist Rasterung/Redaktion nötig.
 */
export async function applyTextReplacements(
  bytes: Uint8Array,
  replacements: TextReplacement[],
  opts: TextEditOptions = {},
): Promise<{ bytes: Uint8Array; replaced: number }> {
  const active = (replacements ?? []).filter((r) => r && typeof r.find === "string" && r.find.length > 0);
  if (active.length === 0) throw new ToolError("Keine gültigen Ersetzungen ('replacements' mit nicht-leerem 'find').");

  interface LineEdit { page: number; xMin: number; width: number; yTop: number; height: number; medH: number; newText: string; }
  const edits: LineEdit[] = [];

  // 1) Geometrie via pdfjs (auf einer Kopie — pdfjs detacht den Buffer).
  const pdfjs = await getPdfjs();
  let jdoc;
  try {
    jdoc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  } catch (e) {
    throw new ToolError(`Text-Ersetzen fehlgeschlagen (${errMsg(e)}).`);
  }
  try {
    const total = jdoc.numPages;
    enforcePages(total);
    const want = opts.pages
      ? [...new Set(parsePageSpec(opts.pages, total))].sort((a, b) => a - b)
      : Array.from({ length: total }, (_, i) => i + 1);
    for (const p of want) {
      const page = await jdoc.getPage(p);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      for (const line of clusterLines(mapDocxItems(content.items, vp.height))) {
        let newText = line.text;
        let hit = false;
        for (const r of active) {
          if (newText.includes(r.find)) { newText = newText.split(r.find).join(r.replace); hit = true; }
        }
        if (hit) edits.push({ page: p, xMin: line.xMin, width: line.xMax - line.xMin, yTop: line.yTop, height: line.yBottom - line.yTop, medH: line.medH, newText });
      }
      page.cleanup();
    }
  } finally {
    await jdoc.loadingTask.destroy();
  }

  if (edits.length === 0) return { bytes, replaced: 0 };

  // 2) Cover + Redraw via pdf-lib.
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const fg = hexToRgbColor(opts.color, rgb(0.07, 0.07, 0.07));
  const bg = hexToRgbColor(opts.bgColor, rgb(1, 1, 1));
  for (const ed of edits) {
    const page = pages[ed.page - 1];
    if (!page) continue;
    const ph = page.getHeight();
    const size = Math.max(4, ed.medH);
    const pad = Math.max(1, size * 0.15);
    page.drawRectangle({
      x: ed.xMin - pad,
      y: ph - (ed.yTop + ed.height) - pad,
      width: ed.width + 2 * pad,
      height: ed.height + 2 * pad,
      color: bg,
      opacity: 1,
    });
    const line = ed.newText.replace(/\t/g, " ");
    const y = ph - ed.yTop - size;
    try {
      page.drawText(line, { x: ed.xMin, y, size, font, color: fg });
    } catch {
      const safe = winAnsiSafe(line);
      if (safe) { try { page.drawText(safe, { x: ed.xMin, y, size, font, color: fg }); } catch { /* skip */ } }
    }
  }
  doc.setProducer("Pagebound Edit");
  return { bytes: await doc.save(), replaced: edits.length };
}

// --- Metadata ----------------------------------------------------------------

export interface PdfMetadataInput {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
}

/** Setzt Dokument-Metadaten (nur die übergebenen Felder). Returns angewandte Felder. */
export async function setMetadata(input: Uint8Array, meta: PdfMetadataInput): Promise<{ bytes: Uint8Array; applied: string[] }> {
  const doc = await loadDoc(input);
  const applied: string[] = [];
  if (meta.title !== undefined) { doc.setTitle(meta.title); applied.push("title"); }
  if (meta.author !== undefined) { doc.setAuthor(meta.author); applied.push("author"); }
  if (meta.subject !== undefined) { doc.setSubject(meta.subject); applied.push("subject"); }
  if (meta.keywords !== undefined) { doc.setKeywords(meta.keywords); applied.push("keywords"); }
  if (meta.creator !== undefined) { doc.setCreator(meta.creator); applied.push("creator"); }
  if (meta.producer !== undefined) { doc.setProducer(meta.producer); applied.push("producer"); }
  if (applied.length === 0) throw new ToolError("Keine Metadaten angegeben (title/author/subject/keywords/creator/producer).");
  return { bytes: await save(doc), applied };
}

// --- AcroForm field creation -------------------------------------------------

export interface NewField {
  name: string;
  type: "text" | "checkbox";
  /** 1-basierte Seitenzahl. */
  page: number;
  /** Position/Größe in PDF-Punkten, Ursprung UNTEN-links (pdf-lib-Konvention). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text: Vorbelegung; Checkbox: "true"/"on" = angehakt. */
  value?: string;
}

/** Legt AcroForm-Felder (Text/Checkbox) an. Einstieg in die Formular-Erstellung. */
export async function createFields(input: Uint8Array, fields: NewField[]): Promise<{ bytes: Uint8Array; created: number }> {
  if (!fields || fields.length === 0) throw new ToolError("Keine Felder angegeben.");
  const doc = await loadDoc(input);
  const form = doc.getForm();
  const pages = doc.getPages();
  let created = 0;
  for (const f of fields) {
    if (!f.name) throw new ToolError("Feldname fehlt.");
    const page = pages[f.page - 1];
    if (!page) throw new ToolError(`Seite ${f.page} existiert nicht (1–${pages.length}).`);
    const rect = { x: f.x, y: f.y, width: f.width, height: f.height };
    try {
      if (f.type === "checkbox") {
        const cb = form.createCheckBox(f.name);
        cb.addToPage(page, rect);
        if (f.value === "true" || f.value === "on") cb.check();
      } else {
        const tf = form.createTextField(f.name);
        if (f.value !== undefined) tf.setText(f.value);
        tf.addToPage(page, rect);
      }
    } catch (e) {
      throw new ToolError(`Feld '${f.name}' nicht anlegbar (${errMsg(e)}). Name evtl. schon vergeben?`);
    }
    created++;
  }
  return { bytes: await save(doc), created };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Text diff between two PDFs ----------------------------------------------

export interface PdfPageDiff {
  page: number;
  added: string[];
  removed: string[];
}

export interface PdfDiffResult {
  pageCountA: number;
  pageCountB: number;
  changed: boolean;
  addedLines: number;
  removedLines: number;
  /** Nur Seiten mit Unterschieden. */
  pages: PdfPageDiff[];
}

// Schutz gegen O(n·m)-Blowup der LCS-Matrix bei pathologisch langen Seiten.
const MAX_DIFF_LINES = 4000;

/**
 * Zeilenbasierter Diff via LCS. Liefert die in B hinzugekommenen und die aus A
 * entfernten Zeilen (gemeinsame Zeilen zählen als unverändert).
 */
function lineDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const n = Math.min(a.length, MAX_DIFF_LINES);
  const m = Math.min(b.length, MAX_DIFF_LINES);
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { removed.push(a[i]); i++; }
    else { added.push(b[j]); j++; }
  }
  while (i < n) { removed.push(a[i]); i++; }
  while (j < m) { added.push(b[j]); j++; }
  return { added, removed };
}

const splitLines = (text: string): string[] => text.split("\n").map((s) => s.trim()).filter(Boolean);

/**
 * Vergleicht den Text-Layer zweier PDFs seitenweise (kein OCR). Gut, um
 * Versionsunterschiede zu finden ("was hat sich von A zu B geändert?").
 */
export async function diffText(a: Uint8Array, b: Uint8Array): Promise<PdfDiffResult> {
  const ta = await extractText(a);
  const tb = await extractText(b);
  const maxPages = Math.max(ta.pageCount, tb.pageCount);
  const pages: PdfPageDiff[] = [];
  let addedLines = 0;
  let removedLines = 0;
  for (let p = 1; p <= maxPages; p++) {
    const linesA = splitLines(ta.pages.find((x) => x.page === p)?.text ?? "");
    const linesB = splitLines(tb.pages.find((x) => x.page === p)?.text ?? "");
    const { added, removed } = lineDiff(linesA, linesB);
    if (added.length || removed.length) {
      pages.push({ page: p, added, removed });
      addedLines += added.length;
      removedLines += removed.length;
    }
  }
  return {
    pageCountA: ta.pageCount,
    pageCountB: tb.pageCount,
    changed: pages.length > 0,
    addedLines,
    removedLines,
    pages,
  };
}
