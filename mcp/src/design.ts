// =============================================================================
// pagebound-pdf-mcp-server — Designer-Operationen (Pagebound-Designs)
// ----------------------------------------------------------------------------
// Spiegelt das Dokument-Modell des WYSIWYG-Designers der PWA (EditorDocument,
// PascalCase-Enums wie "Heading"/"A4Portrait", camelCase-Felder), damit hier
// erzeugte/validierte Designs 1:1 in der PWA importierbar sind — als Datei im
// Design-Ordner (*.pbdesign.json) oder über „Import (JSON-Dokument)".
//
// Reine Daten-Operationen, kein DOM: die HTML-Sanitisierung hier ist eine
// konservative Normalisierung; die PWA sanitisiert beim Import zusätzlich
// DOM-basiert.
// =============================================================================

import { ToolError } from "./pdf.js";
import { renderMindmapSvg, sanitizeMindNode, type MindmapNode } from "./mind.js";

// --- Modell (Spiegel von Pagebound.Core.Domain) -------------------------------

export interface EditorTheme {
  name: string;
  headingFont: string;
  bodyFont: string;
  headingColor: string;
  bodyColor: string;
  accentColor: string;
  pageBackground?: string | null;
}

export interface EditorBlock {
  id?: string;
  type: string; // Heading | Paragraph | Image | Shape | Table | Spacer | Columns | QrCode | Mindmap
  text?: string | null;
  level?: number;
  align?: string;
  src?: string | null;
  widthPercent?: number;
  alt?: string | null;
  shape?: string | null;
  color?: string;
  heightPx?: number;
  fill?: boolean;
  background?: string | null;
  fontSizePt?: number | null;
  cornerRadiusPx?: number;
  borderColor?: string | null;
  borderWidthPx?: number;
  shadowEnabled?: boolean;
  columnsHtml?: string[] | null;
  columnGapPx?: number;
  rows?: string[][] | null;
  headerRow?: boolean;
  mind?: MindmapNode | null; // nur Mindmap-Block: Wurzel des Knoten-Baums
}

export interface EditorOverlay {
  id?: string;
  type: string; // Text | Image | Shape
  xPercent?: number;
  yPercent?: number;
  widthPercent?: number;
  heightPercent?: number;
  rotationDeg?: number;
  opacityPercent?: number;
  text?: string | null;
  fontSizePt?: number | null;
  color?: string;
  background?: string | null;
  align?: string;
  src?: string | null;
  alt?: string | null;
  shape?: string;
}

export interface EditorPage {
  id?: string;
  background?: string | null;
  backgroundImage?: string | null;
  backgroundSize?: string;
  backgroundOpacityPercent?: number;
  backgroundPosition?: string;
  backgroundRepeat?: boolean;
  blocks: EditorBlock[];
  overlays?: EditorOverlay[];
}

export interface EditorDocument {
  id?: string;
  title: string;
  layout: string;
  theme?: EditorTheme | null;
  pages: EditorPage[];
  createdAt?: string;
  updatedAt?: string;
}

// --- Layouts -------------------------------------------------------------------

export interface LayoutInfo { name: string; widthMm: number; heightMm: number; marginMm: number }

export const LAYOUTS: LayoutInfo[] = [
  { name: "A4Portrait", widthMm: 210, heightMm: 297, marginMm: 20 },
  { name: "A4Landscape", widthMm: 297, heightMm: 210, marginMm: 20 },
  { name: "A5Portrait", widthMm: 148, heightMm: 210, marginMm: 15 },
  { name: "Letter", widthMm: 215.9, heightMm: 279.4, marginMm: 20 },
  { name: "Slide16x9", widthMm: 254, heightMm: 142.875, marginMm: 12 },
  { name: "DinLong", widthMm: 105, heightMm: 210, marginMm: 10 },
  { name: "A6Landscape", widthMm: 148, heightMm: 105, marginMm: 10 },
];

function layoutOf(name: string): LayoutInfo {
  const found = LAYOUTS.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new ToolError(`Unbekanntes Layout '${name}'. Erlaubt: ${LAYOUTS.map((l) => l.name).join(", ")}.`);
  return found;
}

// --- Themes (Spiegel von EditorThemes) ------------------------------------------

export const FONT_STACKS: Record<string, string> = {
  georgia: "Georgia, 'Times New Roman', serif",
  newsreader: "'Newsreader', Georgia, 'Times New Roman', serif",
  hanken: "'Hanken Grotesk', system-ui, Arial, sans-serif",
  mono: "'JetBrains Mono', Consolas, monospace",
};

export const THEME_PRESETS: EditorTheme[] = [
  { name: "Klassik", headingFont: "georgia", bodyFont: "georgia", headingColor: "#111827", bodyColor: "#111827", accentColor: "#6b7280" },
  { name: "Modern", headingFont: "hanken", bodyFont: "hanken", headingColor: "#111827", bodyColor: "#374151", accentColor: "#2563eb" },
  { name: "Editorial", headingFont: "newsreader", bodyFont: "georgia", headingColor: "#1f2937", bodyColor: "#1f2937", accentColor: "#b45309", pageBackground: "#fffdf8" },
  { name: "Dunkel", headingFont: "hanken", bodyFont: "hanken", headingColor: "#f9fafb", bodyColor: "#e5e7eb", accentColor: "#f59e0b", pageBackground: "#111827" },
  { name: "Frisch", headingFont: "hanken", bodyFont: "georgia", headingColor: "#047857", bodyColor: "#1f2937", accentColor: "#10b981", pageBackground: "#f0fdf4" },
  { name: "Elegant", headingFont: "newsreader", bodyFont: "newsreader", headingColor: "#9d174d", bodyColor: "#27272a", accentColor: "#9d174d", pageBackground: "#fffbf5" },
];

export function themeByName(name: string): EditorTheme {
  const t = THEME_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!t) throw new ToolError(`Unbekanntes Theme '${name}'. Erlaubt: ${THEME_PRESETS.map((p) => p.name).join(", ")}.`);
  return { ...t };
}

function sanitizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v) ? v : fallback;
}

function sanitizeColorOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return sanitizeColor(value, "#ffffff");
}

function mixWithWhite(hex: string, percent: number): string {
  let c = sanitizeColor(hex, "#000000");
  if (c.length === 4) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  const p = Math.min(100, Math.max(0, percent)) / 100;
  const mix = (i: number) => Math.round(parseInt(c.slice(i, i + 2), 16) * p + 255 * (1 - p));
  return `#${[1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
}

// --- Bausteine + Standard-Inhalte (Spiegel von EditorTemplates/-DesignDefaults) --

const H = (text: string, level = 1, align = "left", sizePt?: number): EditorBlock =>
  ({ type: "Heading", text, level, align, ...(sizePt ? { fontSizePt: sizePt } : {}) });
const P = (html: string, align = "left", sizePt?: number): EditorBlock =>
  ({ type: "Paragraph", text: html, align, ...(sizePt ? { fontSizePt: sizePt } : {}) });
const FillRect = (color: string, heightPx: number): EditorBlock =>
  ({ type: "Shape", shape: "rectangle", color, heightPx, fill: true });
const Divider = (): EditorBlock => ({ type: "Shape", shape: "divider" });
const Img = (alt: string, widthPercent = 60): EditorBlock =>
  ({ type: "Image", alt, widthPercent, align: "center" });
const Spacer = (heightPx: number): EditorBlock => ({ type: "Spacer", heightPx });
const Tbl = (headerRow: boolean, ...rows: string[][]): EditorBlock =>
  ({ type: "Table", headerRow, rows });
let _mindId = 0;
const mnode = (label: string, children: MindmapNode[] = []): MindmapNode =>
  ({ id: `n${++_mindId}`, label, children });
const Mind = (root: string, branches: string[]): EditorBlock =>
  ({ type: "Mindmap", widthPercent: 80, align: "center", mind: mnode(root, branches.map((b) => mnode(b))) });
const Page = (...blocks: EditorBlock[]): EditorPage => ({ blocks });

function doc(title: string, layout: string, themeName: string | null, ...pages: EditorPage[]): EditorDocument {
  return {
    title,
    layout,
    theme: themeName ? themeByName(themeName) : null,
    pages,
  };
}

export interface CatalogDesign { kind: string; title: string; layout: string; theme: string | null; description: string }

type Factory = () => EditorDocument;

const DESIGNS: Array<CatalogDesign & { create: Factory }> = [
  {
    kind: "blank", title: "Leeres Dokument", layout: "A4Portrait", theme: null,
    description: "Leere A4-Seite ohne Theme.",
    create: () => doc("Unbenanntes Dokument", "A4Portrait", null, Page()),
  },
  {
    kind: "invoice", title: "Rechnung (§ 19 UStG)", layout: "A4Portrait", theme: null,
    description: "Kleinunternehmer-Rechnung mit Positionstabelle.",
    create: () => doc("Rechnung", "A4Portrait", null, Page(
      P("Max Mustermann · Musterstraße 1 · 12345 Musterstadt"),
      P("<br>Firma Kundenname GmbH<br>Frau/Herr Vorname Nachname<br>Kundenstraße 2<br>54321 Kundenstadt"),
      P("Musterstadt, 01.06.2026", "right"),
      H("Rechnung LMD-2026-0001", 1),
      P("Sehr geehrte Damen und Herren,<br>vielen Dank für Ihren Auftrag. Wir berechnen Ihnen die folgenden Leistungen:"),
      Tbl(true,
        ["Pos.", "Beschreibung", "Menge", "Einzelpreis", "Gesamt"],
        ["1", "Leistung / Artikel", "1", "0,00 €", "0,00 €"],
        ["2", "Weitere Position", "1", "0,00 €", "0,00 €"]),
      P("<strong>Gesamtbetrag: 0,00 €</strong>", "right"),
      P("Gemäß § 19 UStG wird keine Umsatzsteuer ausgewiesen (Kleinunternehmerregelung)."),
      Divider(),
      P("Zahlbar innerhalb von 14 Tagen ohne Abzug auf folgendes Konto:<br>Bank · IBAN DE00 0000 0000 0000 0000 00 · BIC XXXXXXXX"))),
  },
  {
    kind: "letter", title: "Geschäftsbrief (DIN 5008)", layout: "A4Portrait", theme: null,
    description: "Brief mit Anschriftfeld und Grußformel.",
    create: () => doc("Geschäftsbrief", "A4Portrait", null, Page(
      P("Max Mustermann · Musterstraße 1 · 12345 Musterstadt"),
      P("<br>Firma Empfänger GmbH<br>Frau/Herr Vorname Nachname<br>Empfängerstraße 2<br>54321 Empfängerstadt"),
      P("Musterstadt, 01.06.2026", "right"),
      H("Betreff: Ihr Anliegen", 3),
      P("Sehr geehrte Damen und Herren,"),
      P("hier steht der Text Ihres Schreibens. Dieser Absatz lässt sich frei bearbeiten und nach DIN 5008 formatieren."),
      P("Mit freundlichen Grüßen"),
      P("<br><br>Max Mustermann"))),
  },
  {
    kind: "flyer", title: "Flyer (A4, Vorder-/Rückseite)", layout: "A4Portrait", theme: "Modern",
    description: "Zweiseitiger Veranstaltungs-Flyer mit Programm-Tabelle.",
    create: () => doc("Flyer", "A4Portrait", "Modern",
      Page(
        H("Veranstaltungstitel", 1, "center"),
        P("Ein einprägsamer Untertitel oder Slogan", "center"),
        Img("Bild / Logo hier einfügen"),
        P("Beschreiben Sie kurz und prägnant, worum es geht. Was, wann, wo — die wichtigsten Informationen auf einen Blick.", "center"),
        Divider(),
        P("Datum · Uhrzeit · Ort<br>www.beispiel.de · kontakt@beispiel.de", "center")),
      Page(
        H("Programm &amp; Details", 2, "center"),
        P("Hier ist Platz für das ausführliche Programm, den Ablauf oder weitere Informationen zur Veranstaltung."),
        Tbl(true, ["Uhrzeit", "Programmpunkt"], ["10:00", "Begrüßung"], ["11:00", "Hauptprogramm"], ["14:00", "Ausklang"]),
        Spacer(24),
        Divider(),
        P("Anfahrt, Kontakt &amp; Anmeldung<br>www.beispiel.de · kontakt@beispiel.de · 0123 456789", "center"))),
  },
  {
    kind: "slide", title: "Präsentation (16:9)", layout: "Slide16x9", theme: null,
    description: "Titel- und Agenda-Folie.",
    create: () => doc("Präsentation", "Slide16x9", null,
      Page(H("Titel der Präsentation", 1, "center"), FillRect("#2563eb", 4), P("Untertitel · Referent · Datum", "center")),
      Page(H("Agenda", 2), P("• Punkt eins<br>• Punkt zwei<br>• Punkt drei"))),
  },
  {
    kind: "mindmap", title: "Mindmap (16:9)", layout: "Slide16x9", theme: null,
    description: "Folie mit zentraler Mindmap (bearbeitbarer Knoten-Baum; in der PWA interaktiv).",
    create: () => doc("Mindmap", "Slide16x9", null,
      Page(
        H("Thema", 2, "center"),
        Mind("Zentrales Thema", ["Aspekt 1", "Aspekt 2", "Aspekt 3", "Aspekt 4"]))),
  },
  {
    kind: "event-flyer-din-lang", title: "Event-Flyer (DIN lang)", layout: "DinLong", theme: "Modern",
    description: "Klassischer Auslage-Flyer im DIN-lang-Format.",
    create: () => doc("Event-Flyer (DIN lang)", "DinLong", "Modern",
      Page(
        FillRect("#2563eb", 6), Spacer(12),
        H("Sommerfest 2026", 1, "center"),
        P("Musik · Essen · Mitmachaktionen", "center"),
        Spacer(8), Img("Veranstaltungsbild", 90), Spacer(8),
        P("<strong>Samstag, 18. Juli</strong><br>ab 14 Uhr · Stadtpark", "center"),
        Divider(), P("Eintritt frei · www.beispiel.de", "center", 9)),
      Page(
        H("Programm", 2, "center"),
        Tbl(true, ["Zeit", "Punkt"], ["14:00", "Eröffnung"], ["15:30", "Live-Musik"], ["18:00", "Tombola"]),
        Spacer(12), Divider(),
        P("Veranstalter · Adresse · Kontakt<br>kontakt@beispiel.de · 0123 456789", "center", 9),
        Spacer(8), FillRect("#2563eb", 6))),
  },
  {
    kind: "party-flyer-dunkel", title: "Party-Flyer (dunkel)", layout: "A4Portrait", theme: "Dunkel",
    description: "Plakativer dunkler Flyer mit Akzent-Balken.",
    create: () => doc("Party-Flyer (dunkel)", "A4Portrait", "Dunkel",
      Page(
        Spacer(40), H("NACHT // KLANG", 1, "center", 44), FillRect("#f59e0b", 4), Spacer(16),
        P("DJ-Line-up · Visuals · Specials", "center", 14), Spacer(24),
        Img("Artwork", 80), Spacer(24),
        P("<strong>Fr 31.10. · 23 Uhr · Halle 7</strong>", "center", 16),
        P("Tickets: www.beispiel.de · Abendkasse", "center"),
        Spacer(32), FillRect("#f59e0b", 4))),
  },
  {
    kind: "postkarte-a6", title: "Postkarte (A6 quer)", layout: "A6Landscape", theme: "Editorial",
    description: "Postkarte mit Motiv- und Adressseite.",
    create: () => doc("Postkarte (A6 quer)", "A6Landscape", "Editorial",
      Page(Spacer(8), H("Liebe Grüße", 1, "center"), P("aus dem schönen Musterstadt", "center"), Spacer(8), Img("Motiv", 70)),
      Page(
        P("Hier ist Platz für eine persönliche Nachricht …", "left", 10),
        Spacer(24), Divider(),
        P("An:<br>Vorname Nachname<br>Straße 1<br>12345 Stadt", "right", 10))),
  },
  {
    kind: "speisekarte", title: "Speisekarte", layout: "A4Portrait", theme: "Elegant",
    description: "Elegante Karte mit Preistabellen.",
    create: () => doc("Speisekarte", "A4Portrait", "Elegant",
      Page(
        H("Ristorante Esempio", 1, "center"), P("Cucina italiana · seit 1987", "center"), Divider(), Spacer(8),
        H("Antipasti", 3), Tbl(false, ["Bruschetta al pomodoro", "6,50 €"], ["Vitello tonnato", "11,00 €"]), Spacer(8),
        H("Primi", 3), Tbl(false, ["Tagliatelle al ragù", "13,50 €"], ["Risotto ai funghi", "14,00 €"]), Spacer(8),
        H("Dolci", 3), Tbl(false, ["Tiramisù della casa", "6,00 €"], ["Panna cotta", "5,50 €"]), Spacer(12),
        Divider(), P("Alle Preise inkl. MwSt. · Allergene auf Anfrage", "center", 9))),
  },
  {
    kind: "vereins-flyer", title: "Vereins-Flyer", layout: "A4Portrait", theme: "Frisch",
    description: "Info-Flyer mit Trainingszeiten-Tabelle.",
    create: () => doc("Vereins-Flyer", "A4Portrait", "Frisch",
      Page(
        H("SV Beispielhausen", 1, "center"), P("Sport · Gemeinschaft · Ehrenamt", "center"), Img("Vereinslogo", 40), Divider(),
        H("Jetzt Mitglied werden!", 2),
        P("Wir bieten Training für alle Altersgruppen, von Jugend bis Senioren. Schnuppertraining jederzeit möglich — komm einfach vorbei."),
        Tbl(true, ["Gruppe", "Training", "Ort"], ["Jugend", "Di 17–18:30", "Halle A"], ["Erwachsene", "Do 19–21", "Halle A"], ["Senioren", "Mo 10–11:30", "Halle B"]),
        Spacer(12), Divider(),
        P("SV Beispielhausen e. V. · www.beispiel.de · info@beispiel.de", "center", 9))),
  },
];

export function catalog(): { themes: EditorTheme[]; fonts: Record<string, string>; layouts: LayoutInfo[]; designs: CatalogDesign[] } {
  return {
    themes: THEME_PRESETS.map((t) => ({ ...t })),
    fonts: { ...FONT_STACKS },
    layouts: LAYOUTS.map((l) => ({ ...l })),
    designs: DESIGNS.map(({ create: _create, ...info }) => info),
  };
}

export function createDesign(kind: string, opts: { title?: string; theme?: string; layout?: string } = {}): EditorDocument {
  const entry = DESIGNS.find((d) => d.kind.toLowerCase() === kind.toLowerCase());
  if (!entry) throw new ToolError(`Unbekannte Vorlage '${kind}'. Erlaubt: ${DESIGNS.map((d) => d.kind).join(", ")}.`);
  const result = entry.create();
  if (opts.title?.trim()) result.title = opts.title.trim();
  if (opts.theme) result.theme = themeByName(opts.theme);
  if (opts.layout) result.layout = layoutOf(opts.layout).name;
  return result;
}

// --- Validierung / Normalisierung -----------------------------------------------

const BLOCK_TYPES = ["Heading", "Paragraph", "Image", "Shape", "Table", "Spacer", "Columns", "QrCode", "Mindmap"];
const OVERLAY_TYPES = ["Text", "Image", "Shape"];
const ALIGNS = new Set(["left", "center", "right", "justify"]);

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Konservative HTML-Normalisierung ohne DOM: entfernt Skript-/Einbettungs-Tags
// und on*-Attribute. Die PWA sanitisiert beim Import zusätzlich DOM-basiert.
function stripDangerousHtml(html: string, issues: string[], where: string): string {
  let out = html;
  const before = out;
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|template)\b[^>]*\/?\s*>/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, "");
  if (out !== before) issues.push(`${where}: aktives HTML entfernt (Script/Event-Handler).`);
  return out;
}

export function validateDesign(raw: string): { doc: EditorDocument; issues: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ToolError(`Kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const issues: string[] = [];
  const d = parsed as Partial<EditorDocument> & { blocks?: EditorBlock[]; background?: string };
  if (!d || typeof d !== "object") throw new ToolError("JSON ist kein Objekt.");

  // Legacy-Migration (einseitige Dokumente vor Multi-Page)
  let pages = Array.isArray(d.pages) ? d.pages : [];
  if (pages.length === 0 && Array.isArray(d.blocks)) {
    pages = [{ background: d.background ?? null, blocks: d.blocks }];
    issues.push("Legacy-Dokument: Blöcke in Seite 1 überführt.");
  }
  if (pages.length === 0) pages = [{ blocks: [] }];

  const title = typeof d.title === "string" ? d.title.slice(0, 200) : "Unbenanntes Dokument";
  let layout = "A4Portrait";
  if (typeof d.layout === "string") {
    try { layout = layoutOf(d.layout).name; }
    catch { issues.push(`Unbekanntes Layout '${d.layout}' → A4Portrait.`); }
  }

  let theme: EditorTheme | null = null;
  if (d.theme && typeof d.theme === "object") {
    const t = d.theme as EditorTheme;
    theme = {
      name: typeof t.name === "string" ? t.name.slice(0, 60) : "",
      headingFont: FONT_STACKS[t.headingFont ?? ""] ? t.headingFont : "georgia",
      bodyFont: FONT_STACKS[t.bodyFont ?? ""] ? t.bodyFont : "georgia",
      headingColor: sanitizeColor(t.headingColor, "#111827"),
      bodyColor: sanitizeColor(t.bodyColor, "#111827"),
      accentColor: sanitizeColor(t.accentColor, "#2563eb"),
      pageBackground: sanitizeColorOrNull(t.pageBackground),
    };
  }

  const outPages: EditorPage[] = pages.map((p, pi) => {
    const blocks = Array.isArray(p?.blocks) ? p.blocks : [];
    const outBlocks: EditorBlock[] = [];
    for (const b of blocks) {
      const typeRaw = typeof b?.type === "string" ? b.type : "";
      const type = BLOCK_TYPES.find((t) => t.toLowerCase() === typeRaw.toLowerCase());
      if (!type) {
        issues.push(`Seite ${pi + 1}: Block mit unbekanntem Typ '${typeRaw}' entfernt.`);
        continue;
      }
      const where = `Seite ${pi + 1}/${type}`;
      const block: EditorBlock = {
        type,
        align: ALIGNS.has(b.align ?? "") ? b.align : "left",
        level: clamp(b.level, 1, 3, 2),
        color: sanitizeColor(b.color, "#1f2937"),
        background: sanitizeColorOrNull(b.background),
        widthPercent: clamp(b.widthPercent, 10, 100, 100),
        heightPx: clamp(b.heightPx, 1, 400, 48),
        fill: b.fill === true,
        headerRow: b.headerRow !== false,
      };
      if (typeof b.text === "string") block.text = stripDangerousHtml(b.text, issues, where);
      if (typeof b.alt === "string") block.alt = b.alt.slice(0, 200);
      if (typeof b.shape === "string") block.shape = ["rectangle", "line", "divider"].includes(b.shape) ? b.shape : "rectangle";
      if (typeof b.fontSizePt === "number") block.fontSizePt = clamp(b.fontSizePt, 6, 120, 11);
      if (typeof b.src === "string") {
        if (b.src.toLowerCase().startsWith("data:image/")) block.src = b.src;
        else issues.push(`${where}: Bildquelle ist keine data:image-URL — entfernt.`);
      }
      if (Array.isArray(b.rows)) {
        block.rows = b.rows.map((row) => (Array.isArray(row) ? row.map((c) => stripDangerousHtml(String(c ?? ""), issues, where)) : []));
      }
      block.cornerRadiusPx = clamp(b.cornerRadiusPx, 0, 48, 0);
      block.borderWidthPx = clamp(b.borderWidthPx, 0, 12, 0);
      block.borderColor = sanitizeColorOrNull(b.borderColor);
      block.shadowEnabled = b.shadowEnabled === true;
      block.columnGapPx = clamp(b.columnGapPx, 0, 64, 16);
      if (Array.isArray(b.columnsHtml)) {
        block.columnsHtml = b.columnsHtml.slice(0, 4).map((c) => stripDangerousHtml(String(c ?? ""), issues, where));
      }
      if (type === "Mindmap") {
        if (b.mind && typeof b.mind === "object") block.mind = sanitizeMindNode(b.mind, 0);
        else issues.push(`${where}: Mindmap ohne Baum ('mind') — leerer Knoten ergänzt.`);
        block.mind ??= sanitizeMindNode({ label: "Thema", children: [] }, 0);
      }
      outBlocks.push(block);
    }

    const outOverlays: EditorOverlay[] = [];
    for (const o of Array.isArray(p?.overlays) ? p.overlays! : []) {
      const typeRaw = typeof o?.type === "string" ? o.type : "";
      const type = OVERLAY_TYPES.find((t) => t.toLowerCase() === typeRaw.toLowerCase());
      if (!type) {
        issues.push(`Seite ${pi + 1}: Overlay mit unbekanntem Typ '${typeRaw}' entfernt.`);
        continue;
      }
      const where = `Seite ${pi + 1}/Overlay-${type}`;
      const overlay: EditorOverlay = {
        type,
        xPercent: clamp(o.xPercent, -20, 98, 10),
        yPercent: clamp(o.yPercent, -10, 98, 10),
        widthPercent: clamp(o.widthPercent, 4, 100, 40),
        heightPercent: clamp(o.heightPercent, 2, 100, 10),
        rotationDeg: clamp(o.rotationDeg, -180, 180, 0),
        opacityPercent: clamp(o.opacityPercent, 10, 100, 100),
        align: ALIGNS.has(o.align ?? "") ? o.align : "left",
        color: sanitizeColor(o.color, "#111827"),
        background: sanitizeColorOrNull(o.background),
        shape: o.shape === "ellipse" ? "ellipse" : "rectangle",
      };
      if (typeof o.text === "string") overlay.text = stripDangerousHtml(o.text, issues, where);
      if (typeof o.fontSizePt === "number") overlay.fontSizePt = clamp(o.fontSizePt, 6, 120, 11);
      if (typeof o.alt === "string") overlay.alt = o.alt.slice(0, 200);
      if (typeof o.src === "string") {
        if (o.src.toLowerCase().startsWith("data:image/")) overlay.src = o.src;
        else issues.push(`${where}: Bildquelle ist keine data:image-URL — entfernt.`);
      }
      outOverlays.push(overlay);
    }

    let backgroundImage: string | null = null;
    if (typeof p?.backgroundImage === "string") {
      if (p.backgroundImage.toLowerCase().startsWith("data:image/")) backgroundImage = p.backgroundImage;
      else issues.push(`Seite ${pi + 1}: Hintergrundbild ist keine data:image-URL — entfernt.`);
    }
    return {
      background: sanitizeColorOrNull(p?.background),
      backgroundImage,
      backgroundSize: p?.backgroundSize === "contain" ? "contain" : "cover",
      backgroundOpacityPercent: clamp(p?.backgroundOpacityPercent, 10, 100, 100),
      backgroundPosition: p?.backgroundPosition === "top" || p?.backgroundPosition === "bottom" ? p.backgroundPosition : "center",
      backgroundRepeat: p?.backgroundRepeat === true,
      blocks: outBlocks,
      overlays: outOverlays,
    };
  });

  return { doc: { title, layout, theme, pages: outPages }, issues };
}

// --- HTML-Rendering (Spiegel des Standalone-HTML-Exports der PWA) ----------------

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function mm(v: number): string {
  return `${Number.isInteger(v) ? v : v.toString()}mm`;
}

function themeVars(theme: EditorTheme | null | undefined): string {
  if (!theme) return "";
  return (
    `--doc-font-heading:${FONT_STACKS[theme.headingFont] ?? FONT_STACKS.georgia};` +
    `--doc-font-body:${FONT_STACKS[theme.bodyFont] ?? FONT_STACKS.georgia};` +
    `--doc-color-heading:${theme.headingColor};` +
    `--doc-color-body:${theme.bodyColor};` +
    `--doc-color-accent:${theme.accentColor};` +
    `--doc-color-accent-soft:${mixWithWhite(theme.accentColor, 12)};`
  );
}

function blockHtml(b: EditorBlock): string {
  const align = b.align && b.align !== "left" ? ` align-${b.align}` : "";
  const fontSize = b.fontSizePt ? `font-size:${b.fontSizePt}pt;` : "";
  const bg = b.background ? `background:${b.background};` : "";
  const open = `<div class="pb-block" style="${bg}">`;
  switch (b.type) {
    case "Heading":
      return `${open}<div class="pb-h${b.level ?? 2}${align}" style="${fontSize}">${b.text ?? ""}</div></div>`;
    case "Paragraph":
      return `${open}<div class="pb-para${align}" style="${fontSize}">${b.text ?? ""}</div></div>`;
    case "Columns": {
      const cols = (b.columnsHtml ?? []).map((c) => `<div class="pb-col">${c}</div>`).join("");
      return `${open}<div class="pb-cols" style="gap:${b.columnGapPx ?? 16}px;${fontSize}">${cols}</div></div>`;
    }
    case "QrCode":
      if (!b.src) return "";
      return `${open}<div class="pb-img-wrap${align}"><img class="pb-img" src="${b.src}" alt="QR" style="width:${b.widthPercent ?? 30}%;display:inline-block"/></div></div>`;
    case "Image": {
      if (!b.src) return "";
      let imgStyle = `width:${b.widthPercent ?? 100}%;display:inline-block;`;
      if ((b.cornerRadiusPx ?? 0) > 0) imgStyle += `border-radius:${b.cornerRadiusPx}px;`;
      if ((b.borderWidthPx ?? 0) > 0 && b.borderColor) imgStyle += `border:${b.borderWidthPx}px solid ${b.borderColor};`;
      if (b.shadowEnabled) imgStyle += "box-shadow:0 6px 18px rgba(0,0,0,.25);";
      return `${open}<div class="pb-img-wrap${align}"><img class="pb-img" src="${b.src}" alt="${esc(b.alt ?? "")}" style="${imgStyle}"/></div></div>`;
    }
    case "Mindmap": {
      if (!b.mind) return "";
      const { svg } = renderMindmapSvg(b.mind);
      // Inline-SVG, auf widthPercent skaliert (vektor-scharf im Druck).
      return `${open}<div class="pb-img-wrap${align}"><span class="pb-mind" style="display:inline-block;width:${b.widthPercent ?? 80}%">${svg}</span></div></div>`;
    }
    case "Spacer":
      return `${open}<div class="pb-spacer" style="height:${b.heightPx ?? 24}px"></div></div>`;
    case "Shape":
      if (b.shape === "line") return `${open}<div class="pb-shape-line" style="color:${b.color}"></div></div>`;
      if (b.shape === "divider") return `${open}<div class="pb-shape-divider"></div></div>`;
      return `${open}<div class="pb-shape-rect${b.fill ? " is-filled" : ""}" style="height:${b.heightPx ?? 48}px;color:${b.color}"></div></div>`;
    case "Table": {
      const rows = (b.rows ?? []).map((row, r) => {
        const tag = b.headerRow !== false && r === 0 ? "th" : "td";
        return `<tr>${row.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
      }).join("");
      return `${open}<table class="pb-table"${b.fontSizePt ? ` style="font-size:${b.fontSizePt}pt"` : ""}>${rows}</table></div>`;
    }
    default:
      return "";
  }
}

function pageBgLayer(p: EditorPage): string {
  if (!p.backgroundImage) return "";
  let style = `background-image:url('${p.backgroundImage}');`;
  if (p.backgroundRepeat) style += "background-repeat:repeat;background-size:auto;background-position:left top;";
  else {
    style += "background-repeat:no-repeat;";
    style += `background-size:${p.backgroundSize === "contain" ? "contain" : "cover"};`;
    style += `background-position:center ${p.backgroundPosition === "top" || p.backgroundPosition === "bottom" ? p.backgroundPosition : "center"};`;
  }
  const opacity = p.backgroundOpacityPercent ?? 100;
  if (opacity < 100) style += `opacity:${(opacity / 100).toFixed(2)};`;
  return `<div class="pb-page-bg" style="${style}"></div>`;
}

function overlayHtml(o: EditorOverlay): string {
  let style = `left:${o.xPercent}%;top:${o.yPercent}%;width:${o.widthPercent}%;`;
  if (o.type === "Shape") style += `height:${o.heightPercent}%;`;
  if (o.rotationDeg) style += `transform:rotate(${o.rotationDeg}deg);`;
  if ((o.opacityPercent ?? 100) < 100) style += `opacity:${((o.opacityPercent ?? 100) / 100).toFixed(2)};`;
  let inner = "";
  if (o.type === "Text") {
    let t = `color:${o.color};`;
    if (o.fontSizePt) t += `font-size:${o.fontSizePt}pt;`;
    if (o.background) t += `background:${o.background};padding:2px 6px;`;
    const align = o.align && o.align !== "left" ? ` align-${o.align}` : "";
    inner = `<div class="pb-ov-text${align}" style="${t}">${o.text ?? ""}</div>`;
  } else if (o.type === "Image" && o.src) {
    inner = `<img class="pb-ov-img" src="${o.src}" alt="${esc(o.alt ?? "")}"/>`;
  } else if (o.type === "Shape") {
    inner = `<div class="pb-ov-shape${o.shape === "ellipse" ? " is-ellipse" : ""}" style="background:${o.color}"></div>`;
  }
  return inner ? `<div class="pb-overlay" style="${style}">${inner}</div>` : "";
}

function baseCss(layout: LayoutInfo): string {
  return (
    `@page{size:${mm(layout.widthMm)} ${mm(layout.heightMm)};margin:0}` +
    "body{margin:0;background:#e5e7eb;color:#111827;font-family:Georgia,'Times New Roman',serif}" +
    `.pb-page{box-sizing:border-box;position:relative;background:#fff;width:${mm(layout.widthMm)};min-height:${mm(layout.heightMm)};padding:${mm(layout.marginMm)};margin:0 auto 12px;page-break-after:always;color:var(--doc-color-body,#111827);font-family:var(--doc-font-body,Georgia,'Times New Roman',serif);font-size:11pt;line-height:1.5}` +
    ".pb-page:last-child{page-break-after:auto;margin-bottom:0}" +
    ".pb-page-bg{position:absolute;inset:0;pointer-events:none}" +
    ".pb-block{position:relative;margin:0 0 8px}.pb-block:last-child{margin-bottom:0}" +
    ".pb-h1,.pb-h2,.pb-h3{font-family:var(--doc-font-heading,inherit);color:var(--doc-color-heading,inherit)}" +
    ".pb-h1{font-size:22pt;font-weight:700}.pb-h2{font-size:16pt;font-weight:700}.pb-h3{font-size:13pt;font-weight:700}" +
    ".pb-para{font-size:11pt;line-height:1.5}" +
    ".pb-spacer{width:100%}" +
    ".pb-img{display:block;max-width:100%;height:auto}.pb-img-wrap.align-center{text-align:center}.pb-img-wrap.align-right{text-align:right}" +
    ".pb-mind svg{display:block;width:100%;height:auto}" +
    ".pb-shape-rect{width:100%;border:1.5px solid currentColor}.pb-shape-rect.is-filled{background:currentColor;border:none}" +
    ".pb-shape-line{border-top:1.5px solid currentColor}.pb-shape-divider{border-top:1px solid var(--doc-color-accent,#d1d5db);margin:6px 0}" +
    ".pb-cols{display:flex;align-items:flex-start}.pb-col{flex:1 1 0;min-width:0;font-size:11pt}" +
    ".pb-overlay{position:absolute;box-sizing:border-box}.pb-ov-text{word-wrap:break-word}" +
    ".pb-ov-img{display:block;width:100%;height:auto}.pb-ov-shape{width:100%;height:100%}.pb-ov-shape.is-ellipse{border-radius:50%}" +
    ".pb-table{width:100%;border-collapse:collapse;font-size:10.5pt}.pb-table td,.pb-table th{border:1px solid #9ca3af;padding:4px 8px;text-align:left}.pb-table th{background:var(--doc-color-accent-soft,#f3f4f6);color:#111827}" +
    ".align-center{text-align:center}.align-right{text-align:right}.align-justify{text-align:justify}" +
    "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}"
  );
}

function pagesHtml(document: EditorDocument): string {
  const vars = themeVars(document.theme);
  return document.pages.map((p) => {
    const bg = p.background ?? document.theme?.pageBackground;
    const style = vars + (bg ? `background-color:${bg};` : "");
    const overlays = (p.overlays ?? []).map(overlayHtml).join("");
    return `<div class="pb-page" style="${style}">${pageBgLayer(p)}${p.blocks.map(blockHtml).join("")}${overlays}</div>`;
  }).join("");
}

/** Rendert ein (validiertes) Design als eigenständiges HTML-Dokument — identische
 * CSS-Regeln wie der HTML-Export der PWA, druckbar via Browser (@page-Größe). */
export function renderHtml(document: EditorDocument): string {
  const css = baseCss(layoutOf(document.layout));
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(document.title || "Dokument")}</title><style>${css}</style></head><body>${pagesHtml(document)}</body></html>`;
}

/** Interaktive Variante: Folien-Layouts (Slide16x9, >1 Seite) werden ein Deck mit
 * Navigation (Pfeiltasten/Buttons, eine Folie je Ansicht). Mindmaps bleiben als
 * statisches Vektor-SVG (serverseitig kein Live-d3 — die PWA hat das interaktive
 * Widget). Nicht zum Drucken — dynamische HTML-Präsentation. */
export function renderInteractiveHtml(document: EditorDocument): string {
  const layout = layoutOf(document.layout);
  const isDeck = layout.name === "Slide16x9" && document.pages.length > 1;
  let css = baseCss(layout);
  if (isDeck) {
    css +=
      "body{background:#1f2937}" +
      ".pb-page{display:none;page-break-after:auto;box-shadow:0 12px 48px rgba(0,0,0,.45)}" +
      ".pb-page.active{display:block}" +
      ".deck-nav{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;align-items:center;gap:18px;padding:10px;background:rgba(17,24,39,.9);color:#fff;font-family:system-ui,sans-serif;z-index:50}" +
      ".deck-nav button{font:inherit;cursor:pointer;border:1px solid #6b7280;background:#374151;color:#fff;border-radius:8px;padding:6px 18px;font-size:18px;line-height:1}" +
      ".deck-nav button:disabled{opacity:.4;cursor:default}" +
      "@media print{.deck-nav{display:none}.pb-page{display:block !important}}";
  }
  const nav = isDeck
    ? `<div class="deck-nav"><button id="deck-prev" aria-label="prev">&#8249;</button><span id="deck-counter"></span><button id="deck-next" aria-label="next">&#8250;</button></div>`
      + `<script>(function(){var s=[].slice.call(document.querySelectorAll('.pb-page'));if(!s.length)return;var i=0;var c=document.getElementById('deck-counter');var p=document.getElementById('deck-prev'),n=document.getElementById('deck-next');function show(x){i=Math.max(0,Math.min(s.length-1,x));s.forEach(function(e,k){e.classList.toggle('active',k===i);});c.textContent=(i+1)+' / '+s.length;p.disabled=i===0;n.disabled=i===s.length-1;}p.onclick=function(){show(i-1);};n.onclick=function(){show(i+1);};document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();show(i+1);}if(e.key==='ArrowLeft')show(i-1);});show(0);})();</script>`
    : "";
  const bodyClass = isDeck ? ' class="pb-deck"' : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(document.title || "Dokument")}</title><style>${css}</style></head><body${bodyClass}>${pagesHtml(document)}${nav}</body></html>`;
}
