// =============================================================================
// Pagebound — PDF.js Bridge
// ----------------------------------------------------------------------------
// Wird von Blazor WASM via IJSRuntime.InvokeAsync("pageboundPdf.<fn>", ...) genutzt.
// Bridge hält die Document-Instanzen in einer Map (Schlüssel = handleId),
// damit die C#-Seite mit einem einfachen String-Handle arbeiten kann.
//
// Entsprechende C#-Klasse: Pagebound.Infrastructure.Pdf.PdfJsRenderer.
// =============================================================================

import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import { zipSync } from "fflate";
import type {
  PDFDocumentProxy,
  PDFPageProxy
} from "pdfjs-dist/types/src/display/api";

// Shim statt direkt pdf.worker.min.mjs: polyfillt Math.sumPrecise (pdfjs 5.7
// braucht es) im Worker, bevor der echte Worker lädt — sonst crasht das
// Rendering in Browsern ohne dieses sehr neue API. Siehe pdfjs-worker-shim.mjs.
pdfjsLib.GlobalWorkerOptions.workerSrc = "/js/pdfjs-worker-shim.mjs";

const documents = new Map<string, PDFDocumentProxy>();

export interface LoadResult {
  id: string;
  pageCount: number;
  title: string | null;
}

export interface RenderResult {
  pageNumber: number;
  widthPx: number;
  heightPx: number;
  rasterBase64: string;
  rasterFormat: "image/png";
  pageWidthPt: number;
  pageHeightPt: number;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pdf-${crypto.randomUUID()}`;
  }
  return `pdf-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function requireDoc(handleId: string): PDFDocumentProxy {
  const doc = documents.get(handleId);
  if (!doc) {
    throw new Error(`Pagebound: unknown PDF handle '${handleId}'.`);
  }
  return doc;
}

export async function loadPdf(
  data: Uint8Array,
  password: string | null
): Promise<LoadResult> {
  const task = pdfjsLib.getDocument({
    data,
    password: password ?? undefined,
    disableAutoFetch: true,
    disableStream: false
  });
  const doc = await task.promise;
  const id = newId();
  documents.set(id, doc);

  let title: string | null = null;
  try {
    const meta = await doc.getMetadata();
    const info = meta?.info as { Title?: string } | undefined;
    title = info?.Title ?? null;
  } catch {
    title = null;
  }

  return { id, pageCount: doc.numPages, title };
}

export async function renderPage(
  handleId: string,
  pageNumber: number,
  scale: number
): Promise<RenderResult> {
  const doc = requireDoc(handleId);
  const page: PDFPageProxy = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const baseViewport = page.getViewport({ scale: 1 });
  const widthPx = Math.ceil(viewport.width);
  const heightPx = Math.ceil(viewport.height);

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Pagebound: failed to get 2D rendering context.");
  }

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  // Strip "data:image/png;base64," prefix; Blazor wants raw base64.
  const dataUrl = canvas.toDataURL("image/png");
  const rasterBase64 = dataUrl.substring(dataUrl.indexOf(",") + 1);

  return {
    pageNumber,
    widthPx,
    heightPx,
    rasterBase64,
    rasterFormat: "image/png",
    pageWidthPt: baseViewport.width,
    pageHeightPt: baseViewport.height
  };
}

export interface OutlineEntryDto {
  title: string;
  pageNumber: number | null;
  children: OutlineEntryDto[];
}

interface RawOutlineItem {
  title: string;
  dest: unknown;
  items: RawOutlineItem[];
}

/**
 * Builds the table-of-contents tree (FA-006). PDF.js returns destinations
 * either as an inline array referencing a page object, or as a named
 * destination string that needs to be resolved via `doc.getDestination`.
 * Either way, the final page index comes from `doc.getPageIndex(pageRef)`.
 * Missing or unresolvable destinations are reported with `pageNumber: null`
 * so the UI can still render the entry as a section heading.
 */
export async function getOutline(handleId: string): Promise<OutlineEntryDto[]> {
  const doc = requireDoc(handleId);
  const raw = (await doc.getOutline()) as unknown as RawOutlineItem[] | null;
  if (!raw || raw.length === 0) return [];

  async function resolvePage(dest: unknown): Promise<number | null> {
    if (!dest) return null;
    try {
      const resolved =
        typeof dest === "string" ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(resolved) || resolved.length === 0) return null;
      const pageRef = resolved[0];
      const pageIndex = await doc.getPageIndex(pageRef as never);
      return pageIndex + 1;
    } catch {
      return null;
    }
  }

  async function convert(items: RawOutlineItem[]): Promise<OutlineEntryDto[]> {
    const out: OutlineEntryDto[] = [];
    for (const item of items) {
      const pageNumber = await resolvePage(item.dest);
      const children = item.items && item.items.length > 0
        ? await convert(item.items)
        : [];
      out.push({ title: item.title, pageNumber, children });
    }
    return out;
  }

  return convert(raw);
}

export async function unload(handleId: string): Promise<void> {
  const doc = documents.get(handleId);
  if (!doc) return;
  documents.delete(handleId);
  try {
    await doc.loadingTask.destroy();
  } catch {
    /* ignore */
  }
}

export function isLoaded(handleId: string): boolean {
  return documents.has(handleId);
}

// =============================================================================
// Text-Extraktion und Suche (FA-005)
// =============================================================================

export interface TextItemDto {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchHitDto {
  pageNumber: number;
  position: number;
  match: string;
  snippet: string;
  snippetMatchStart: number;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

const SNIPPET_RADIUS = 40;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a searchable page-text from PDF.js text items.
 *
 * Naive `items.map(i => i.str).join(" ")` breaks when a PDF was rendered with
 * hand-positioned glyphs (typical for stylish CVs and design-heavy documents):
 * single letters arrive as individual items and "Web" becomes "W e b", killing
 * every substring search.
 *
 * Strategy here:
 *   - Concatenate item strings without any separator (so "W"+"e"+"b" => "Web").
 *   - Insert a space when the next item is visually separate from the current
 *     one (different Y baseline, or an X-gap larger than the item is wide).
 *   - Insert a space when the item ends a line (`hasEOL`).
 *   - Never produce double whitespace (final collapse).
 */
function buildPageText(items: PdfTextItem[]): string {
  let text = "";
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    text += cur.str;

    const next = items[i + 1];
    if (!next) {
      if (cur.hasEOL && !text.endsWith(" ")) text += " ";
      continue;
    }

    // Skip if either side already has whitespace at the join.
    const curEndsWS = /\s$/.test(cur.str);
    const nextStartsWS = /^\s/.test(next.str);

    if (cur.hasEOL) {
      if (!curEndsWS) text += " ";
      continue;
    }

    if (curEndsWS || nextStartsWS) continue;

    const curY = cur.transform[5];
    const nextY = next.transform[5];
    const curEndX = cur.transform[4] + cur.width;
    const nextStartX = next.transform[4];

    // Different visual line → separator.
    if (Math.abs(curY - nextY) > 1) {
      text += " ";
      continue;
    }

    // Significant horizontal gap → separator. We compare against half the
    // average glyph width: kerning gaps stay inside the threshold (no space
    // injected between "W"+"e"+"b"), while real inter-word gaps cross it.
    const avgGlyph = cur.width / Math.max(cur.str.length, 1);
    const tolerance = Math.max(1, avgGlyph * 0.5);
    if (nextStartX - curEndX > tolerance) {
      text += " ";
    }
  }
  // Collapse any accidental run of whitespace; leaves "real" spaces intact.
  return text.replace(/[\t ]{2,}/g, " ");
}

async function readPageText(
  doc: PDFDocumentProxy,
  pageNumber: number
): Promise<{ items: PdfTextItem[]; pageText: string; viewportHeight: number }> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const items = content.items as unknown as PdfTextItem[];
  const pageText = buildPageText(items);
  const viewport = page.getViewport({ scale: 1 });
  return { items, pageText, viewportHeight: viewport.height };
}

export async function extractText(
  handleId: string,
  pageNumber: number
): Promise<TextItemDto[]> {
  // Wird nur noch für FA-005-Suche genutzt (C#-seitig). Text-Layer-Rendering
  // läuft separat über `renderTextLayerToContainer`, das PDF.js' eigene
  // TextLayer-Klasse aufruft und damit pixel-genau positioniert.
  const doc = requireDoc(handleId);
  const { items, viewportHeight } = await readPageText(doc, pageNumber);

  return items.map((it) => {
    const tx = it.transform[4];
    const ty = viewportHeight - it.transform[5] - it.height * 0.80;
    return { text: it.str, x: tx, y: ty, width: it.width, height: it.height };
  });
}

// ============================================================================
// Konvertierungen (FA-030 PNG/JPG, FA-031 Text, FA-032 HTML)
// ----------------------------------------------------------------------------
// One-Shot-Konverter: nehmen die rohen PDF-Bytes, laden ein transientes
// Dokument (NICHT in der documents-Map), erzeugen das Zielformat und räumen
// wieder auf. Aufrufer ist IPdfConverter / die /tools-Seite.
// ============================================================================

async function withTransientDoc<T>(
  data: Uint8Array,
  fn: (doc: PDFDocumentProxy) => Promise<T>
): Promise<T> {
  const task = pdfjsLib.getDocument({
    data,
    disableAutoFetch: true
  });
  const doc = await task.promise;
  try {
    return await fn(doc);
  } finally {
    try { await doc.loadingTask.destroy(); } catch { /* ignore */ }
  }
}

async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Pagebound: 2D context unavailable.");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** FA-031: ganzes PDF als reiner Text, Seiten durch Form-Feed getrennt. */
export async function convertToText(data: Uint8Array): Promise<string> {
  return withTransientDoc(data, async (doc) => {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const { pageText } = await readPageText(doc, i);
      parts.push(pageText);
    }
    return parts.join("\n\n\f\n");
  });
}

// ============================================================================
// PDF-Vergleich (Text-Diff zweier PDFs, seitenweise) — Roadmap "PDF-Diff"
// ----------------------------------------------------------------------------
// buildPageText fügt Wörter mit Leerzeichen (keine \n) zusammen, daher
// vergleichen wir auf WORT-Ebene (LCS). Liefert je geänderter Seite die in B
// hinzugekommenen und die aus A entfernten Wörter — 100 % lokal, kein OCR.
// ============================================================================

function b64ToBytesLocal(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const MAX_DIFF_TOKENS = 6000; // Schutz gegen O(n·m)-LCS-Blowup je Seite

function tokenDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const n = Math.min(a.length, MAX_DIFF_TOKENS);
  const m = Math.min(b.length, MAX_DIFF_TOKENS);
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

async function allPageTexts(data: Uint8Array): Promise<string[]> {
  return withTransientDoc(data, async (doc) => {
    const out: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const { pageText } = await readPageText(doc, p);
      out.push(pageText);
    }
    return out;
  });
}

// ============================================================================
// Redaktions-Audit (Roadmap A4) — Text-Fragment-Boxen je Seite
// ----------------------------------------------------------------------------
// Liefert für die angefragten Seiten die Bounding-Boxes aller Text-Fragmente im
// Text-Layer, als Page-Fractions (0..1, Ursprung oben-links — wie RedactionRegion
// im Reader). C# prüft damit, ob in den geschwärzten Zonen noch extrahierbarer
// Text liegt (vorher/nachher). 100 % lokal, kein OCR, kein Netz.
// ============================================================================
export async function textRectsForPages(
  dataB64: string,
  pages: number[]
): Promise<{ page: number; rects: { x: number; y: number; w: number; h: number }[] }[]> {
  const data = b64ToBytesLocal(dataB64);
  return withTransientDoc(data, async (doc) => {
    const result: { page: number; rects: { x: number; y: number; w: number; h: number }[] }[] = [];
    const done = new Set<number>();
    for (const p of pages ?? []) {
      if (done.has(p) || p < 1 || p > doc.numPages) continue;
      done.add(p);
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const items = content.items as unknown as PdfTextItem[];
      const rects = items
        .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
        .map((it) => {
          const x = it.transform[4];
          const yTop = vp.height - it.transform[5] - it.height * 0.8;
          return {
            x: x / vp.width,
            y: yTop / vp.height,
            w: it.width / vp.width,
            h: it.height / vp.height,
          };
        });
      result.push({ page: p, rects });
    }
    return result;
  });
}

// ============================================================================
// Tabellen-Extraktion (Roadmap B2) — Best-Effort PDF → CSV
// ----------------------------------------------------------------------------
// Reine Heuristik auf den Text-Positionen (KEIN ML): Items werden zeilenweise
// über ihre y-Position geclustert, innerhalb der Zeile über horizontale Lücken
// in Zellen getrennt. Gut bei tabellarischen Layouts, bei Fließtext erwartungs-
// gemäß grob. Seiten werden aneinandergehängt. 100 % lokal.
// ============================================================================
interface TblItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function csvEscapeCell(s: string): string {
  const v = s.trim();
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function pageItemsToCsv(items: TblItem[]): string[] {
  if (items.length === 0) return [];
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  const rowTol = Math.max(2, medH * 0.6); // selbe Zeile, wenn y-Abstand kleiner
  const colGap = Math.max(4, medH * 1.2); // neue Zelle, wenn x-Lücke größer

  // 1) Zeilen über y clustern
  const byY = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TblItem[][] = [];
  let cur: TblItem[] = [];
  let curY = byY[0].y;
  for (const it of byY) {
    if (cur.length && Math.abs(it.y - curY) > rowTol) {
      rows.push(cur);
      cur = [];
    }
    if (!cur.length) curY = it.y;
    cur.push(it);
  }
  if (cur.length) rows.push(cur);

  // 2) je Zeile über x-Lücken in Zellen trennen
  return rows.map((row) => {
    const sorted = row.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let cell = sorted[0].str;
    let prevRight = sorted[0].x + sorted[0].w;
    for (let i = 1; i < sorted.length; i++) {
      const it = sorted[i];
      if (it.x - prevRight > colGap) {
        cells.push(cell);
        cell = it.str;
      } else {
        cell += (cell.endsWith(" ") || it.str.startsWith(" ") ? "" : " ") + it.str;
      }
      prevRight = it.x + it.w;
    }
    cells.push(cell);
    return cells.map(csvEscapeCell).join(",");
  });
}

export async function extractTablesCsv(data: Uint8Array): Promise<string> {
  return withTransientDoc(data, async (doc) => {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const items: TblItem[] = (content.items as unknown as PdfTextItem[])
        .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: vp.height - it.transform[5],
          w: it.width || 0,
          h: it.height || 0,
        }));
      const csvRows = pageItemsToCsv(items);
      if (csvRows.length) pages.push(csvRows.join("\n"));
    }
    return pages.join("\n\n");
  });
}

export interface PdfDiffPageDto { page: number; added: string[]; removed: string[]; }
export interface PdfDiffDto {
  pageCountA: number;
  pageCountB: number;
  changed: boolean;
  pages: PdfDiffPageDto[];
}

/** Vergleicht zwei PDFs (base64) auf Text-Ebene, seitenweise, wortgenau. */
export async function diffPdfText(aBase64: string, bBase64: string): Promise<PdfDiffDto> {
  const [ta, tb] = await Promise.all([
    allPageTexts(b64ToBytesLocal(aBase64)),
    allPageTexts(b64ToBytesLocal(bBase64)),
  ]);
  const tokens = (t: string): string[] => (t ?? "").split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const maxPages = Math.max(ta.length, tb.length);
  const pages: PdfDiffPageDto[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { added, removed } = tokenDiff(tokens(ta[p] ?? ""), tokens(tb[p] ?? ""));
    if (added.length || removed.length) pages.push({ page: p + 1, added, removed });
  }
  return { pageCountA: ta.length, pageCountB: tb.length, changed: pages.length > 0, pages };
}

/**
 * FA-030: jede Seite als PNG/JPG rendern und in ein (store-only) ZIP packen.
 * Bilder sind bereits komprimiert, daher level 0 — schneller, kaum größer.
 */
export async function convertToImagesZip(
  data: Uint8Array,
  format: "png" | "jpeg",
  quality: number,
  scale: number
): Promise<Uint8Array> {
  return withTransientDoc(data, async (doc) => {
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const ext = format === "jpeg" ? "jpg" : "png";
    const files: Record<string, Uint8Array> = {};
    const pad = String(doc.numPages).length;
    for (let i = 1; i <= doc.numPages; i++) {
      const canvas = await renderPageToCanvas(doc, i, scale);
      const dataUrl = format === "jpeg" ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
      files[`seite-${String(i).padStart(pad, "0")}.${ext}`] = dataUrlToBytes(dataUrl);
    }
    return zipSync(files, { level: 0 });
  });
}

/**
 * FA-032: PDF als eigenständiges HTML mit pixel-genauer Treue — jede Seite als
 * eingebettetes PNG (base64). Kein externer Request, offline öffenbar.
 */
export async function convertToHtml(data: Uint8Array, scale: number): Promise<string> {
  return withTransientDoc(data, async (doc) => {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const canvas = await renderPageToCanvas(doc, i, scale);
      const dataUrl = canvas.toDataURL("image/png");
      pages.push(
        `<section class="page"><img alt="Seite ${i}" width="${canvas.width}" height="${canvas.height}" src="${dataUrl}"></section>`
      );
    }
    return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<title>Pagebound Export</title>`
      + `<style>body{margin:0;background:#525659}.page{display:flex;justify-content:center;padding:16px}`
      + `img{max-width:100%;height:auto;box-shadow:0 2px 8px rgba(0,0,0,.4)}</style></head><body>\n`
      + pages.join("\n")
      + `\n</body></html>`;
  });
}

/**
 * Generisches ZIP für die Stapelverarbeitung (FA-051): parallele Arrays aus
 * Dateinamen + Base64-Inhalten → ein deflate-komprimiertes ZIP.
 */
export function zipFiles(names: string[], base64Contents: string[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < names.length; i++) {
    const bin = atob(base64Contents[i]);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    files[names[i]] = bytes;
  }
  return zipSync(files, { level: 6 });
}

// ============================================================================
// Native Text-Layer-Rendering (FA-005 Selection, FA-010 Highlight-Picking)
// ----------------------------------------------------------------------------
// PDF.js' eigene TextLayer-Klasse rendert die Word-Spans pixel-genau über das
// gerenderte Seitenbild — Selection-Boxen kleben damit exakt am Schriftbild,
// auch bei stylisierten Headlines. Eigener Razor-Markup mit scaleX-Annäherung
// hat das nicht zuverlässig hinbekommen, weil das System-Font im Browser nie
// dieselben Glyphen-Metriken hat wie der PDF-Font.
//
// Strategy:
//   - Layer wird mit viewport scale=1 gerendert (Spans in PDF-Punkten).
//   - Container hat Pixel-Größe in PDF-Punkten, ein CSS transform: scale(...)
//     skaliert ihn nachträglich auf die actual displayed width.
//   - Ein ResizeObserver hält die Skalierung auch bei Window-Resize bei.
// ============================================================================

interface TextLayerLease {
  resizeObserver: ResizeObserver | null;
  cancel: () => void;
}

const activeTextLayers = new Map<string, TextLayerLease>();

function disposeTextLayer(containerSelector: string): void {
  const lease = activeTextLayers.get(containerSelector);
  if (!lease) return;
  try { lease.cancel(); } catch { /* ignore */ }
  try { lease.resizeObserver?.disconnect(); } catch { /* ignore */ }
  activeTextLayers.delete(containerSelector);
}

export async function renderTextLayerToContainer(
  handleId: string,
  pageNumber: number,
  containerSelector: string,
  imageSelector: string
): Promise<TextItemDto[]> {
  disposeTextLayer(containerSelector);

  const container = document.querySelector(containerSelector);
  const image = document.querySelector(imageSelector);
  if (!(container instanceof HTMLElement) || !(image instanceof HTMLElement)) {
    return [];
  }

  const doc = requireDoc(handleId);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });

  // Container muss die pb-textLayer-CSS-Klasse tragen (kommt aus dem Razor-
  // Markup, damit Blazor sie bei Re-Renders nicht überschreibt — wenn wir die
  // hier per classList.add setzen würden, kickt der nächste Werkzeug-Wechsel
  // den `color: transparent`-Style raus und der Text-Layer wird wieder
  // sichtbar). Wir kümmern uns hier nur um die dynamischen Teile: innerHTML
  // leeren, --total-scale-factor setzen.
  container.innerHTML = "";
  // setLayerDimensions in PDF.js setzt width = `calc(var(--total-scale-factor)
  // * pageWidth px)` — wir müssen --total-scale-factor auf das tatsächliche
  // Verhältnis Display-Width/PDF-Width setzen.
  function applyScale(): void {
    // Der äußere instanceof-Guard wird von TS nicht in diese Closure propagiert
    // → hier erneut prüfen (immer wahr, da container/image const sind); engt
    // beide auf HTMLElement (non-null, mit .style) ein.
    if (!(image instanceof HTMLElement) || !(container instanceof HTMLElement)) return;
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || viewport.width <= 0) return;
    const factor = rect.width / viewport.width;
    container.style.setProperty("--total-scale-factor", factor.toFixed(6));
  }
  applyScale();

  const textContent = await page.getTextContent();
  const textLayer = new TextLayer({
    textContentSource: textContent,
    container,
    viewport
  });
  await textLayer.render();

  const resizeObserver = new ResizeObserver(() => applyScale());
  resizeObserver.observe(image);

  activeTextLayers.set(containerSelector, {
    resizeObserver,
    cancel: () => textLayer.cancel()
  });

  // Items für die Such-Funktion zurückgeben — derselbe ascent-Trick wie in
  // `extractText` (search-side bleibt unverändert kompatibel).
  const items = textContent.items as unknown as PdfTextItem[];
  return items.map((it) => ({
    text: it.str,
    x: it.transform[4],
    y: viewport.height - it.transform[5] - it.height * 0.80,
    width: it.width,
    height: it.height
  }));
}

export function clearTextLayer(containerSelector: string): void {
  disposeTextLayer(containerSelector);
  const container = document.querySelector(containerSelector);
  if (container instanceof HTMLElement) {
    container.innerHTML = "";
    // pb-textLayer-Klasse nicht entfernen — Razor verwaltet sie. --total-scale-factor
    // räumen wir aber auf, damit ein späterer native-Render wieder sauber neu setzt.
    container.style.removeProperty("--total-scale-factor");
  }
}

// =============================================================================
// Formular-Builder: Pointer-Drag/-Resize platzierter Felder (.fb-field) über
// gerenderten Seiten (.fb-page). Geometrie in Prozent der Seitenfläche; am
// Gesten-Ende geht sie an C# (ein Undo-/State-Update pro Geste). Pointer Events
// = Maus, Touch und Stift.
// =============================================================================

let fbRef: { invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown> } | null = null;

export function registerFormBuilder(dotnetRef: { invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown> }): void {
  fbRef = dotnetRef;
  if ((document as any).__pbFbWired) return;
  (document as any).__pbFbWired = true;

  document.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!fbRef) return;
    const target = e.target as HTMLElement | null;
    const field = target?.closest?.(".fb-field") as HTMLElement | null;
    if (!field) return;
    const page = field.closest(".fb-page") as HTMLElement | null;
    if (!page) return;
    e.preventDefault();
    const resize = !!target?.closest?.(".fb-resize");
    const pageRect = page.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseFloat(field.style.left) || 0;
    const startTop = parseFloat(field.style.top) || 0;
    const startWidth = parseFloat(field.style.width) || 10;
    const startHeight = parseFloat(field.style.height) || 4;
    try { field.setPointerCapture(e.pointerId); } catch { /* synthetische Events */ }

    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / pageRect.width) * 100;
      const dy = ((ev.clientY - startY) / pageRect.height) * 100;
      if (resize) {
        field.style.width = `${Math.min(100, Math.max(1.5, startWidth + dx)).toFixed(2)}%`;
        field.style.height = `${Math.min(100, Math.max(1, startHeight + dy)).toFixed(2)}%`;
      } else {
        field.style.left = `${Math.min(98, Math.max(0, startLeft + dx)).toFixed(2)}%`;
        field.style.top = `${Math.min(98, Math.max(0, startTop + dy)).toFixed(2)}%`;
      }
    };
    const onUp = () => {
      field.removeEventListener("pointermove", onMove);
      field.removeEventListener("pointerup", onUp);
      field.removeEventListener("pointercancel", onUp);
      const id = field.dataset.fbId ?? "";
      void fbRef?.invokeMethodAsync("OnFieldGeometry", id,
        parseFloat(field.style.left) || 0,
        parseFloat(field.style.top) || 0,
        parseFloat(field.style.width) || startWidth,
        parseFloat(field.style.height) || startHeight);
    };
    field.addEventListener("pointermove", onMove);
    field.addEventListener("pointerup", onUp);
    field.addEventListener("pointercancel", onUp);
  });
}

export async function search(
  handleId: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean
): Promise<SearchHitDto[]> {
  if (!query || query.length === 0) return [];
  const doc = requireDoc(handleId);

  const hits: SearchHitDto[] = [];
  const needleRaw = query;
  const wholeWordRegex = wholeWord
    ? new RegExp(`\\b${escapeRegExp(needleRaw)}\\b`, matchCase ? "g" : "gi")
    : null;
  const needleLower = needleRaw.toLowerCase();

  for (let n = 1; n <= doc.numPages; n++) {
    const { pageText } = await readPageText(doc, n);

    if (wholeWordRegex) {
      wholeWordRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = wholeWordRegex.exec(pageText)) !== null) {
        hits.push(buildHit(n, m.index, m[0], pageText));
        // Sicherheits-Step für zero-length matches (sollte hier nicht eintreten):
        if (m.index === wholeWordRegex.lastIndex) wholeWordRegex.lastIndex++;
      }
    } else {
      const haystack = matchCase ? pageText : pageText.toLowerCase();
      const needle = matchCase ? needleRaw : needleLower;
      let from = 0;
      while (true) {
        const found = haystack.indexOf(needle, from);
        if (found < 0) break;
        hits.push(buildHit(n, found, pageText.substring(found, found + needle.length), pageText));
        from = found + needle.length;
      }
    }
  }

  return hits;
}

function buildHit(
  pageNumber: number,
  position: number,
  match: string,
  pageText: string
): SearchHitDto {
  const start = Math.max(0, position - SNIPPET_RADIUS);
  const end = Math.min(pageText.length, position + match.length + SNIPPET_RADIUS);
  const snippet = pageText.substring(start, end).replace(/\s+/g, " ").trim();
  // Adjust the match start within the (possibly whitespace-collapsed) snippet:
  const rawPrefix = pageText.substring(start, position);
  const collapsedPrefix = rawPrefix.replace(/\s+/g, " ").trimStart();
  return {
    pageNumber,
    position,
    match,
    snippet,
    snippetMatchStart: collapsedPrefix.length
  };
}
