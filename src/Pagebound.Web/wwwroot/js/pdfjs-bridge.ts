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

/** Reiner Text einer Seite (Wort-Spacing via buildPageText) — z. B. fürs Vorlesen. */
export async function pageText(handleId: string, pageNumber: number): Promise<string> {
  const doc = requireDoc(handleId);
  const { pageText } = await readPageText(doc, pageNumber);
  return pageText;
}

// ============================================================================
// Inline-Edit-Unterstützung: nächstliegende Textzeile an einer Klickposition
// ----------------------------------------------------------------------------
// Für das „Text bearbeiten"-Werkzeug: Klick (0..1) → die Zeile darunter/daneben
// mit ihrer Bounding-Box, dem zusammengefügten Text und der (aus der Median-
// Item-Höhe) abgeleiteten Schriftgröße. Alles als 0..1-Fractions (oben-links),
// wie RedactionRegion/Freitext. `null`, wenn kein Text nah genug am Klick liegt.
// ============================================================================
export interface TextBlockDto {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
}

export async function findTextBlockAt(
  handleId: string,
  pageNumber: number,
  xFrac: number,
  yFrac: number
): Promise<TextBlockDto | null> {
  const doc = requireDoc(handleId);
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  const raw = (content.items as unknown as PdfTextItem[]).filter(
    (it) => typeof it.str === "string" && it.str.length > 0
  );
  if (raw.length === 0) return null;

  // Top-Left-Geometrie je Item (wie extractText).
  const geo = raw.map((it) => ({
    it,
    x: it.transform[4],
    yTop: vp.height - it.transform[5] - it.height * 0.8,
    w: it.width,
    h: it.height,
  }));
  const heights = geo.map((e) => e.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  const rowTol = Math.max(2, medH * 0.6);

  // In Zeilen clustern (y-Nähe), Zeilen-Text + BBox berechnen.
  geo.sort((a, b) => a.yTop - b.yTop || a.x - b.x);
  const lines: { text: string; xMin: number; xMax: number; yMin: number; yMax: number; medH: number }[] = [];
  let bucket: typeof geo = [];
  let curY = geo[0].yTop;
  const flush = () => {
    if (!bucket.length) return;
    const sorted = bucket.slice().sort((a, b) => a.x - b.x);
    const hs = sorted.map((e) => e.h).filter((h) => h > 0).sort((a, b) => a - b);
    lines.push({
      text: joinLineItems(sorted.map((e) => e.it)),
      xMin: Math.min(...sorted.map((e) => e.x)),
      xMax: Math.max(...sorted.map((e) => e.x + e.w)),
      yMin: Math.min(...sorted.map((e) => e.yTop)),
      yMax: Math.max(...sorted.map((e) => e.yTop + e.h)),
      medH: hs.length ? hs[Math.floor(hs.length / 2)] : medH,
    });
    bucket = [];
  };
  for (const e of geo) {
    if (bucket.length && Math.abs(e.yTop - curY) > rowTol) flush();
    if (!bucket.length) curY = e.yTop;
    bucket.push(e);
  }
  flush();

  // Beste Zeile: vertikale Nähe dominiert, horizontale Nähe als Tie-Break.
  const cx = xFrac * vp.width;
  const cy = yFrac * vp.height;
  let best: (typeof lines)[number] | null = null;
  let bestScore = Infinity;
  for (const ln of lines) {
    const vDist = cy < ln.yMin ? ln.yMin - cy : cy > ln.yMax ? cy - ln.yMax : 0;
    const hDist = cx < ln.xMin ? ln.xMin - cx : cx > ln.xMax ? cx - ln.xMax : 0;
    const score = vDist * 3 + hDist;
    if (score < bestScore) {
      bestScore = score;
      best = ln;
    }
  }
  if (!best) return null;
  const vGap = cy < best.yMin ? best.yMin - cy : cy > best.yMax ? cy - best.yMax : 0;
  if (vGap > medH * 2) return null; // Klick zu weit von jeder Zeile → leerer Bereich

  return {
    text: best.text,
    x: best.xMin / vp.width,
    y: best.yMin / vp.height,
    w: (best.xMax - best.xMin) / vp.width,
    h: (best.yMax - best.yMin) / vp.height,
    fontSize: best.medH / vp.height,
  };
}

// ============================================================================
// Muster-Schwärzung: Regex im Text-Layer finden → Bounding-Boxes (0..1)
// ----------------------------------------------------------------------------
// Für das „Schwärzen nach Muster" (E-Mail/Telefon/IBAN/… oder eigene Regex).
// Findet NUR im extrahierbaren Text-Layer (kein OCR). Ein Treffer, der über
// mehrere Zeilen geht, wird in eine Box je Zeile zerlegt (kein Riesenkasten).
// ============================================================================
export interface TextMatchDto {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

interface TextSpan { start: number; end: number; x: number; y: number; w: number; h: number; }

/** Seiten-Text mit Zeichen-Offset→Item-Bounding-Box (px, oben-links). Kein
 *  Whitespace-Collapse (sonst würden die Offsets verrutschen). */
function buildPageTextWithSpans(items: PdfTextItem[], vpHeight: number): { text: string; spans: TextSpan[] } {
  let text = "";
  const spans: TextSpan[] = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const start = text.length;
    text += cur.str;
    spans.push({
      start,
      end: text.length,
      x: cur.transform[4],
      y: vpHeight - cur.transform[5] - cur.height * 0.8,
      w: cur.width,
      h: cur.height,
    });
    const next = items[i + 1];
    if (!next) { if (cur.hasEOL && !text.endsWith(" ")) text += " "; continue; }
    if (/\s$/.test(cur.str) || /^\s/.test(next.str)) continue;
    if (cur.hasEOL) { text += " "; continue; }
    if (Math.abs(cur.transform[5] - next.transform[5]) > 1) { text += " "; continue; }
    const avgGlyph = cur.width / Math.max(cur.str.length, 1);
    if (next.transform[4] - (cur.transform[4] + cur.width) > Math.max(1, avgGlyph * 0.5)) text += " ";
  }
  return { text, spans };
}

export async function findTextMatches(
  handleId: string,
  patternSource: string,
  flags: string
): Promise<TextMatchDto[]> {
  if (!patternSource) return [];
  let re: RegExp;
  try {
    const f = flags && flags.includes("g") ? flags : (flags ?? "") + "g";
    re = new RegExp(patternSource, f);
  } catch {
    return [];
  }
  const doc = requireDoc(handleId);
  const out: TextMatchDto[] = [];
  const MAX = 5000;
  for (let p = 1; p <= doc.numPages && out.length < MAX; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const vp = page.getViewport({ scale: 1 });
    const { text, spans } = buildPageTextWithSpans(content.items as unknown as PdfTextItem[], vp.height);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null && out.length < MAX) {
      if (m[0].length === 0) { re.lastIndex++; continue; } // Endlosschleife vermeiden
      const mStart = m.index;
      const mEnd = mStart + m[0].length;
      // überlappende Spans einsammeln, nach Zeile (y) clustern → Box je Zeile
      const hit = spans.filter((s) => s.end > mStart && s.start < mEnd);
      if (hit.length === 0) continue;
      // Pro Treffer-Span den vom Match überdeckten Teilbereich proportional zur
      // Zeichenzahl schätzen (getTextContent liefert nur Item-, keine Glyphen-
      // Positionen) → engere Box als das ganze Item. Näherung (uniforme
      // Zeichenbreite), aber deutlich präziser bei Zeilen-als-ein-Item.
      const sub = hit.map((s) => {
        const chars = Math.max(1, s.end - s.start);
        const a = (Math.max(mStart, s.start) - s.start) / chars;
        const b = (Math.min(mEnd, s.end) - s.start) / chars;
        return { x: s.x + s.w * a, y: s.y, w: s.w * (b - a), h: s.h };
      });
      const hs = sub.map((s) => s.h).filter((h) => h > 0).sort((a, b) => a - b);
      const medH = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
      const tol = Math.max(2, medH * 0.6);
      const byLine = [...sub].sort((a, b) => a.y - b.y);
      let bucket: { x: number; y: number; w: number; h: number }[] = [];
      let curY = byLine[0].y;
      const flush = () => {
        if (!bucket.length) return;
        const x0 = Math.min(...bucket.map((s) => s.x));
        const y0 = Math.min(...bucket.map((s) => s.y));
        const x1 = Math.max(...bucket.map((s) => s.x + s.w));
        const y1 = Math.max(...bucket.map((s) => s.y + s.h));
        out.push({ page: p, x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height, text: m![0] });
        bucket = [];
      };
      for (const s of byLine) {
        if (bucket.length && Math.abs(s.y - curY) > tol) flush();
        if (!bucket.length) curY = s.y;
        bucket.push(s);
      }
      flush();
    }
  }
  return out;
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

// Tabellen-Heuristik → Zeilen aus Zellen (string[][]). Basis für CSV und XLSX.
function pageItemsToRows(items: TblItem[]): string[][] {
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
    return cells.map((c) => c.trim());
  });
}

function pageItemsToCsv(items: TblItem[]): string[] {
  return pageItemsToRows(items).map((cells) => cells.map(csvEscapeCell).join(","));
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

// ============================================================================
// SPIKE (Bean PDF-Tool-caes) — PDF → Vektor-SVG. WEGWERF-CODE, nach dem Go/No-Go
// wieder entfernen. Übersetzt die niedrigstufigen Zeichen-Operationen EINER Seite
// (page.getOperatorList) in ein minimales Vektor-SVG: Pfade als <path>, Text als
// <text> (skalierbar/auswählbar; Glyph-Umriss-Treue ist die Folge-Frage). Nicht
// unterstützte Ops werden gezählt und übersprungen (kontrollierte Degradation,
// kein Crash). Gibt den SVG-String zurück, inkl. Coverage-Kommentar mit Op-Zählung.
// ============================================================================
type SpikeMat = [number, number, number, number, number, number];
const SPIKE_IDENT: SpikeMat = [1, 0, 0, 1, 0, 0];

function spikeToMat(a: ArrayLike<number>): SpikeMat {
  return [a[0], a[1], a[2], a[3], a[4], a[5]];
}
function spikeMul(m1: SpikeMat, m2: SpikeMat): SpikeMat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}
function spikeMatStr(m: SpikeMat): string {
  return `matrix(${m.map((n) => +n.toFixed(4)).join(" ")})`;
}
function spikeColor(c: ArrayLike<number> | null | undefined): string {
  if (!c) return "#000000";
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}
function spikeGray(g: number): string {
  const v = Math.max(0, Math.min(255, Math.round(g * 255)));
  return spikeColor([v, v, v]);
}
function spikeXmlEsc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// constructPath-Args (v6: [subOps, coords, ...]) → SVG-path-d-Fragment. Unbekannte
// Sub-Ops brechen NUR diesen Pfad ab (unklarer Koordinaten-Verbrauch), kein Crash.
function spikeDecodePath(subOps: number[], co: number[], OPS: Record<string, number>): string {
  let d = "", k = 0, cx = 0, cy = 0;
  const n = (v: number) => +v.toFixed(3);
  for (const p of subOps) {
    if (p === OPS.moveTo) { cx = co[k++]; cy = co[k++]; d += `M ${n(cx)} ${n(cy)} `; }
    else if (p === OPS.lineTo) { cx = co[k++]; cy = co[k++]; d += `L ${n(cx)} ${n(cy)} `; }
    else if (p === OPS.curveTo) { const x1 = co[k++], y1 = co[k++], x2 = co[k++], y2 = co[k++]; cx = co[k++]; cy = co[k++]; d += `C ${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(cx)} ${n(cy)} `; }
    else if (p === OPS.curveTo2) { const x2 = co[k++], y2 = co[k++], ex = co[k++], ey = co[k++]; d += `C ${n(cx)} ${n(cy)} ${n(x2)} ${n(y2)} ${n(ex)} ${n(ey)} `; cx = ex; cy = ey; }
    else if (p === OPS.curveTo3) { const x1 = co[k++], y1 = co[k++], ex = co[k++], ey = co[k++]; d += `C ${n(x1)} ${n(y1)} ${n(ex)} ${n(ey)} ${n(ex)} ${n(ey)} `; cx = ex; cy = ey; }
    else if (p === OPS.rectangle) { const x = co[k++], y = co[k++], w = co[k++], h = co[k++]; d += `M ${n(x)} ${n(y)} h ${n(w)} v ${n(h)} h ${n(-w)} Z `; cx = x; cy = y; }
    else if (p === OPS.closePath) { d += "Z "; }
    else { return d + " <!--UNKNOWN_SUBOP--> "; }
  }
  return d;
}

export async function convertToSvgSpike(data: Uint8Array, pageNumber: number, scale: number): Promise<string> {
  return withTransientDoc(data, async (doc) => {
    const OPS = (pdfjsLib as unknown as { OPS: Record<string, number> }).OPS;
    const opName: Record<number, string> = {};
    for (const key of Object.keys(OPS)) opName[OPS[key]] = key;

    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const W = Math.ceil(viewport.width), H = Math.ceil(viewport.height);
    const root = spikeToMat(viewport.transform as unknown as number[]);

    let opList: { fnArray: number[]; argsArray: unknown[] };
    try {
      opList = await page.getOperatorList() as unknown as { fnArray: number[]; argsArray: unknown[] };
    } catch {
      // Fehlerpfad: Operator-Liste nicht gewinnbar → kontrolliert leeres SVG, kein Crash,
      // keine internen Details geleakt.
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><!-- spike: operator list unavailable --></svg>`;
    }

    let ctm: SpikeMat = SPIKE_IDENT;
    const stack: SpikeMat[] = [];
    let fill = "#000000", stroke = "#000000", lineWidth = 1;
    let pathD = "";
    let textMatrix: SpikeMat = SPIKE_IDENT, lineMatrix: SpikeMat = SPIKE_IDENT, fontSize = 10;
    const body: string[] = [];
    const counts: Record<string, number> = {};
    const skipped: Record<string, number> = {};
    const note = (name: string, map: Record<string, number>) => { map[name] = (map[name] || 0) + 1; };

    const emitPath = (fillCol: string | null, strokeCol: string | null, eo: boolean) => {
      if (!pathD.trim()) { pathD = ""; return; }
      const parts = [`transform="${spikeMatStr(ctm)}"`, `d="${pathD.trim()}"`];
      parts.push(`fill="${fillCol ?? "none"}"`);
      if (fillCol && eo) parts.push(`fill-rule="evenodd"`);
      if (strokeCol) parts.push(`stroke="${strokeCol}"`, `stroke-width="${+lineWidth.toFixed(3)}"`);
      body.push(`<path ${parts.join(" ")}/>`);
      pathD = "";
    };

    const fn = opList.fnArray, argsAll = opList.argsArray as unknown[][];
    for (let i = 0; i < fn.length; i++) {
      const op = fn[i];
      const a = argsAll[i] || [];
      const name = opName[op] ?? String(op);
      note(name, counts);
      try {
        if (op === OPS.save) stack.push(ctm);
        else if (op === OPS.restore) ctm = stack.pop() ?? SPIKE_IDENT;
        else if (op === OPS.transform) ctm = spikeMul(ctm, spikeToMat(a as number[]));
        else if (op === OPS.setFillRGBColor) fill = spikeColor(a[0] as ArrayLike<number>);
        else if (op === OPS.setStrokeRGBColor) stroke = spikeColor(a[0] as ArrayLike<number>);
        else if (op === OPS.setFillGray) fill = spikeGray(a[0] as number);
        else if (op === OPS.setStrokeGray) stroke = spikeGray(a[0] as number);
        else if (op === OPS.setLineWidth) lineWidth = a[0] as number;
        else if (op === OPS.constructPath) pathD += spikeDecodePath((a[0] as number[]), (a[1] as number[]), OPS);
        else if (op === OPS.fill || op === OPS.eoFill) emitPath(fill, null, op === OPS.eoFill);
        else if (op === OPS.stroke) emitPath(null, stroke, false);
        else if (op === OPS.fillStroke || op === OPS.eoFillStroke) emitPath(fill, stroke, op === OPS.eoFillStroke);
        else if (op === OPS.endPath) pathD = "";
        else if (op === OPS.beginText) { textMatrix = SPIKE_IDENT; lineMatrix = SPIKE_IDENT; }
        else if (op === OPS.setFont) fontSize = Math.abs(a[1] as number) || 10;
        else if (op === OPS.setTextMatrix) { textMatrix = spikeToMat(a as number[]); lineMatrix = textMatrix; }
        else if (op === OPS.nextLine) { lineMatrix = spikeMul(lineMatrix, [1, 0, 0, 1, 0, -fontSize]); textMatrix = lineMatrix; }
        else if (op === OPS.moveText) { lineMatrix = spikeMul(lineMatrix, [1, 0, 0, 1, a[0] as number, a[1] as number]); textMatrix = lineMatrix; }
        else if (op === OPS.showText || op === OPS.nextLineShowText) {
          const glyphs = (op === OPS.nextLineShowText ? a[0] : a[0]) as unknown[];
          let str = "";
          if (Array.isArray(glyphs)) {
            for (const g of glyphs) {
              if (g && typeof g === "object" && "unicode" in (g as object)) str += (g as { unicode: string }).unicode;
              // Zahlen = horizontale Positionsanpassung → für den Spike ignoriert
            }
          }
          if (str.trim()) {
            const m = spikeMul(spikeMul(ctm, textMatrix), [1, 0, 0, -1, 0, 0]); // Y-Flip für aufrechte Glyphen
            body.push(`<text transform="${spikeMatStr(m)}" font-size="${+fontSize.toFixed(3)}" font-family="sans-serif" fill="${fill}">${spikeXmlEsc(str)}</text>`);
          }
        } else {
          note(name, skipped); // kontrollierte Degradation: unbekannte Op überspringen
        }
      } catch {
        note(name, skipped);
      }
    }

    const report = JSON.stringify({ page: pageNumber, size: [W, H], ops: counts, skipped });
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<!-- spike-coverage ${spikeXmlEsc(report)} -->` +
      `<rect width="100%" height="100%" fill="#ffffff"/>` +
      `<g transform="${spikeMatStr(root)}">${body.join("")}</g>` +
      `</svg>`
    );
  });
}

// ============================================================================
// PDF → DOCX (Word, OOXML) — Best-Effort Textfluss, 100 % lokal, keine Dependency
// ----------------------------------------------------------------------------
// PDF hat kein Absatz-/Struktur-Modell. Wir rekonstruieren aus getTextContent:
//   Items → Zeilen (y-Cluster) → Absätze (vertikale Lücke) — dieselbe Idee wie
//   die CSV-Heuristik, nur auf Fließtext gezielt. Weiche Zeilenumbrüche werden
//   zu fließendem Absatztext verschmolzen (Word bricht selbst um); Schriftgröße
//   je Absatz aus der Median-Item-Höhe (pt → half-points). Seitenumbruch je
//   PDF-Seite. Das .docx wird von Hand als OOXML-ZIP (fflate) gebaut — keine
//   docx-Lib, damit keine neue Laufzeit-Dependency.
// ============================================================================

const DOCX_XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Escapt Text für XML 1.0 und entfernt dort unzulässige Steuerzeichen. */
function xmlEscape(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 verbietet die meisten Steuerzeichen (außer \t \n \r) — Word würde
    // die Datei sonst als beschädigt ablehnen.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/** Fügt die (nach x sortierten) Items einer Zeile mit Wort-Spacing zusammen. */
function joinLineItems(items: PdfTextItem[]): string {
  if (items.length === 0) return "";
  let text = items[0].str;
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    const prevEndX = prev.transform[4] + prev.width;
    const gap = cur.transform[4] - prevEndX;
    const avgGlyph = prev.width / Math.max(prev.str.length, 1);
    const tol = Math.max(1, avgGlyph * 0.5);
    const needsSpace = gap > tol && !/\s$/.test(text) && !/^\s/.test(cur.str);
    text += (needsSpace ? " " : "") + cur.str;
  }
  return text.replace(/[\t ]{2,}/g, " ").trim();
}

/** Eine Seite → Absätze (Text + abgeleitete Schriftgröße in Word-half-points). */
function pageToDocxParagraphs(items: PdfTextItem[], viewportHeight: number): { text: string; sizeHalfPt: number }[] {
  const valid = items.filter((it) => typeof it.str === "string" && it.str.length > 0);
  if (valid.length === 0) return [];

  // Top-Left-y (oben klein) wie in extractText, damit Sortierung oben→unten stimmt.
  const withY = valid.map((it) => ({ it, y: viewportHeight - it.transform[5] - it.height * 0.8 }));
  const heights = valid.map((i) => i.height).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  const rowTol = Math.max(2, medH * 0.6); // selbe Zeile
  const paraGap = Math.max(medH * 1.8, rowTol * 2); // Absatzgrenze: deutlich größer als Zeilenabstand

  // 1) Zeilen über y clustern
  withY.sort((a, b) => a.y - b.y || a.it.transform[4] - b.it.transform[4]);
  const lines: { text: string; y: number; h: number }[] = [];
  let bucket: typeof withY = [];
  let curY = withY[0].y;
  const flush = () => {
    if (!bucket.length) return;
    const sorted = bucket.slice().sort((a, b) => a.it.transform[4] - b.it.transform[4]);
    const lh = sorted.map((e) => e.it.height).filter((h) => h > 0).sort((a, b) => a - b);
    const lineMedH = lh.length ? lh[Math.floor(lh.length / 2)] : medH;
    const yMin = Math.min(...bucket.map((e) => e.y));
    lines.push({ text: joinLineItems(sorted.map((e) => e.it)), y: yMin, h: lineMedH });
    bucket = [];
  };
  for (const e of withY) {
    if (bucket.length && Math.abs(e.y - curY) > rowTol) flush();
    if (!bucket.length) curY = e.y;
    bucket.push(e);
  }
  flush();

  // 2) Zeilen zu Absätzen gruppieren (vertikale Lücke > paraGap ⇒ neuer Absatz)
  const paras: { text: string; sizeHalfPt: number }[] = [];
  let paraLines: { text: string; h: number }[] = [];
  let prevY: number | null = null;
  const pushPara = () => {
    const text = paraLines.map((l) => l.text).join(" ").replace(/[\t ]{2,}/g, " ").trim();
    if (!text) { paraLines = []; return; }
    const hs = paraLines.map((l) => l.h).filter((h) => h > 0).sort((a, b) => a - b);
    const ptH = hs.length ? hs[Math.floor(hs.length / 2)] : medH;
    // PDF.js-Item-Höhe ≈ Schriftgröße in pt; half-points = pt*2, sinnvoll geklemmt.
    const sizeHalfPt = Math.min(96, Math.max(12, Math.round(ptH * 2)));
    paras.push({ text, sizeHalfPt });
    paraLines = [];
  };
  for (const ln of lines) {
    if (!ln.text) continue;
    if (prevY !== null && ln.y - prevY > paraGap) pushPara();
    paraLines.push({ text: ln.text, h: ln.h });
    prevY = ln.y;
  }
  pushPara();
  return paras;
}

/**
 * PDF → DOCX: reiner Textfluss (keine 1:1-Layout-Treue), Absätze + Seitenumbrüche.
 * Für Pixel-Treue stattdessen HTML/PNG-Export nutzen. 100 % lokal, offline.
 */
export async function convertToDocx(data: Uint8Array): Promise<Uint8Array> {
  return withTransientDoc(data, async (doc) => {
    const enc = new TextEncoder();
    const bodyParts: string[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items as unknown as PdfTextItem[];
      const viewportHeight = page.getViewport({ scale: 1 }).height;
      const paras = pageToDocxParagraphs(items, viewportHeight);

      if (p > 1) {
        // Seitenumbruch zwischen den PDF-Seiten.
        bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      }
      if (paras.length === 0) {
        bodyParts.push("<w:p/>");
        continue;
      }
      for (const par of paras) {
        bodyParts.push(
          '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>' +
          `<w:r><w:rPr><w:sz w:val="${par.sizeHalfPt}"/><w:szCs w:val="${par.sizeHalfPt}"/></w:rPr>` +
          `<w:t xml:space="preserve">${xmlEscape(par.text)}</w:t></w:r></w:p>`
        );
      }
    }
    if (bodyParts.length === 0) bodyParts.push("<w:p/>");

    const documentXml =
      DOCX_XML_DECL +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      bodyParts.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
      "</w:sectPr></w:body></w:document>";

    const contentTypesXml =
      DOCX_XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>";

    const rootRels =
      DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";

    const docRels =
      DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";

    const stylesXml =
      DOCX_XML_DECL +
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
    return zipSync(files, { level: 6 });
  });
}

// ============================================================================
// PDF → XLSX (Excel, SpreadsheetML) — aus der Tabellen-Heuristik, je Seite ein
// Blatt. Von Hand als OOXML-ZIP (fflate), keine Dependency. Best-Effort (keine
// echte Tabellenerkennung, gleiche Grenzen wie der CSV-Export).
// ============================================================================
function xlsxColRef(i: number): string {
  // 0 → A, 25 → Z, 26 → AA
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function xlsxSheetXml(rows: string[][]): string {
  const numRe = /^-?\d+([.,]\d+)?$/; // schlichte Zahl (keine Tausendertrenner) → Number
  const rowXml = rows.map((cells, r) => {
    const rowNum = r + 1;
    const cs = cells.map((cell, c) => {
      const ref = xlsxColRef(c) + rowNum;
      const v = (cell ?? "").trim();
      if (v !== "" && numRe.test(v)) {
        return `<c r="${ref}"><v>${Number(v.replace(",", "."))}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNum}">${cs}</row>`;
  }).join("");
  return DOCX_XML_DECL +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowXml}</sheetData></worksheet>`;
}

export async function convertToXlsx(data: Uint8Array): Promise<Uint8Array> {
  return withTransientDoc(data, async (doc) => {
    const enc = new TextEncoder();
    const files: Record<string, Uint8Array> = {};
    const sheets: { file: string; rid: string; idx: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const items: TblItem[] = (content.items as unknown as PdfTextItem[])
        .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
        .map((it) => ({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width || 0, h: it.height || 0 }));
      const rows = pageItemsToRows(items);
      const file = `sheet${p}`;
      files[`xl/worksheets/${file}.xml`] = enc.encode(xlsxSheetXml(rows.length ? rows : [[""]]));
      sheets.push({ file, rid: `rId${p}`, idx: p });
    }
    if (sheets.length === 0) {
      files["xl/worksheets/sheet1.xml"] = enc.encode(xlsxSheetXml([[""]]));
      sheets.push({ file: "sheet1", rid: "rId1", idx: 1 });
    }

    files["[Content_Types].xml"] = enc.encode(DOCX_XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((s) => `<Override PartName="/xl/worksheets/${s.file}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      "</Types>");
    files["_rels/.rels"] = enc.encode(DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>");
    files["xl/workbook.xml"] = enc.encode(DOCX_XML_DECL +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s) => `<sheet name="Seite ${s.idx}" sheetId="${s.idx}" r:id="${s.rid}"/>`).join("") +
      "</sheets></workbook>");
    files["xl/_rels/workbook.xml.rels"] = enc.encode(DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s) => `<Relationship Id="${s.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${s.file}.xml"/>`).join("") +
      "</Relationships>");
    return zipSync(files, { level: 6 });
  });
}

// ============================================================================
// PDF → PPTX (PowerPoint, PresentationML) — je Seite eine Folie mit dem
// gerenderten Seitenbild (vollflächig). Von Hand als OOXML-ZIP (fflate), keine
// Dependency. Reine Bild-Folien (kein Text-Layer).
// ============================================================================
const PPTX_THEME = DOCX_XML_DECL +
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Pagebound"><a:themeElements>' +
  '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Office">' +
  '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
  '</a:fmtScheme></a:themeElements></a:theme>';

const PPTX_EMPTY_TREE =
  '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

const PPTX_MASTER = DOCX_XML_DECL +
  '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
  `<p:cSld>${PPTX_EMPTY_TREE}</p:cSld>` +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';

const PPTX_LAYOUT = DOCX_XML_DECL +
  '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">' +
  `<p:cSld name="Leer">${PPTX_EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function pptxSlideXml(cx: number, cy: number): string {
  return DOCX_XML_DECL +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Seite"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

export async function convertToPptx(data: Uint8Array, scale: number): Promise<Uint8Array> {
  return withTransientDoc(data, async (doc) => {
    const enc = new TextEncoder();
    const files: Record<string, Uint8Array> = {};
    const relIdRe = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const total = doc.numPages;

    // Foliengröße (EMU) aus Seite 1 ableiten; Breite = 10" (9144000 EMU).
    const p1 = await doc.getPage(1);
    const vp1 = p1.getViewport({ scale: 1 });
    const cx = 9144000;
    const cy = Math.round(cx * (vp1.height / vp1.width));

    const slideMeta: { n: number; rid: string; sldId: number }[] = [];
    for (let p = 1; p <= total; p++) {
      const canvas = await renderPageToCanvas(doc, p, scale);
      files[`ppt/media/image${p}.png`] = dataUrlToBytes(canvas.toDataURL("image/png"));
      files[`ppt/slides/slide${p}.xml`] = enc.encode(pptxSlideXml(cx, cy));
      files[`ppt/slides/_rels/slide${p}.xml.rels`] = enc.encode(DOCX_XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${relIdRe}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        `<Relationship Id="rId2" Type="${relIdRe}/image" Target="../media/image${p}.png"/>` +
        "</Relationships>");
      slideMeta.push({ n: p, rid: `rId${p + 1}`, sldId: 255 + p });
    }

    files["ppt/theme/theme1.xml"] = enc.encode(PPTX_THEME);
    files["ppt/slideMasters/slideMaster1.xml"] = enc.encode(PPTX_MASTER);
    files["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = enc.encode(DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${relIdRe}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
      `<Relationship Id="rId2" Type="${relIdRe}/theme" Target="../theme/theme1.xml"/>` +
      "</Relationships>");
    files["ppt/slideLayouts/slideLayout1.xml"] = enc.encode(PPTX_LAYOUT);
    files["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = enc.encode(DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${relIdRe}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
      "</Relationships>");

    files["ppt/presentation.xml"] = enc.encode(DOCX_XML_DECL +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + slideMeta.map((s) => `<p:sldId id="${s.sldId}" r:id="${s.rid}"/>`).join("") + "</p:sldIdLst>" +
      `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    files["ppt/_rels/presentation.xml.rels"] = enc.encode(DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${relIdRe}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
      slideMeta.map((s) => `<Relationship Id="${s.rid}" Type="${relIdRe}/slide" Target="slides/slide${s.n}.xml"/>`).join("") +
      "</Relationships>");

    files["_rels/.rels"] = enc.encode(DOCX_XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${relIdRe}/officeDocument" Target="ppt/presentation.xml"/>` +
      "</Relationships>");
    files["[Content_Types].xml"] = enc.encode(DOCX_XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      slideMeta.map((s) => `<Override PartName="/ppt/slides/slide${s.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") +
      "</Types>");
    return zipSync(files, { level: 6 });
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
