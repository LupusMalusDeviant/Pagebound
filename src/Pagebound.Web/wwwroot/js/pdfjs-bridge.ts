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
import type {
  PDFDocumentProxy,
  PDFPageProxy
} from "pdfjs-dist/types/src/display/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/js/pdf.worker.min.mjs";

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
    isEvalSupported: false,
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
    await doc.destroy();
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
