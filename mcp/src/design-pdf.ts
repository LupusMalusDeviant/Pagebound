// =============================================================================
// Design (*.pbdesign.json) → PDF, serverseitig und OHNE Browser.
//
// WARUM EIGEN STATT HEADLESS-CHROMIUM (ADR-0012): der Aufrufer erzeugt Dokumente im
// Hintergrund, in einem Container, und hängt sie in eine Hash-Kette. Ein
// Chromium im Abbild kostet ~400 MB, dauernde Aktualisierungslast, und
// byte-gleiche Ausgabe müsste man ihm abringen. Dieser Renderer zeichnet mit
// pdf-lib direkt und ist von sich aus reproduzierbar (siehe NO_METADATA_BUMP).
//
// EHRLICHER SCOPE: das Layout ist dem Druck-CSS von design_render_html
// NACHGEBAUT, nicht davon abgeleitet — es ist eine zweite Umsetzung derselben
// Regeln. Gleiche Seitenmaße, gleiche Schriftgrößen, gleiche Abstände, gleicher
// Blockfluss. Was NICHT ankommt, meldet der Renderer als Warnung, statt es
// stillschweigend zu verschlucken:
//   • Schriften: die Theme-Familien (Georgia/Newsreader/Hanken/JetBrains Mono)
//     liegen nicht als Datei vor; gezeichnet wird mit den eingebetteten
//     Liberation-Schriften (metrisch kompatibel zu Times/Arial/Courier).
//   • Inline-HTML: unterstützt sind b/strong, i/em, u, br, p/div, ul/ol/li,
//     span/font mit Farbe sowie text-align im style. Alles andere wird zu
//     Klartext (mit Warnung, welches Tag).
//   • Abgerundete Bildecken und Schatten (CSS-Effekte ohne PDF-Entsprechung).
//   • Bilder nur als data:-URL in PNG oder JPEG (kein SVG/WebP).
// Anders als der Browser bricht dieser Renderer Blöcke, die nicht mehr auf die
// Seite passen, auf eine Folgeseite um — Tabellen mit wiederholter Kopfzeile.
// =============================================================================
import { PDFDocument, PDFFont, PDFHexString, PDFImage, PDFPage, degrees, rgb } from "pdf-lib";
import type { RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import {
  EditorBlock,
  EditorDocument,
  EditorOverlay,
  EditorPage,
  EditorTheme,
  layoutOf,
  mixWithWhite,
} from "./design.js";
import { layoutMindmap } from "./mind.js";
import { NO_METADATA_BUMP, ToolError, deterministicFileId } from "./pdf.js";

// --- Einheiten ---------------------------------------------------------------
// Das Designmodell mischt Millimeter (Seitenmaße) und CSS-Pixel (Höhen,
// Abstände, Rahmen). Im PDF ist alles Punkt: 1 px = 1/96", 1 pt = 1/72".
const MM = 72 / 25.4;
const PX = 0.75;

// Werte aus baseCss() in design.ts — hier gespiegelt, damit beide Ausgaben
// gleich aussehen. Ändert sich dort etwas, muss es hier mitgeführt werden.
const BODY_PT = 11;
const H_PT: Record<number, number> = { 1: 22, 2: 16, 3: 13 };
const TABLE_PT = 10.5;
const LINE_HEIGHT = 1.5;
const BLOCK_GAP = 8 * PX; // .pb-block margin-bottom: 8px
const TABLE_PAD_X = 8 * PX;
const TABLE_PAD_Y = 4 * PX;
const TABLE_BORDER = 1 * PX;
const TABLE_BORDER_COLOR = "#9ca3af";
const DIVIDER_GAP = 6 * PX;
const ASCENT_RATIO = 0.72; // Näherung der Oberlänge für die Grundlinie

export interface DesignPdfResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

// --- Farben ------------------------------------------------------------------
function parseHex(hex: string | null | undefined, fallback: RGB): RGB {
  if (typeof hex !== "string") return fallback;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

// --- Schriften ---------------------------------------------------------------
// Theme-Schlüssel → Liberation-Familie. Die echten Familien liegen nicht als
// Datei vor; Liberation ist metrisch kompatibel zu Times/Arial/Courier und
// bereits im Paket (SIL OFL 1.1, siehe fonts/LICENSE-OFL.txt).
type Family = "serif" | "sans" | "mono";

const FAMILY_FOR_THEME: Record<string, Family> = {
  georgia: "serif",
  newsreader: "serif",
  hanken: "sans",
  mono: "mono",
};
const FAMILY_FILES: Record<Family, Record<string, string>> = {
  serif: {
    regular: "LiberationSerif-Regular.ttf", bold: "LiberationSerif-Bold.ttf",
    italic: "LiberationSerif-Italic.ttf", boldItalic: "LiberationSerif-BoldItalic.ttf",
  },
  sans: {
    regular: "LiberationSans-Regular.ttf", bold: "LiberationSans-Bold.ttf",
    italic: "LiberationSans-Italic.ttf", boldItalic: "LiberationSans-BoldItalic.ttf",
  },
  mono: {
    regular: "LiberationMono-Regular.ttf", bold: "LiberationMono-Bold.ttf",
    italic: "LiberationMono-Italic.ttf", boldItalic: "LiberationMono-BoldItalic.ttf",
  },
};
const FAMILY_LABEL: Record<Family, string> = {
  serif: "Liberation Serif", sans: "Liberation Sans", mono: "Liberation Mono",
};

interface Style { bold?: boolean; italic?: boolean }

/** Bettet Schnitte erst ein, wenn sie wirklich gebraucht werden (kleine PDFs). */
class FontBox {
  private readonly cache = new Map<string, PDFFont>();
  private readonly drawable = new Map<PDFFont, Map<string, boolean>>();
  constructor(private readonly doc: PDFDocument) {}

  async get(family: Family, style: Style): Promise<PDFFont> {
    const cut = style.bold && style.italic ? "boldItalic" : style.bold ? "bold" : style.italic ? "italic" : "regular";
    const key = `${family}/${cut}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const file = FAMILY_FILES[family][cut];
    let ttf: Uint8Array;
    try {
      ttf = new Uint8Array(await readFile(new URL(`../fonts/${file}`, import.meta.url)));
    } catch (e) {
      throw new ToolError(
        `Schrift ${file} nicht gefunden — Installation unvollständig? (${e instanceof Error ? e.message : String(e)})`,
        "INTERNAL",
      );
    }
    // subset:true ist deterministisch (geprüft) und spart ~97 % Dateigröße.
    const font = await this.doc.embedFont(ttf, { subset: true });
    this.cache.set(key, font);
    return font;
  }

  /** Ersetzt Zeichen, die der Schnitt nicht kennt — sonst wirft drawText. */
  sanitize(font: PDFFont, text: string): { text: string; dropped: string[] } {
    let known = this.drawable.get(font);
    if (!known) { known = new Map(); this.drawable.set(font, known); }
    const dropped: string[] = [];
    let out = "";
    for (const ch of text) {
      let ok = known.get(ch);
      if (ok === undefined) {
        try { font.widthOfTextAtSize(ch, 12); ok = true; } catch { ok = false; }
        known.set(ch, ok);
      }
      if (ok) out += ch;
      else { out += "?"; dropped.push(ch); }
    }
    return { text: out, dropped };
  }
}

// --- Inline-HTML -------------------------------------------------------------
export interface TextRun { text: string; bold: boolean; italic: boolean; underline: boolean; color?: string }
export interface InlineBlock { runs: TextRun[]; align?: string; marker?: string }

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", euro: "€", szlig: "ß",
};
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g: string) => {
    if (g.startsWith("#x") || g.startsWith("#X")) return String.fromCodePoint(parseInt(g.slice(2), 16));
    if (g.startsWith("#")) return String.fromCodePoint(parseInt(g.slice(1), 10));
    return ENTITIES[g.toLowerCase()] ?? m;
  });
}

const BLOCK_TAGS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "blockquote"]);
const KNOWN_TAGS = new Set([
  "b", "strong", "i", "em", "u", "span", "font", "a", "br", "ul", "ol",
  "sub", "sup", "small", "mark", "s", "strike", "table", "tbody", "thead", "td", "th",
]);

/**
 * Zerlegt das vom Editor erzeugte HTML (document.execCommand: b/i/u, Listen,
 * text-align, Farben) in Absätze mit formatierten Läufen. Unbekannte Tags
 * werden zu Klartext — gemeldet, nicht verschluckt.
 */
export function parseInlineHtml(html: string, warn: (w: string) => void): InlineBlock[] {
  const blocks: InlineBlock[] = [];
  const stack: Array<{ tag: string; bold: boolean; italic: boolean; underline: boolean; color?: string; align?: string }> = [];
  const orderedIndex: number[] = [];
  let current: InlineBlock = { runs: [] };

  const top = () => stack[stack.length - 1];
  const flush = (): void => {
    if (current.runs.some((r) => r.text.trim().length > 0) || current.marker) blocks.push(current);
    current = { runs: [], align: top()?.align };
  };
  const push = (text: string): void => {
    if (!text) return;
    const t = top();
    current.runs.push({ text, bold: !!t?.bold, italic: !!t?.italic, underline: !!t?.underline, color: t?.color });
    if (t?.align && !current.align) current.align = t.align;
  };

  const seenUnknown = new Set<string>();
  const re = /<\/?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[0], tagRaw = m[1], attrs = m[2] ?? "", text = m[3];
    if (text !== undefined) { push(decodeEntities(text).replace(/\s+/g, " ")); continue; }
    const tag = tagRaw.toLowerCase();
    const closing = raw.startsWith("</");

    if (!KNOWN_TAGS.has(tag) && !BLOCK_TAGS.has(tag) && !seenUnknown.has(tag)) {
      seenUnknown.add(tag);
      warn(`Inline-HTML: <${tag}> wird im PDF nicht dargestellt — der Textinhalt bleibt erhalten.`);
    }

    if (tag === "br") { flush(); continue; }
    if (tag === "ul" || tag === "ol") {
      flush();
      if (closing) orderedIndex.pop();
      else orderedIndex.push(tag === "ol" ? 0 : -1);
      continue;
    }

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.splice(i, 1); break; }
      }
      if (BLOCK_TAGS.has(tag)) flush();
      continue;
    }

    if (BLOCK_TAGS.has(tag)) {
      flush();
      if (tag === "li" && orderedIndex.length > 0) {
        const idx = orderedIndex[orderedIndex.length - 1];
        if (idx >= 0) { orderedIndex[orderedIndex.length - 1] = idx + 1; current.marker = `${idx + 1}.`; }
        else current.marker = "•";
      }
    }

    // Stil aus Attributen: style="…" und color="…" (execCommand nutzt beides).
    const styleAttr = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const style = (styleAttr?.[2] ?? styleAttr?.[3] ?? "").toLowerCase();
    const colorAttr = /color\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const colorFromStyle = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(style)?.[1]?.trim();
    const alignFromStyle = /text-align\s*:\s*(left|right|center|justify)/.exec(style)?.[1];
    const parent = top();
    stack.push({
      tag,
      bold: !!parent?.bold || tag === "b" || tag === "strong" || /font-weight\s*:\s*(bold|[6-9]00)/.test(style),
      italic: !!parent?.italic || tag === "i" || tag === "em" || /font-style\s*:\s*italic/.test(style),
      underline: !!parent?.underline || tag === "u" || /text-decoration[^;]*underline/.test(style),
      color: colorFromStyle ?? colorAttr?.[2] ?? colorAttr?.[3] ?? parent?.color,
      align: alignFromStyle ?? parent?.align,
    });
    if (BLOCK_TAGS.has(tag) && alignFromStyle) current.align = alignFromStyle;
  }
  flush();
  return blocks.length ? blocks : [{ runs: [] }];
}

// --- Zeilenumbruch -----------------------------------------------------------
interface Part { text: string; font: PDFFont; size: number; color: RGB; underline: boolean; width: number; space: boolean }
interface Line { parts: Part[]; width: number; align: string; indent: number; marker?: Part[]; last: boolean }

const baselineOffset = (size: number): number => ((LINE_HEIGHT * size) - size) / 2 + size * ASCENT_RATIO;
const lineHeightOf = (size: number): number => LINE_HEIGHT * size;

interface TextStyle { family: Family; size: number; color: RGB; align: string }

/** Bricht formatierte Läufe auf die verfügbare Breite um (gierig, wie der Browser). */
async function layoutText(
  ctx: Ctx,
  html: string,
  style: TextStyle,
  maxWidth: number,
): Promise<Line[]> {
  const blocks = parseInlineHtml(html ?? "", ctx.warn);
  const lines: Line[] = [];
  for (const block of blocks) {
    const align = block.align ?? style.align;
    const indent = block.marker ? 18 * PX : 0;
    const width = Math.max(1, maxWidth - indent);
    let marker: Part[] | undefined;
    if (block.marker) {
      const font = await ctx.fonts.get(style.family, {});
      marker = [await mkPart(ctx, block.marker, font, style.size, style.color, false)];
    }

    const parts: Part[] = [];
    for (const run of block.runs) {
      const font = await ctx.fonts.get(style.family, { bold: run.bold, italic: run.italic });
      const color = run.color ? parseHex(cssColorToHex(run.color), style.color) : style.color;
      for (const token of run.text.match(/\s+|[^\s]+/g) ?? []) {
        parts.push(await mkPart(ctx, token, font, style.size, color, run.underline));
      }
    }

    let cur: Part[] = [];
    let curWidth = 0;
    const flushLine = (last: boolean): void => {
      while (cur.length && cur[cur.length - 1].space) { curWidth -= cur[cur.length - 1].width; cur.pop(); }
      lines.push({ parts: cur, width: curWidth, align, indent, marker: lines.length === 0 || !cur.length ? marker : undefined, last });
      cur = [];
      curWidth = 0;
    };
    for (const part of parts) {
      if (part.space && cur.length === 0) continue; // führende Leerzeichen nach Umbruch
      if (curWidth + part.width > width && cur.length > 0) flushLine(false);
      if (part.space && cur.length === 0) continue;
      cur.push(part);
      curWidth += part.width;
    }
    flushLine(true);
    if (lines.length && marker && !lines.some((l) => l.marker)) lines[0].marker = marker;
  }
  return lines;
}

async function mkPart(ctx: Ctx, text: string, font: PDFFont, size: number, color: RGB, underline: boolean): Promise<Part> {
  const clean = ctx.fonts.sanitize(font, text);
  if (clean.dropped.length) ctx.warnOnce(`Zeichen ohne Entsprechung in der Ersatzschrift wurden durch '?' ersetzt (z. B. ${clean.dropped[0]}).`);
  return {
    text: clean.text, font, size, color, underline,
    width: font.widthOfTextAtSize(clean.text, size),
    space: /^\s+$/.test(text),
  };
}

/** CSS-Farbe → Hex. Der Editor liefert Hex oder rgb(); alles andere fällt zurück. */
function cssColorToHex(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3,6}$/.test(v)) return v;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (!m) return null;
  return "#" + [1, 2, 3].map((i) => Math.min(255, Number(m[i])).toString(16).padStart(2, "0")).join("");
}

interface DrawOpts { opacity?: number; rotateDeg?: number; center?: { x: number; y: number } }

/** Zeichnet eine umgebrochene Zeile. top = Oberkante der Zeilenbox. */
function drawLine(page: PDFPage, line: Line, left: number, top: number, maxWidth: number, size: number, o: DrawOpts = {}): void {
  const baseY = top - baselineOffset(size);
  const boxLeft = left + line.indent;
  const boxWidth = maxWidth - line.indent;
  let x = boxLeft;
  let extraPerSpace = 0;
  if (line.align === "center") x = boxLeft + (boxWidth - line.width) / 2;
  else if (line.align === "right") x = boxLeft + (boxWidth - line.width);
  else if (line.align === "justify" && !line.last) {
    const spaces = line.parts.filter((p) => p.space).length;
    if (spaces > 0) extraPerSpace = (boxWidth - line.width) / spaces;
  }

  if (line.marker) {
    for (const mp of line.marker) drawPart(page, mp, left, baseY, o);
  }
  for (const part of line.parts) {
    drawPart(page, part, x, baseY, o);
    x += part.width + (part.space ? extraPerSpace : 0);
  }
}

function drawPart(page: PDFPage, part: Part, x: number, baseY: number, o: DrawOpts): void {
  if (!part.text || part.space) return;
  const pos = placed(x, baseY, o);
  page.drawText(part.text, {
    x: pos.x, y: pos.y, size: part.size, font: part.font, color: part.color,
    opacity: o.opacity, rotate: degrees(pos.deg),
  });
  if (part.underline) {
    const u = placed(x, baseY - part.size * 0.12, o);
    page.drawRectangle({
      x: u.x, y: u.y, width: part.width, height: Math.max(0.4, part.size * 0.055),
      color: part.color, opacity: o.opacity, rotate: degrees(u.deg),
    });
  }
}

/**
 * CSS dreht um den Mittelpunkt des Kastens, pdf-lib um den Zeichen-Ursprung.
 * Deshalb wird der Ursprung um denselben Winkel um den Mittelpunkt gedreht.
 * CSS zählt im Uhrzeigersinn, PDF gegen den Uhrzeigersinn — daher das Minus.
 */
function placed(x: number, y: number, o: DrawOpts): { x: number; y: number; deg: number } {
  if (!o.rotateDeg || !o.center) return { x, y, deg: 0 };
  const rad = (-o.rotateDeg * Math.PI) / 180;
  const dx = x - o.center.x, dy = y - o.center.y;
  return {
    x: o.center.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: o.center.y + dx * Math.sin(rad) + dy * Math.cos(rad),
    deg: -o.rotateDeg,
  };
}

// --- Bilder ------------------------------------------------------------------
interface Decoded { mime: string; bytes: Uint8Array }

function decodeDataUrl(src: string | null | undefined): Decoded | null {
  if (typeof src !== "string") return null;
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src.trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const bytes = m[2]
    ? new Uint8Array(Buffer.from(m[3], "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(m[3]), "utf8"));
  return { mime, bytes };
}

async function embedImage(ctx: Ctx, src: string | null | undefined, what: string): Promise<PDFImage | null> {
  const data = decodeDataUrl(src);
  if (!data) {
    ctx.warn(`${what}: nur data:-URLs werden unterstützt — Bild übersprungen.`);
    return null;
  }
  const isPng = data.bytes[0] === 0x89 && data.bytes[1] === 0x50;
  const isJpg = data.bytes[0] === 0xff && data.bytes[1] === 0xd8;
  if (!isPng && !isJpg) {
    ctx.warn(`${what}: '${data.mime}' kann nicht ins PDF eingebettet werden (nur PNG und JPEG) — Bild übersprungen.`);
    return null;
  }
  try {
    return isPng ? await ctx.doc.embedPng(data.bytes) : await ctx.doc.embedJpg(data.bytes);
  } catch (e) {
    ctx.warn(`${what}: Bild ließ sich nicht einbetten (${e instanceof Error ? e.message : String(e)}) — übersprungen.`);
    return null;
  }
}

// --- Seiten-Kontext ----------------------------------------------------------
interface Ctx {
  doc: PDFDocument;
  fonts: FontBox;
  warn: (w: string) => void;
  warnOnce: (w: string) => void;
  theme: EditorTheme | null | undefined;
  pageW: number;
  pageH: number;
  margin: number;
  contentW: number;
  page: PDFPage;
  y: number;
  source: EditorPage;
  headingFamily: Family;
  bodyFamily: Family;
  colHeading: RGB;
  colBody: RGB;
  colAccent: RGB;
  colAccentSoft: RGB;
  pageCount: number;
}

function contentTop(ctx: Ctx): number { return ctx.pageH - ctx.margin; }
function contentBottom(ctx: Ctx): number { return ctx.margin; }

async function startPage(ctx: Ctx): Promise<void> {
  ctx.page = ctx.doc.addPage([ctx.pageW, ctx.pageH]);
  ctx.pageCount++;
  ctx.y = contentTop(ctx);
  await paintPageBackground(ctx);
}

async function paintPageBackground(ctx: Ctx): Promise<void> {
  const bg = ctx.source.background ?? ctx.theme?.pageBackground;
  if (bg) {
    ctx.page.drawRectangle({ x: 0, y: 0, width: ctx.pageW, height: ctx.pageH, color: parseHex(bg, rgb(1, 1, 1)) });
  }
  if (!ctx.source.backgroundImage) return;
  const img = await embedImage(ctx, ctx.source.backgroundImage, "Seitenhintergrund");
  if (!img) return;
  const opacity = Math.min(100, Math.max(0, ctx.source.backgroundOpacityPercent ?? 100)) / 100;

  if (ctx.source.backgroundRepeat) {
    // background-repeat: repeat, background-size: auto → in Originalgröße kacheln.
    const cols = Math.min(60, Math.ceil(ctx.pageW / img.width));
    const rows = Math.min(60, Math.ceil(ctx.pageH / img.height));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.page.drawImage(img, {
          x: c * img.width, y: ctx.pageH - (r + 1) * img.height,
          width: img.width, height: img.height, opacity,
        });
      }
    }
    return;
  }

  const scale = ctx.source.backgroundSize === "contain"
    ? Math.min(ctx.pageW / img.width, ctx.pageH / img.height)
    : Math.max(ctx.pageW / img.width, ctx.pageH / img.height);
  const w = img.width * scale, h = img.height * scale;
  const x = (ctx.pageW - w) / 2;
  const pos = ctx.source.backgroundPosition;
  const y = pos === "top" ? ctx.pageH - h : pos === "bottom" ? 0 : (ctx.pageH - h) / 2;
  ctx.page.drawImage(img, { x, y, width: w, height: h, opacity });
}

/** Sorgt dafür, dass mindestens `need` Punkte Platz sind — sonst neue Seite. */
async function ensure(ctx: Ctx, need: number): Promise<void> {
  if (ctx.y - need >= contentBottom(ctx)) return;
  if (ctx.y >= contentTop(ctx) - 0.01) return; // leere Seite: nichts passt, trotzdem zeichnen
  await startPage(ctx);
}

// --- Blöcke ------------------------------------------------------------------
async function renderTextFlow(ctx: Ctx, html: string, style: TextStyle, background?: string | null): Promise<void> {
  const lines = await layoutText(ctx, html, style, ctx.contentW);
  const lh = lineHeightOf(style.size);
  let i = 0;
  while (i < lines.length) {
    await ensure(ctx, lh);
    const available = Math.max(1, Math.floor((ctx.y - contentBottom(ctx)) / lh));
    const take = Math.min(available, lines.length - i);
    const segH = take * lh;
    if (background) {
      ctx.page.drawRectangle({
        x: ctx.margin, y: ctx.y - segH, width: ctx.contentW, height: segH,
        color: parseHex(background, rgb(1, 1, 1)),
      });
    }
    for (let k = 0; k < take; k++) {
      drawLine(ctx.page, lines[i + k], ctx.margin, ctx.y - k * lh, ctx.contentW, style.size);
    }
    ctx.y -= segH;
    i += take;
  }
}

async function renderTable(ctx: Ctx, block: EditorBlock): Promise<void> {
  const rows = (block.rows ?? []).filter((r) => Array.isArray(r));
  if (rows.length === 0) return;
  const size = block.fontSizePt ?? TABLE_PT;
  const colCount = rows.reduce((n, r) => Math.max(n, r.length), 0);
  if (colCount === 0) return;
  const hasHeader = block.headerRow !== false;

  // Spaltenbreiten nach Inhalt gewichten (der Browser macht es ähnlich), aber
  // deterministisch: natürliche Breite messen, dann proportional einpassen.
  const regular = await ctx.fonts.get(ctx.bodyFamily, {});
  const natural = new Array<number>(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      const text = stripTags(row[c] ?? "");
      natural[c] = Math.max(natural[c], regular.widthOfTextAtSize(text.slice(0, 120), size) + 2 * TABLE_PAD_X);
    }
  }
  const totalNatural = natural.reduce((a, b) => a + b, 0) || 1;
  const minWidth = 8 * size;
  const widths = natural.map((w) => Math.max(minWidth, (w / totalNatural) * ctx.contentW));
  const sum = widths.reduce((a, b) => a + b, 0);
  for (let c = 0; c < colCount; c++) widths[c] = (widths[c] / sum) * ctx.contentW;

  // Zeilen vorab umbrechen, damit Höhen und Seitenumbruch feststehen.
  const laidOut: Array<{ cells: Line[][]; height: number; header: boolean }> = [];
  for (let r = 0; r < rows.length; r++) {
    const header = hasHeader && r === 0;
    const cells: Line[][] = [];
    let maxLines = 1;
    for (let c = 0; c < colCount; c++) {
      const html = rows[r][c] ?? "";
      const style: TextStyle = {
        family: ctx.bodyFamily, size,
        color: header ? rgb(0.07, 0.09, 0.15) : ctx.colBody,
        align: "left",
      };
      const cellLines = await layoutText(
        ctx,
        header ? `<b>${html}</b>` : html,
        style,
        Math.max(1, widths[c] - 2 * TABLE_PAD_X),
      );
      cells.push(cellLines);
      maxLines = Math.max(maxLines, cellLines.length);
    }
    laidOut.push({ cells, height: maxLines * lineHeightOf(size) + 2 * TABLE_PAD_Y, header });
  }

  const headerRow = hasHeader ? laidOut[0] : undefined;
  const drawRow = (row: { cells: Line[][]; height: number; header: boolean }): void => {
    let x = ctx.margin;
    for (let c = 0; c < colCount; c++) {
      if (row.header) {
        ctx.page.drawRectangle({ x, y: ctx.y - row.height, width: widths[c], height: row.height, color: ctx.colAccentSoft });
      }
      ctx.page.drawRectangle({
        x, y: ctx.y - row.height, width: widths[c], height: row.height,
        borderColor: parseHex(TABLE_BORDER_COLOR, rgb(0.6, 0.6, 0.6)), borderWidth: TABLE_BORDER,
      });
      const lines = row.cells[c];
      for (let k = 0; k < lines.length; k++) {
        drawLine(ctx.page, lines[k], x + TABLE_PAD_X, ctx.y - TABLE_PAD_Y - k * lineHeightOf(size),
          widths[c] - 2 * TABLE_PAD_X, size);
      }
      x += widths[c];
    }
    ctx.y -= row.height;
  };

  for (let r = 0; r < laidOut.length; r++) {
    const row = laidOut[r];
    if (ctx.y - row.height < contentBottom(ctx) && ctx.y < contentTop(ctx) - 0.01) {
      await startPage(ctx);
      // Kopfzeile auf der Folgeseite wiederholen — sonst ist die Tabelle
      // ab Seite 2 nicht mehr lesbar.
      if (headerRow && r > 0) drawRow(headerRow);
    }
    drawRow(row);
  }
}

const stripTags = (html: string): string => decodeEntities(String(html ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

async function renderImageBlock(ctx: Ctx, block: EditorBlock, what: string): Promise<void> {
  const img = await embedImage(ctx, block.src, what);
  if (!img) return;
  const w = ctx.contentW * Math.min(100, Math.max(1, block.widthPercent ?? 100)) / 100;
  const h = (img.height / img.width) * w;
  if ((block.cornerRadiusPx ?? 0) > 0 || block.shadowEnabled) {
    ctx.warnOnce("Abgerundete Bildecken und Schatten haben im PDF keine Entsprechung — sie fehlen im Ergebnis.");
  }
  await ensure(ctx, h);
  const align = block.align ?? "left";
  const x = align === "center" ? ctx.margin + (ctx.contentW - w) / 2
    : align === "right" ? ctx.margin + ctx.contentW - w
      : ctx.margin;
  ctx.page.drawImage(img, { x, y: ctx.y - h, width: w, height: h });
  if ((block.borderWidthPx ?? 0) > 0 && block.borderColor) {
    ctx.page.drawRectangle({
      x, y: ctx.y - h, width: w, height: h,
      borderColor: parseHex(block.borderColor, rgb(0, 0, 0)), borderWidth: (block.borderWidthPx ?? 1) * PX,
    });
  }
  ctx.y -= h;
}

async function renderShape(ctx: Ctx, block: EditorBlock): Promise<void> {
  const color = parseHex(block.color, ctx.colBody);
  if (block.shape === "line") {
    await ensure(ctx, 1.5 * PX);
    ctx.page.drawRectangle({ x: ctx.margin, y: ctx.y - 1.5 * PX, width: ctx.contentW, height: 1.5 * PX, color });
    ctx.y -= 1.5 * PX;
    return;
  }
  if (block.shape === "divider") {
    const h = 2 * DIVIDER_GAP + 1 * PX;
    await ensure(ctx, h);
    ctx.page.drawRectangle({
      x: ctx.margin, y: ctx.y - DIVIDER_GAP - 1 * PX, width: ctx.contentW, height: 1 * PX, color: ctx.colAccent,
    });
    ctx.y -= h;
    return;
  }
  const h = (block.heightPx ?? 48) * PX;
  await ensure(ctx, h);
  if (block.fill) ctx.page.drawRectangle({ x: ctx.margin, y: ctx.y - h, width: ctx.contentW, height: h, color });
  else ctx.page.drawRectangle({ x: ctx.margin, y: ctx.y - h, width: ctx.contentW, height: h, borderColor: color, borderWidth: 1.5 * PX });
  ctx.y -= h;
}

async function renderColumns(ctx: Ctx, block: EditorBlock): Promise<void> {
  const cols = (block.columnsHtml ?? []).filter((c) => typeof c === "string");
  if (cols.length === 0) return;
  const gap = (block.columnGapPx ?? 16) * PX;
  const colW = (ctx.contentW - gap * (cols.length - 1)) / cols.length;
  const size = block.fontSizePt ?? BODY_PT;
  const style: TextStyle = { family: ctx.bodyFamily, size, color: ctx.colBody, align: block.align ?? "left" };
  const laid: Line[][] = [];
  for (const html of cols) laid.push(await layoutText(ctx, html, style, colW));

  const lh = lineHeightOf(size);
  const height = Math.max(...laid.map((l) => l.length)) * lh;
  await ensure(ctx, Math.min(height, contentTop(ctx) - contentBottom(ctx)));
  const available = ctx.y - contentBottom(ctx);
  if (height > available) {
    ctx.warn("Ein Spaltenblock ist höher als die Seite — er wird am Seitenende abgeschnitten (Spalten brechen nicht um).");
  }
  const top = ctx.y;
  for (let c = 0; c < laid.length; c++) {
    const x = ctx.margin + c * (colW + gap);
    for (let k = 0; k < laid[c].length; k++) {
      if ((k + 1) * lh > available) break;
      drawLine(ctx.page, laid[c][k], x, top - k * lh, colW, size);
    }
  }
  ctx.y -= Math.min(height, available);
}

/** Rundrechteck als SVG-Pfad (pdf-lib kennt keinen Radius an drawRectangle). */
function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M ${x + rr} ${y} H ${x + w - rr} A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr} V ${y + h - rr} ` +
    `A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h} H ${x + rr} A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr} ` +
    `V ${y + rr} A ${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`;
}

async function renderMindmap(ctx: Ctx, block: EditorBlock): Promise<void> {
  if (!block.mind) return;
  const map = layoutMindmap(block.mind);
  const w = ctx.contentW * Math.min(100, Math.max(1, block.widthPercent ?? 80)) / 100;
  const scale = w / map.w;
  const h = map.h * scale;
  await ensure(ctx, h);
  const align = block.align ?? "left";
  const originX = align === "center" ? ctx.margin + (ctx.contentW - w) / 2
    : align === "right" ? ctx.margin + ctx.contentW - w
      : ctx.margin;
  const originY = ctx.y; // Oberkante; die SVG-Koordinaten laufen nach unten

  ctx.page.drawRectangle({ x: originX, y: originY - h, width: w, height: h, color: parseHex(map.background, rgb(1, 1, 1)) });
  for (const l of map.links) {
    const mx = (l.x1 + l.x2) / 2;
    ctx.page.drawSvgPath(`M ${l.x1} ${l.y1} C ${mx} ${l.y1}, ${mx} ${l.y2}, ${l.x2} ${l.y2}`, {
      x: originX, y: originY, scale, borderColor: parseHex("#9aa6a0", rgb(0.6, 0.65, 0.63)), borderWidth: 2 * scale,
    });
  }
  const labelFont = await ctx.fonts.get("sans", { bold: true });
  const labelSize = 13 * scale;
  for (const n of map.nodes) {
    ctx.page.drawSvgPath(roundedRectPath(n.x, n.y, n.w, n.h, n.h / 2), {
      x: originX, y: originY, scale,
      color: parseHex(n.fill, rgb(0.3, 0.45, 0.35)),
      borderColor: rgb(1, 1, 1), borderWidth: 1.5 * scale,
    });
    const label = ctx.fonts.sanitize(labelFont, n.label).text;
    const tw = labelFont.widthOfTextAtSize(label, labelSize);
    ctx.page.drawText(label, {
      x: originX + (n.x + n.w / 2) * scale - tw / 2,
      y: originY - (n.y + n.h / 2) * scale - labelSize * 0.35,
      size: labelSize, font: labelFont, color: rgb(1, 1, 1),
    });
  }
  ctx.y -= h;
}

async function renderBlock(ctx: Ctx, block: EditorBlock): Promise<void> {
  const align = block.align ?? "left";
  switch (block.type) {
    case "Heading": {
      const level = block.level ?? 2;
      const size = block.fontSizePt ?? H_PT[level] ?? H_PT[2];
      const html = block.text ?? "";
      await renderTextFlow(ctx, `<b>${html}</b>`, { family: ctx.headingFamily, size, color: ctx.colHeading, align }, block.background);
      break;
    }
    case "Paragraph":
      await renderTextFlow(ctx, block.text ?? "", { family: ctx.bodyFamily, size: block.fontSizePt ?? BODY_PT, color: ctx.colBody, align }, block.background);
      break;
    case "Columns":
      await renderColumns(ctx, block);
      break;
    case "Image":
      await renderImageBlock(ctx, block, "Bild-Block");
      break;
    case "QrCode":
      await renderImageBlock(ctx, { ...block, widthPercent: block.widthPercent ?? 30 }, "QR-Block");
      break;
    case "Mindmap":
      await renderMindmap(ctx, block);
      break;
    case "Table":
      await renderTable(ctx, block);
      break;
    case "Spacer": {
      const h = (block.heightPx ?? 24) * PX;
      await ensure(ctx, h);
      ctx.y -= h;
      break;
    }
    case "Shape":
      await renderShape(ctx, block);
      break;
    default:
      ctx.warn(`Blocktyp '${block.type}' ist unbekannt und wurde übersprungen.`);
      return;
  }
  ctx.y -= BLOCK_GAP;
}

// --- Overlays ----------------------------------------------------------------
async function renderOverlay(ctx: Ctx, ov: EditorOverlay): Promise<void> {
  const x = ctx.pageW * (ov.xPercent ?? 0) / 100;
  const topY = ctx.pageH - ctx.pageH * (ov.yPercent ?? 0) / 100;
  const w = ctx.pageW * (ov.widthPercent ?? 20) / 100;
  const opacity = Math.min(100, Math.max(0, ov.opacityPercent ?? 100)) / 100;
  const rotateDeg = ov.rotationDeg ?? 0;

  if (ov.type === "Shape") {
    const h = ctx.pageH * (ov.heightPercent ?? 10) / 100;
    const center = { x: x + w / 2, y: topY - h / 2 };
    const o: DrawOpts = { opacity, rotateDeg, center };
    const color = parseHex(ov.color, ctx.colAccent);
    if (ov.shape === "ellipse") {
      const p = placed(center.x, center.y, o);
      ctx.page.drawEllipse({ x: p.x, y: p.y, xScale: w / 2, yScale: h / 2, color, opacity, rotate: degrees(p.deg) });
    } else {
      const p = placed(x, topY - h, o);
      ctx.page.drawRectangle({ x: p.x, y: p.y, width: w, height: h, color, opacity, rotate: degrees(p.deg) });
    }
    return;
  }

  if (ov.type === "Image") {
    const img = await embedImage(ctx, ov.src, "Overlay-Bild");
    if (!img) return;
    const h = (img.height / img.width) * w;
    const center = { x: x + w / 2, y: topY - h / 2 };
    const p = placed(x, topY - h, { opacity, rotateDeg, center });
    ctx.page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, opacity, rotate: degrees(p.deg) });
    return;
  }

  // Text-Overlay: erst umbrechen, dann steht die Kastenhöhe und damit der
  // Drehpunkt fest (CSS dreht um die Mitte).
  const size = ov.fontSizePt ?? BODY_PT;
  const padX = ov.background ? 6 * PX : 0;
  const padY = ov.background ? 2 * PX : 0;
  const style: TextStyle = { family: ctx.bodyFamily, size, color: parseHex(ov.color, ctx.colBody), align: ov.align ?? "left" };
  const lines = await layoutText(ctx, ov.text ?? "", style, Math.max(1, w - 2 * padX));
  const h = lines.length * lineHeightOf(size) + 2 * padY;
  const center = { x: x + w / 2, y: topY - h / 2 };
  const o: DrawOpts = { opacity, rotateDeg, center };
  if (ov.background) {
    const p = placed(x, topY - h, o);
    ctx.page.drawRectangle({
      x: p.x, y: p.y, width: w, height: h,
      color: parseHex(ov.background, rgb(1, 1, 1)), opacity, rotate: degrees(p.deg),
    });
  }
  for (let k = 0; k < lines.length; k++) {
    drawLine(ctx.page, lines[k], x + padX, topY - padY - k * lineHeightOf(size), w - 2 * padX, size, o);
  }
}

// --- Einstieg ----------------------------------------------------------------
/**
 * Rendert ein (validiertes) Design-Dokument als PDF. Reproduzierbar: keine
 * Uhrzeit im Ergebnis, die Datei-/ID wird aus dem Design abgeleitet.
 */
export async function renderPdf(document: EditorDocument): Promise<DesignPdfResult> {
  const layout = layoutOf(document.layout);
  const doc = await PDFDocument.create(NO_METADATA_BUMP);
  doc.registerFontkit(fontkit);

  const warnings: string[] = [];
  const seen = new Set<string>();
  const warn = (w: string): void => { if (!seen.has(w)) { seen.add(w); warnings.push(w); } };

  const theme = document.theme;
  const headingFamily = FAMILY_FOR_THEME[theme?.headingFont ?? "georgia"] ?? "serif";
  const bodyFamily = FAMILY_FOR_THEME[theme?.bodyFont ?? "georgia"] ?? "serif";
  for (const [key, family] of [[theme?.headingFont, headingFamily], [theme?.bodyFont, bodyFamily]] as Array<[string | undefined, Family]>) {
    if (key) warn(`Schriftersatz: Theme-Schrift '${key}' liegt serverseitig nicht vor — gezeichnet und eingebettet wird ${FAMILY_LABEL[family]}.`);
  }

  const accent = theme?.accentColor ?? "#6b7280";
  const ctx: Ctx = {
    doc,
    fonts: new FontBox(doc),
    warn,
    warnOnce: warn,
    theme,
    pageW: layout.widthMm * MM,
    pageH: layout.heightMm * MM,
    margin: layout.marginMm * MM,
    contentW: (layout.widthMm - 2 * layout.marginMm) * MM,
    page: undefined as unknown as PDFPage,
    y: 0,
    source: document.pages[0] ?? { blocks: [] },
    headingFamily,
    bodyFamily,
    colHeading: parseHex(theme?.headingColor, rgb(0.07, 0.09, 0.15)),
    colBody: parseHex(theme?.bodyColor, rgb(0.07, 0.09, 0.15)),
    colAccent: parseHex(accent, rgb(0.42, 0.45, 0.5)),
    colAccentSoft: parseHex(mixWithWhite(accent, 12), rgb(0.95, 0.96, 0.96)),
    pageCount: 0,
  };

  for (const source of document.pages.length ? document.pages : [{ blocks: [] } as EditorPage]) {
    ctx.source = source;
    await startPage(ctx);
    // Overlays sind prozentual zur SEITE positioniert, nicht zum Fluss. Bricht
    // der Fluss auf Folgeseiten um, bleiben sie trotzdem auf der ersten Seite
    // dieser Design-Seite — so wie der Browser eine absolut positionierte Box
    // beim Umbruch am Ursprung ihres Containers stehen lässt.
    const firstPage = ctx.page;
    for (const block of source.blocks ?? []) await renderBlock(ctx, block);
    const flowPage = ctx.page;
    ctx.page = firstPage;
    for (const ov of source.overlays ?? []) await renderOverlay(ctx, ov);
    ctx.page = flowPage;
  }

  // Datei-/ID aus dem Design abgeleitet statt zufällig (siehe D2): gleiches
  // Design → gleiche Kennung → gleiche Bytes.
  const id = PDFHexString.of(deterministicFileId(JSON.stringify(document)));
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, pageCount: ctx.pageCount, warnings };
}
