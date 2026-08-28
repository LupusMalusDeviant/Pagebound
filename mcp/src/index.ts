#!/usr/bin/env node
// =============================================================================
// pagebound-pdf-mcp-server — Pagebound's PDF operations as an MCP server.
//
// Two transports, same tools:
//   • stdio (Default)        — lokaler Unterprozess, tokenlos. Datei-Pfad-I/O bequem.
//   • http  (MCP_TRANSPORT=http) — gehostet/„released", Streamable HTTP unter /mcp,
//                                  tokenlos + Größen-/Seiten-Limits. base64-I/O.
//
// Jedes Tool nimmt die Eingabe entweder als lokalen `path` ODER inline `dataBase64`
// und gibt das Ergebnis nach `outputPath` (geschrieben) ODER als `dataBase64` zurück.
// Engines: pdf-lib + pdfjs-dist (wie die Web-App). Keine nativen Deps, kein Netz.
// =============================================================================
//
// CRITICAL: stdio spricht JSON-RPC auf STDOUT. Jede Fremd-Ausgabe (z. B. pdfjs-
// Warnung) korrumpiert das Protokoll → alle console.* auf STDERR umleiten.
for (const k of ["log", "info", "debug", "warn"] as const) {
  console[k] = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
}

import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import * as pdf from "./pdf.js";
import * as design from "./design.js";
import * as designPdf from "./design-pdf.js";
import * as designData from "./design-data.js";
import * as ocr from "./ocr.js";
import * as pdfa from "./pdfa.js";
import * as pdfua from "./pdfua.js";
import * as sign from "./sign.js";
import { encryptPdf } from "./encrypt.js";

const CHARACTER_LIMIT = 25_000;

// Größenlimit je Eingabedatei (PDF, Bild, Zertifikat, Anhang). Der Container
// setzt es per MCP_MAX_PDF_BYTES; 25 MB ist der Default für den lokalen Betrieb.
const MAX_PDF_BYTES = Number(process.env.MCP_MAX_PDF_BYTES) || 25 * 1024 * 1024;

// Das HTTP-Body-Limit wird daraus ABGELEITET statt separat gepflegt (die beiden
// Zahlen waren auseinandergelaufen): base64 bläht um 4/3 auf, dazu der
// JSON-RPC-Rahmen und mehrere Dateien in einem Aufruf.
const HTTP_BODY_LIMIT = `${Math.ceil((MAX_PDF_BYTES * 4) / 3 / 1048576) + 8}mb`;

/**
 * Serverversion aus der package.json — eine Quelle statt zweier (die beiden
 * Zahlen standen vorher auf 1.6.0 und 1.5.0). Aufrufer pinnen darauf; jede
 * Verhaltensänderung bekommt eine neue Version (siehe README).
 */
function readServerVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch { /* unten ehrlich melden statt eine Zahl zu erfinden */ }
  return "0.0.0-unknown";
}
const SERVER_VERSION = readServerVersion();

// --- I/O resolution (path OR base64) -----------------------------------------

function enforceSize(bytes: Uint8Array, what = "PDF"): Uint8Array {
  if (bytes.length > MAX_PDF_BYTES) {
    throw new pdf.ToolError(`${what} ist ${(bytes.length / 1048576).toFixed(1)} MB groß — Limit sind ${(MAX_PDF_BYTES / 1048576).toFixed(0)} MB.`, "INPUT_TOO_LARGE");
  }
  return bytes;
}

async function loadPdf(args: { path?: string; dataBase64?: string }): Promise<Uint8Array> {
  if (args.path && args.dataBase64) throw new pdf.ToolError("Bitte entweder 'path' ODER 'dataBase64' angeben, nicht beide.");
  if (args.dataBase64) return enforceSize(b64ToBytes(args.dataBase64));
  if (args.path) {
    try {
      return enforceSize(new Uint8Array(await readFile(args.path)));
    } catch (e) {
      throw new pdf.ToolError(`Datei nicht lesbar: '${args.path}' (${e instanceof Error ? e.message : String(e)}).`, "FILE_READ");
    }
  }
  throw new pdf.ToolError("Eingabe fehlt: 'path' (lokal) oder 'dataBase64' (remote) angeben.");
}

async function loadPdfList(paths?: string[], list?: string[]): Promise<Uint8Array[]> {
  if (list && list.length) return list.map((b) => enforceSize(b64ToBytes(b)));
  if (paths && paths.length) return Promise.all(paths.map((p) => loadPdf({ path: p })));
  throw new pdf.ToolError("Eingabe fehlt: 'paths' (lokal) oder 'dataBase64List' (remote) angeben.");
}

async function loadImages(paths?: string[], list?: string[]): Promise<Uint8Array[]> {
  if (list && list.length) return list.map((b) => enforceSize(b64ToBytes(b), "Bild"));
  if (paths && paths.length) {
    return Promise.all(paths.map(async (p) => {
      try { return enforceSize(new Uint8Array(await readFile(p)), "Bild"); }
      catch (e) { throw new pdf.ToolError(`Bild nicht lesbar: '${p}' (${e instanceof Error ? e.message : String(e)}).`, "FILE_READ"); }
    }));
  }
  throw new pdf.ToolError("Eingabe fehlt: 'imagePaths' (lokal) oder 'imagesBase64' (remote) angeben.");
}

async function emitPdf(bytes: Uint8Array, outputPath?: string): Promise<Record<string, unknown>> {
  if (outputPath) {
    try { await writeFile(outputPath, bytes); }
    catch (e) { throw new pdf.ToolError(`Ausgabe nicht schreibbar: '${outputPath}' (${e instanceof Error ? e.message : String(e)}).`, "FILE_WRITE"); }
    return { outputPath, bytes: bytes.length };
  }
  return { dataBase64: bytesToB64(bytes), bytes: bytes.length };
}

// Emittiert mehrere Ergebnis-PDFs (Split). Mit `outputDir` werden Dateien
// `<baseName>-part1.pdf` … geschrieben (stdio); sonst kommen sie als base64 zurück.
async function emitParts(
  parts: Uint8Array[],
  pageCounts: number[],
  outputDir?: string,
  baseName = "part"
): Promise<Record<string, unknown>> {
  if (outputDir) {
    const outputPaths: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const file = path.join(outputDir, `${baseName}-part${i + 1}.pdf`);
      try { await writeFile(file, parts[i]); }
      catch (e) { throw new pdf.ToolError(`Teil ${i + 1} nicht schreibbar: '${file}' (${e instanceof Error ? e.message : String(e)}).`, "FILE_WRITE"); }
      outputPaths.push(file);
    }
    return { partCount: parts.length, pageCounts, outputPaths };
  }
  return {
    partCount: parts.length,
    parts: parts.map((b, i) => ({ pageCount: pageCounts[i], bytes: b.length, dataBase64: bytesToB64(b) })),
  };
}

const b64ToBytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));
const bytesToB64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");

// --- response helpers --------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const ok = (s: Record<string, unknown>, summary: string): ToolResult => ({ content: [{ type: "text", text: summary }], structuredContent: s });
/**
 * Fehlerantwort mit maschinenlesbarer Kennung. Der Code steht im
 * structuredContent (für Programme) UND im Text (für Agenten und Logs) —
 * siehe ToolErrorCode in pdf.ts für die Bedeutung der Kennungen.
 */
const fail = (m: string, code: pdf.ToolErrorCode): ToolResult => ({
  content: [{ type: "text", text: `Fehler [${code}]: ${m}` }],
  structuredContent: { error: { code, message: m } },
  isError: true,
});

function guard<T>(handler: (args: T) => Promise<ToolResult>) {
  return async (args: T): Promise<ToolResult> => {
    try { return await handler(args); }
    catch (e) {
      if (e instanceof pdf.ToolError) return fail(e.message, e.code);
      // Alles Unerwartete ist ein Fehler in Pagebound, nicht in der Eingabe.
      console.error("Unerwarteter Fehler:", e);
      return fail(`Unerwarteter Fehler: ${e instanceof Error ? e.message : String(e)}`, "INTERNAL");
    }
  };
}

const writeAnn = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const readAnn = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Wiederverwendbare I/O-Felder. Eingabe: path ODER dataBase64. Ausgabe: outputPath ODER (Default) dataBase64.
const srcIn = {
  path: z.string().optional().describe("Lokaler Pfad zur Quell-PDF (stdio-Modus)."),
  dataBase64: z.string().optional().describe("Quell-PDF als base64 (remote/HTTP-Modus)."),
};
const outOpt = {
  outputPath: z.string().optional().describe("Wenn gesetzt: Ergebnis dorthin schreiben; sonst als 'dataBase64' zurückgeben."),
};

// --- tool registration -------------------------------------------------------

function registerTools(server: McpServer): void {
  server.registerTool("pdf_info", {
    title: "PDF-Infos",
    description: `Metadaten einer PDF: Seitenzahl, Titel/Autor, Seitengrößen in Punkt. Read-only.
Eingabe: 'path' (lokal) oder 'dataBase64' (remote).
Returns: { pageCount, title?, author?, pages: [{ page, widthPt, heightPt }] }.`,
    inputSchema: { ...srcIn },
    annotations: readAnn,
  }, guard(async (a: { path?: string; dataBase64?: string }) => {
    const info = await pdf.getInfo(await loadPdf(a));
    return ok(info as unknown as Record<string, unknown>, `${info.pageCount} Seite(n)${info.title ? `, Titel: ${info.title}` : ""}.`);
  }));

  server.registerTool("pdf_extract_text", {
    title: "PDF-Text extrahieren",
    description: `Extrahiert den Text-Layer (kein OCR — für echte Text-PDFs, nicht für reine Scans). Optional pro Seitenauswahl.
Meldet zusätzlich, WIE VIEL die Textebene hergab: 'charsPerPage' und 'pagesWithoutText' (Seiten mit praktisch keinem Text, unter 20 Zeichen). Damit kann der Aufrufer selbst entscheiden, ob er auf 'pdf_ocr' ausweicht — automatisch geschieht das NICHT, weil OCR um Größenordnungen teurer ist.
Eingabe: 'path'/'dataBase64', optional 'pages' (z. B. "1-3,5").
Returns: { pageCount, totalChars, charsPerPage, pagesWithoutText, pages: [{ page, text }] }. Text wird bei ~25k Zeichen gekürzt.`,
    inputSchema: { ...srcIn, pages: z.string().optional().describe('Seitenauswahl, z. B. "1-3,5" (Default: alle).') },
    annotations: readAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; pages?: string }) => {
    const res = await pdf.extractText(await loadPdf(a), a.pages);
    let text = res.pages.map((p) => `--- Seite ${p.page} ---\n${p.text}`).join("\n\n");
    let truncated = false;
    if (text.length > CHARACTER_LIMIT) { text = text.slice(0, CHARACTER_LIMIT) + `\n\n[gekürzt — 'pages' einschränken]`; truncated = true; }
    // Ergiebigkeit der Textebene je Seite. Unter 20 Zeichen ist eine Seite
    // praktisch leer — typisch für einen Scan ohne Textebene.
    const charsPerPage = res.pages.map((p) => ({ page: p.page, chars: p.text.length }));
    const pagesWithoutText = charsPerPage.filter((p) => p.chars < 20).map((p) => p.page);
    const hint = pagesWithoutText.length
      ? `\n\n[${pagesWithoutText.length} von ${charsPerPage.length} Seite(n) ohne nennenswerten Text: ${pagesWithoutText.join(", ")} — falls es Scans sind, liefert pdf_ocr dort Text.]`
      : "";
    return ok(
      { pageCount: res.pageCount, totalChars: res.totalChars, charsPerPage, pagesWithoutText, truncated, pages: res.pages },
      (text || "(kein extrahierbarer Text — evtl. Scan ohne Text-Layer)") + hint,
    );
  }));

  server.registerTool("pdf_ocr", {
    title: "Gescannte PDF per OCR lesen",
    description: `Erkennt Text auf GESCANNTEN Seiten — dort, wo 'pdf_extract_text' nichts findet, weil es keine Textebene gibt. Läuft kopflos: kein Browser, kein Canvas, keine native Abhängigkeit, kein Netzzugriff.
SO ARBEITET ES: eine gescannte Seite besteht fast immer aus genau einem Bild. Dieses Bild wird dekodiert (pdfjs, reines JS — deckt Flate, JPEG, CCITT, JBIG2 und JPX ab) und an Tesseract gegeben. Gerastert wird NICHT, das Seitenbild wird unverändert genommen.
KONFIDENZ: jede Seite liefert 'confidence' (0..100), dazu 'meanConfidence' über alle Seiten. Der Wert gehört zum Ergebnis — an ihm entscheidet der Aufrufer, ob er dem Text traut. Unter 70 % meldet 'warnings' das ausdrücklich.
Mit 'words': true kommen zusätzlich die Wort-Koordinaten (Bounding-Box in Bildpixeln, relativ zu 'imageWidth'/'imageHeight'), um Werte später nach Position zuzuordnen. Wörter unter 60 % Konfidenz werden dabei weggelassen.
EHRLICHE GRENZEN: mitgeliefert sind nur 'deu' und 'eng' — der Server lädt bewusst nichts nach. Erkannt wird je Seite das GRÖSSTE Bild; Seiten aus mehreren Bildstreifen werden nur teilweise erfasst (wird gemeldet). Seiten ohne Bild liefern leeren Text statt erfundener Wörter. OCR ist um Größenordnungen teurer als 'pdf_extract_text' — es gibt deshalb KEINEN automatischen Rückfall.
Eingabe: 'path'/'dataBase64', optional 'pages', 'languages' (Default "deu+eng"), 'words'.
Returns: { pages: [{ page, text, confidence, imageWidth, imageHeight, words? }], meanConfidence, warnings }.`,
    inputSchema: {
      ...srcIn,
      pages: z.string().optional().describe('Seitenauswahl, z. B. "1-3,5" (Default: alle).'),
      languages: z.string().optional().describe('Tesseract-Sprachen, mitgeliefert sind "deu" und "eng"; kombinierbar als "deu+eng" (Default).'),
      words: z.boolean().optional().describe("Wort-Koordinaten mitliefern (Bounding-Box in Bildpixeln, Default: false)."),
    },
    annotations: readAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; pages?: string; languages?: string; words?: boolean }) => {
    const r = await ocr.ocrPdf(await loadPdf(a), { pages: a.pages, languages: a.languages, words: a.words });
    const body = r.pages
      .map((p) => `--- Seite ${p.page} (Konfidenz ${p.confidence} %) ---\n${p.text || "(kein Text erkannt)"}`)
      .join("\n\n");
    let text = body;
    let truncated = false;
    if (text.length > CHARACTER_LIMIT) {
      text = text.slice(0, CHARACTER_LIMIT) + "\n\n[gekürzt — 'pages' einschränken]";
      truncated = true;
    }
    const summary = r.warnings.length
      ? `${text}\n\nHinweise:\n- ${r.warnings.join("\n- ")}`
      : text;
    return ok(
      { pages: r.pages, meanConfidence: r.meanConfidence, warnings: r.warnings, truncated },
      summary || "(keine Seiten verarbeitet)",
    );
  }));

  server.registerTool("pdf_extract_tables", {
    title: "Tabellen als CSV extrahieren",
    description: `Best-Effort-Tabellen-Extraktion (Heuristik auf Text-Positionen, KEIN OCR/ML): Zeilen über y-Cluster, Spalten über horizontale Lücken. Gut bei tabellarischen Layouts, bei Fließtext erwartungsgemäß grob.
Eingabe: 'path'/'dataBase64', optional 'pages' (z. B. "1-3,5"). Returns: { pageCount, csv }. CSV wird bei ~25k Zeichen gekürzt.`,
    inputSchema: { ...srcIn, pages: z.string().optional().describe('Seitenauswahl, z. B. "1-3,5" (Default: alle).') },
    annotations: readAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; pages?: string }) => {
    const res = await pdf.extractTablesCsv(await loadPdf(a), a.pages);
    let csv = res.csv;
    let truncated = false;
    if (csv.length > CHARACTER_LIMIT) { csv = csv.slice(0, CHARACTER_LIMIT) + `\n[gekürzt — 'pages' einschränken]`; truncated = true; }
    return ok({ pageCount: res.pageCount, truncated, csv }, csv || "(keine Tabellendaten erkannt)");
  }));

  server.registerTool("pdf_to_docx", {
    title: "PDF → Word (DOCX)",
    description: `Konvertiert eine PDF in ein Word-Dokument (.docx) — Best-Effort-Textfluss (Absätze rekonstruiert, Schriftgröße abgeleitet, Seitenumbruch je Seite), KEINE 1:1-Layout-Treue. Für pixelgenaue Ausgabe eignen sich Bild-/HTML-Exporte besser. Kein OCR.
Eingabe: 'path'/'dataBase64'. Ausgabe: 'outputPath' (z. B. "out.docx") oder 'dataBase64'. Returns: { pageCount, ... }.`,
    inputSchema: { ...srcIn, ...outOpt },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; outputPath?: string }) => {
    const r = await pdf.toDocx(await loadPdf(a));
    return ok({ pageCount: r.pageCount, ...(await emitPdf(r.bytes, a.outputPath)) }, `PDF → DOCX: ${r.pageCount} Seite(n) (Best-Effort-Textfluss).`);
  }));

  server.registerTool("pdf_edit_text", {
    title: "Text ersetzen (Suchen & Ersetzen)",
    description: `Ersetzt Text im PDF per Suchen & Ersetzen (Cover + Redraw): Zeilen, die ein 'find' enthalten, werden opak übermalt und mit 'find'→'replace' in Helvetica neu gezeichnet. KEIN Reflow, keine Font-Treue. Hinweis: der ursprüngliche Text bleibt technisch im Content-Stream (übermalt, weiterhin extrahierbar) — für garantierte Entfernung ist Schwärzung/Rasterung nötig.
Eingabe: 'path'/'dataBase64', 'replacements' (≥1 Paar), optional 'pages'/'color'/'bgColor'. Ausgabe: 'outputPath' oder 'dataBase64'. Returns: { replaced, ... }.`,
    inputSchema: {
      ...srcIn,
      replacements: z.array(z.object({
        find: z.string().min(1).describe("Zu findender Text (Teilstring einer Zeile)."),
        replace: z.string().describe("Ersatztext (darf leer sein = übermalen/entfernen)."),
      })).min(1).describe("Liste der Suchen-&-Ersetzen-Paare."),
      pages: z.string().optional().describe('Seitenauswahl, z. B. "1-3,5" (Default: alle).'),
      color: z.string().optional().describe('Textfarbe als Hex, z. B. "#111111" (Default: fast-schwarz).'),
      bgColor: z.string().optional().describe('Cover-/Hintergrundfarbe als Hex (Default: "#ffffff").'),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; replacements: pdf.TextReplacement[]; pages?: string; color?: string; bgColor?: string; outputPath?: string }) => {
    const r = await pdf.applyTextReplacements(await loadPdf(a), a.replacements, { pages: a.pages, color: a.color, bgColor: a.bgColor });
    return ok({ replaced: r.replaced, ...(await emitPdf(r.bytes, a.outputPath)) },
      r.replaced ? `${r.replaced} Zeile(n) ersetzt (Cover + Redraw). Alt-Text bleibt technisch extrahierbar.` : "Kein Treffer — nichts geändert.");
  }));

  server.registerTool("pdf_merge", {
    title: "PDFs zusammenführen",
    description: `Fügt mehrere PDFs in Reihenfolge zu einer zusammen.
Eingabe: 'paths' (lokal) oder 'dataBase64List' (remote), je ≥2.
Ausgabe: 'outputPath' oder 'dataBase64'. Returns: { pageCount, ... }.`,
    inputSchema: {
      paths: z.array(z.string()).optional().describe("≥2 lokale PDF-Pfade in Reihenfolge."),
      dataBase64List: z.array(z.string()).optional().describe("≥2 PDFs als base64 in Reihenfolge."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { paths?: string[]; dataBase64List?: string[]; outputPath?: string }) => {
    const r = await pdf.merge(await loadPdfList(a.paths, a.dataBase64List));
    return ok({ pageCount: r.pageCount, ...(await emitPdf(r.bytes, a.outputPath)) }, `Zusammengeführt: ${r.pageCount} Seiten.`);
  }));

  server.registerTool("pdf_extract_pages", {
    title: "Seiten extrahieren",
    description: `Kopiert ausgewählte Seiten (in angegebener Reihenfolge) in eine neue PDF — auch zum Splitten.
Eingabe: 'path'/'dataBase64', 'pages' (z. B. "1-3,5" oder "3,1,2"). Ausgabe: 'outputPath' oder 'dataBase64'.`,
    inputSchema: { ...srcIn, pages: z.string().min(1).describe('Seiten/Bereiche, z. B. "1-3,5".'), ...outOpt },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; pages: string; outputPath?: string }) => {
    const r = await pdf.extractPages(await loadPdf(a), a.pages);
    return ok({ pageCount: r.pageCount, ...(await emitPdf(r.bytes, a.outputPath)) }, `Extrahiert: ${r.pageCount} Seiten.`);
  }));

  server.registerTool("pdf_delete_pages", {
    title: "Seiten löschen",
    description: `Entfernt die angegebenen Seiten; Rest bleibt in Originalreihenfolge.
Eingabe: 'path'/'dataBase64', 'pages' (z. B. "2,4-6"). Ausgabe: 'outputPath' oder 'dataBase64'.`,
    inputSchema: { ...srcIn, pages: z.string().min(1).describe('Zu löschende Seiten, z. B. "2,4-6".'), ...outOpt },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; pages: string; outputPath?: string }) => {
    const r = await pdf.deletePages(await loadPdf(a), a.pages);
    return ok({ pageCount: r.pageCount, deleted: r.deleted, ...(await emitPdf(r.bytes, a.outputPath)) }, `${r.deleted} gelöscht, ${r.pageCount} übrig.`);
  }));

  server.registerTool("pdf_rotate_pages", {
    title: "Seiten drehen",
    description: `Dreht ausgewählte Seiten um ein Vielfaches von 90° (additiv).
Eingabe: 'path'/'dataBase64', 'pages', 'degrees' (z. B. 90, -90, 180). Ausgabe: 'outputPath' oder 'dataBase64'.`,
    inputSchema: { ...srcIn, pages: z.string().min(1).describe('Zu drehende Seiten, z. B. "1-3".'), degrees: z.number().int().describe("Vielfaches von 90."), ...outOpt },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; pages: string; degrees: number; outputPath?: string }) => {
    const r = await pdf.rotatePages(await loadPdf(a), a.pages, a.degrees);
    return ok({ rotated: r.rotated, ...(await emitPdf(r.bytes, a.outputPath)) }, `${r.rotated} Seite(n) um ${a.degrees}° gedreht.`);
  }));

  server.registerTool("pdf_reorder_pages", {
    title: "Seiten neu anordnen",
    description: `Ordnet die Seiten gemäß vollständiger 1-basierter Reihenfolge neu an (jede Seite genau einmal).
Eingabe: 'path'/'dataBase64', 'order' (z. B. [3,1,2]). Ausgabe: 'outputPath' oder 'dataBase64'.`,
    inputSchema: { ...srcIn, order: z.array(z.number().int().positive()).min(1).describe("Vollständige neue Reihenfolge, 1-basiert."), ...outOpt },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; order: number[]; outputPath?: string }) => {
    const r = await pdf.reorderPages(await loadPdf(a), a.order);
    return ok({ pageCount: r.pageCount, ...(await emitPdf(r.bytes, a.outputPath)) }, `Neu angeordnet: ${r.pageCount} Seiten.`);
  }));

  server.registerTool("images_to_pdf", {
    title: "Bilder → PDF",
    description: `Erzeugt aus PNG/JPG-Bildern eine PDF (eine Seite je Bild, in Reihenfolge).
Eingabe: 'imagePaths' (lokal) oder 'imagesBase64' (remote). 'pageSize': 'image'|'a4'|'letter'.
Ausgabe: 'outputPath' oder 'dataBase64'.`,
    inputSchema: {
      imagePaths: z.array(z.string()).optional().describe("PNG/JPG-Pfade in Reihenfolge."),
      imagesBase64: z.array(z.string()).optional().describe("PNG/JPG als base64 in Reihenfolge."),
      pageSize: z.enum(["image", "a4", "letter"]).default("image").describe("Seitengröße."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { imagePaths?: string[]; imagesBase64?: string[]; pageSize: pdf.PageSizeMode; outputPath?: string }) => {
    const r = await pdf.imagesToPdf(await loadImages(a.imagePaths, a.imagesBase64), a.pageSize);
    return ok({ pageCount: r.pageCount, ...(await emitPdf(r.bytes, a.outputPath)) }, `${r.pageCount} Bild-Seite(n) erzeugt.`);
  }));

  server.registerTool("pdf_split", {
    title: "PDF aufteilen",
    description: `Teilt eine PDF in mehrere Teil-PDFs an Seiten-Schnittpunkten — nach jeder genannten Seite beginnt ein neuer Teil.
Eingabe: 'path'/'dataBase64', 'afterPages' (z. B. "3,5" bei 8 Seiten → 1-3, 4-5, 6-8).
Ausgabe: 'outputDir' (schreibt '<baseName>-part1.pdf' …) ODER (Default) ein Array 'parts' mit je 'dataBase64'.`,
    inputSchema: {
      ...srcIn,
      afterPages: z.string().min(1).describe('Schnittpunkte als 1-basierte Seitenangabe, z. B. "3,5" oder "2-4".'),
      outputDir: z.string().optional().describe("Wenn gesetzt: Teile dorthin schreiben (stdio); sonst als 'parts[].dataBase64' zurückgeben."),
      baseName: z.string().optional().describe("Dateinamen-Stamm für die Teile (Default: 'part')."),
    },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; afterPages: string; outputDir?: string; baseName?: string }) => {
    const r = await pdf.split(await loadPdf(a), a.afterPages);
    return ok(await emitParts(r.parts, r.pageCounts, a.outputDir, a.baseName), `In ${r.parts.length} Teile aufgeteilt (${r.pageCounts.join("+")} Seiten).`);
  }));

  server.registerTool("pdf_stamp", {
    title: "Stempeln (Wasserzeichen / Seitenzahlen)",
    description: `Stempelt ein diagonales Text-Wasserzeichen (45°, halbtransparent) und/oder Seitenzahlen/Bates auf jede Seite.
Eingabe: 'path'/'dataBase64', mindestens 'watermarkText' ODER 'pageNumbers:true'.
Seitenzahl-Format z. B. "{n} / {total}" oder "Bates {n}"; Position unten links/mitte/rechts. Ausgabe: 'outputPath' oder 'dataBase64'.`,
    inputSchema: {
      ...srcIn,
      watermarkText: z.string().optional().describe("Diagonales Wasserzeichen (optional)."),
      pageNumbers: z.boolean().optional().describe("Seitenzahlen/Bates aufstempeln (Default: false)."),
      pageNumberFormat: z.string().optional().describe('Format, z. B. "{n} / {total}" (Default) oder "Bates {n}".'),
      pageNumberPosition: z.enum(["bottom-center", "bottom-right", "bottom-left"]).optional().describe("Position der Seitenzahl (Default: bottom-center)."),
      pageNumberStartAt: z.number().int().optional().describe("Startnummer für die erste Seite (Default: 1)."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; watermarkText?: string; pageNumbers?: boolean; pageNumberFormat?: string; pageNumberPosition?: pdf.PageNumberPosition; pageNumberStartAt?: number; outputPath?: string }) => {
    const r = await pdf.stamp(await loadPdf(a), {
      watermarkText: a.watermarkText,
      pageNumbers: a.pageNumbers,
      pageNumberFormat: a.pageNumberFormat,
      pageNumberPosition: a.pageNumberPosition,
      pageNumberStartAt: a.pageNumberStartAt,
    });
    return ok({ pageCount: r.pageCount, ...(await emitPdf(r.bytes, a.outputPath)) }, `${r.pageCount} Seite(n) gestempelt.`);
  }));

  server.registerTool("pdf_encrypt", {
    title: "PDF verschlüsseln (Passwort)",
    description: `Schützt eine PDF mit AES-256 (ISO 32000-2, R6) — das Dokument lässt sich danach nur mit Passwort öffnen.
Eingabe: 'path'/'dataBase64', 'password' (zum Öffnen). Optional 'ownerPassword' (Rechte-Passwort; Default = 'password').
Ausgabe: 'outputPath' oder 'dataBase64'. Hinweis: bereits verschlüsselte PDFs zuerst entschlüsseln.`,
    inputSchema: {
      ...srcIn,
      password: z.string().min(1).describe("Benutzer-/Öffnen-Passwort."),
      ownerPassword: z.string().optional().describe("Optionales Owner-/Rechte-Passwort (Default = 'password')."),
      ...outOpt,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, guard(async (a: { path?: string; dataBase64?: string; password: string; ownerPassword?: string; outputPath?: string }) => {
    const bytes = await encryptPdf(await loadPdf(a), a.password, a.ownerPassword);
    return ok({ ...(await emitPdf(bytes, a.outputPath)) }, "PDF verschlüsselt (AES-256). Öffnen nur mit Passwort.");
  }));

  server.registerTool("pdf_form_fields", {
    title: "Formularfelder lesen",
    description: `Listet die AcroForm-Felder einer PDF (Text/Checkbox/Radio/Dropdown/ListBox) mit aktuellen Werten, Optionen, read-only/required und Seitenzahl. Read-only.
Eingabe: 'path'/'dataBase64'. Returns: { fieldCount, fields: [{ name, type, value, options, readOnly, required, pageNumber }] }.`,
    inputSchema: { ...srcIn },
    annotations: readAnn,
  }, guard(async (a: { path?: string; dataBase64?: string }) => {
    const fields = await pdf.getFormFields(await loadPdf(a));
    return ok({ fieldCount: fields.length, fields }, fields.length ? `${fields.length} Formularfeld(er).` : "Keine AcroForm-Felder gefunden.");
  }));

  server.registerTool("pdf_fill_form", {
    title: "Formular ausfüllen",
    description: `Setzt Werte in AcroForm-Felder und speichert. Optional 'flatten' (Werte fixieren, Felder nicht mehr editierbar).
Werte je Feld als String-Array: Text/Radio/Dropdown 1 Wert, Checkbox ["true"] zum Ankreuzen / [] zum Leeren, ListBox 0..n.
Eingabe: 'path'/'dataBase64', 'values'. Ausgabe: 'outputPath' oder 'dataBase64'. Unbekannte Felder werden in 'skipped' gemeldet.`,
    inputSchema: {
      ...srcIn,
      values: z.array(z.object({
        name: z.string().describe("Feldname (siehe pdf_form_fields)."),
        value: z.array(z.string()).describe('Werte; Checkbox ["true"]/[] , Text/Radio/Dropdown 1 Wert, ListBox 0..n.'),
      })).min(1).describe("Zu setzende Feldwerte."),
      flatten: z.boolean().optional().describe("Felder nach dem Ausfüllen einbrennen (nicht mehr editierbar). Default: false."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; values: pdf.FormFieldValue[]; flatten?: boolean; outputPath?: string }) => {
    const r = await pdf.fillForm(await loadPdf(a), a.values, !!a.flatten);
    const note = r.skipped.length ? ` (${r.skipped.length} übersprungen: ${r.skipped.join(", ")})` : "";
    return ok({ filled: r.filled, skipped: r.skipped, ...(await emitPdf(r.bytes, a.outputPath)) }, `${r.filled} Feld(er) ausgefüllt${a.flatten ? " + eingebrannt" : ""}${note}.`);
  }));

  server.registerTool("pdf_diff", {
    title: "PDFs vergleichen (Text-Diff)",
    description: `Vergleicht den Text-Layer zweier PDFs seitenweise (zeilenbasierter Diff) — um Versionsänderungen zu finden ("was hat sich von A zu B geändert?"). Read-only, kein OCR (nutzt den vorhandenen Text-Layer).
Eingabe: A als 'pathA'/'dataBase64A', B als 'pathB'/'dataBase64B'.
Returns: { changed, pageCountA, pageCountB, addedLines, removedLines, pages: [{ page, added[], removed[] }] }. Ausgabe wird bei ~25k Zeichen gekürzt.`,
    inputSchema: {
      pathA: z.string().optional().describe("Lokaler Pfad zur PDF A (stdio)."),
      dataBase64A: z.string().optional().describe("PDF A als base64 (remote)."),
      pathB: z.string().optional().describe("Lokaler Pfad zur PDF B (stdio)."),
      dataBase64B: z.string().optional().describe("PDF B als base64 (remote)."),
    },
    annotations: readAnn,
  }, guard(async (a: { pathA?: string; dataBase64A?: string; pathB?: string; dataBase64B?: string }) => {
    const [bytesA, bytesB] = await Promise.all([
      loadPdf({ path: a.pathA, dataBase64: a.dataBase64A }),
      loadPdf({ path: a.pathB, dataBase64: a.dataBase64B }),
    ]);
    const r = await pdf.diffText(bytesA, bytesB);
    const summary = r.changed
      ? `${r.pages.length} Seite(n) geändert: +${r.addedLines} / −${r.removedLines} Zeile(n).`
      : "Kein Text-Unterschied gefunden.";
    const detail = r.pages
      .map((pg) => {
        const rem = pg.removed.map((l) => `- ${l}`).join("\n");
        const add = pg.added.map((l) => `+ ${l}`).join("\n");
        return `--- Seite ${pg.page} ---\n${[rem, add].filter(Boolean).join("\n")}`;
      })
      .join("\n\n");
    let text = detail ? `${summary}\n\n${detail}` : summary;
    if (text.length > CHARACTER_LIMIT) text = text.slice(0, CHARACTER_LIMIT) + "\n\n[gekürzt]";
    return ok(r as unknown as Record<string, unknown>, text);
  }));

  server.registerTool("pdf_set_metadata", {
    title: "Metadaten setzen",
    description: `Setzt Dokument-Metadaten (nur die übergebenen Felder): Titel, Autor, Betreff, Schlagwörter, Ersteller, Producer.
Eingabe: 'path'/'dataBase64' + mindestens ein Feld. Ausgabe: 'outputPath' oder 'dataBase64'.`,
    inputSchema: {
      ...srcIn,
      title: z.string().optional().describe("Dokumenttitel."),
      author: z.string().optional().describe("Autor."),
      subject: z.string().optional().describe("Betreff."),
      keywords: z.array(z.string()).optional().describe("Schlagwörter."),
      creator: z.string().optional().describe("Erstellende Anwendung."),
      producer: z.string().optional().describe("Producer."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; title?: string; author?: string; subject?: string; keywords?: string[]; creator?: string; producer?: string; outputPath?: string }) => {
    const r = await pdf.setMetadata(await loadPdf(a), { title: a.title, author: a.author, subject: a.subject, keywords: a.keywords, creator: a.creator, producer: a.producer });
    return ok({ applied: r.applied, ...(await emitPdf(r.bytes, a.outputPath)) }, `Metadaten gesetzt: ${r.applied.join(", ")}.`);
  }));

  server.registerTool("pdf_create_field", {
    title: "Formularfelder anlegen",
    description: `Legt AcroForm-Felder (Text/Checkbox) an — Einstieg in die Formular-Erstellung.
Positionen in PDF-Punkten, Ursprung UNTEN-links (pdf-lib-Konvention; 1 Punkt = 1/72 Zoll, A4 = 595×842 pt).
Eingabe: 'path'/'dataBase64', 'fields'. Ausgabe: 'outputPath' oder 'dataBase64'. Danach via pdf_form_fields prüfbar.`,
    inputSchema: {
      ...srcIn,
      fields: z.array(z.object({
        name: z.string().describe("Eindeutiger Feldname."),
        type: z.enum(["text", "checkbox"]).describe("Feldtyp."),
        page: z.number().int().positive().describe("1-basierte Seitenzahl."),
        x: z.number().describe("X in Punkten (unten-links)."),
        y: z.number().describe("Y in Punkten (unten-links)."),
        width: z.number().positive().describe("Breite in Punkten."),
        height: z.number().positive().describe("Höhe in Punkten."),
        value: z.string().optional().describe('Text: Vorbelegung; Checkbox: "true"/"on" = angehakt.'),
      })).min(1).describe("Anzulegende Felder."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; fields: pdf.NewField[]; outputPath?: string }) => {
    const r = await pdf.createFields(await loadPdf(a), a.fields);
    return ok({ created: r.created, ...(await emitPdf(r.bytes, a.outputPath)) }, `${r.created} Feld(er) angelegt.`);
  }));

  // Anhang für PDF/A-3: Inhalt entweder als lokaler Pfad ODER inline base64.
  const attachmentIn = z.object({
    name: z.string().describe("Dateiname im PDF (/F und /UF), z. B. 'factur-x.xml'."),
    path: z.string().optional().describe("Lokaler Pfad zur Datei (stdio-Modus)."),
    dataBase64: z.string().optional().describe("Dateiinhalt als base64 (remote/HTTP-Modus)."),
    mimeType: z.string().optional().describe("MIME-Typ für /Subtype (Default: 'application/octet-stream'; für ZUGFeRD/Factur-X: 'text/xml')."),
    description: z.string().optional().describe("Beschreibung des Anhangs (/Desc)."),
    relationship: z.enum(["Source", "Data", "Alternative", "Supplement", "Unspecified"]).optional()
      .describe("/AFRelationship (Default: 'Alternative' — der Fall der E-Rechnung)."),
  });

  server.registerTool("pdf_to_pdfa", {
    title: "PDF → PDF/A-2b oder PDF/A-3b (Best Effort)",
    description: `Konvertiert eine PDF Richtung PDF/A-2b (Default) oder PDF/A-3b — BEST EFFORT, KEINE Konformitätsgarantie. Setzt XMP-Metadaten (pdfaid:part=2|3, conformance=B), bettet einen sRGB-OutputIntent (GTS_PDFA1, ICC-Profil) ein, entfernt /OpenAction, Dokument-JavaScript und Additional Actions, flattet optional AcroForm-Felder und setzt eine Trailer-ID. Nicht eingebettete Standard-14-Fonts (Helvetica/Times/Courier) werden mit 'embedFonts' (Default: true) durch metrisch kompatible, eingebettete Liberation-Fonts (SIL OFL 1.1) ersetzt; andere nicht eingebettete Schriften (inkl. Symbol/ZapfDingbats) werden nur in 'warnings' gemeldet.
E-RECHNUNG: mit 'part': 3 lassen sich über 'attachments' beliebige Dateien einbetten (EmbeddedFile-Stream + Filespec mit /AFRelationship, eingetragen in /Names /EmbeddedFiles UND im /AF-Array des Katalogs). 'facturX' schreibt zusätzlich die ZUGFeRD/Factur-X-Kennzeichnung ins XMP (fx:DocumentType, fx:DocumentFileName, fx:Version, fx:ConformanceLevel) samt des von PDF/A geforderten pdfaExtension-Schemas. Anhänge ohne part=3 werden abgelehnt (PDF/A-2 erlaubt nur eingebettete PDF/A-Dateien). Ergebnis für Archivzwecke extern prüfen (z. B. veraPDF).
Eingabe: 'path'/'dataBase64', optional 'flattenForm' (Default: true), 'embedFonts' (Default: true), 'part' (2|3), 'attachments', 'facturX'. Ausgabe: 'outputPath' oder 'dataBase64'. Returns: { part, attachments, warnings, ... }.`,
    inputSchema: {
      ...srcIn,
      flattenForm: z.boolean().optional().describe("AcroForm-Felder vor der Konvertierung einbrennen (Default: true)."),
      embedFonts: z.boolean().optional().describe("Nicht eingebettete Standard-14-Fonts (Helvetica/Times/Courier) durch eingebettete Liberation-Fonts ersetzen (metrisch kompatibel, SIL OFL 1.1; Default: true). Symbol/ZapfDingbats werden nie ersetzt."),
      part: z.union([z.literal(2), z.literal(3)]).optional().describe("PDF/A-Teil: 2 (Default) oder 3 (erlaubt eingebettete Dateien — E-Rechnung)."),
      attachments: z.array(attachmentIn).optional().describe("Dateien, die eingebettet werden sollen (verlangt part=3)."),
      facturX: z.object({
        documentFileName: z.string().describe("Name der eingebetteten XML-Rechnung (muss zu einem Anhang passen)."),
        documentType: z.string().optional().describe("fx:DocumentType (Default: 'INVOICE')."),
        version: z.string().optional().describe("fx:Version (Default: '1.0')."),
        conformanceLevel: z.string().optional().describe("fx:ConformanceLevel, z. B. 'EN 16931', 'BASIC', 'MINIMUM', 'EXTENDED'."),
      }).optional().describe("ZUGFeRD/Factur-X-Kennzeichnung im XMP (verlangt part=3)."),
      documentDate: z.string().optional().describe("Dokumentdatum als ISO-8601-Zeitstempel (z. B. \"2026-08-27T00:00:00Z\") für /CreationDate, /ModDate und XMP. Ohne Angabe werden die Daten des Eingabedokuments übernommen — die Systemuhr wird NICHT befragt, damit gleiche Eingabe gleiche Bytes ergibt."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: {
    path?: string; dataBase64?: string; flattenForm?: boolean; embedFonts?: boolean;
    part?: 2 | 3;
    attachments?: Array<{ name: string; path?: string; dataBase64?: string; mimeType?: string; description?: string; relationship?: pdfa.AfRelationship }>;
    facturX?: { documentFileName: string; documentType?: string; version?: string; conformanceLevel?: string };
    documentDate?: string;
    outputPath?: string;
  }) => {
    const attachments: pdfa.PdfAAttachment[] = [];
    for (const att of a.attachments ?? []) {
      if (att.path && att.dataBase64) throw new pdf.ToolError(`Anhang '${att.name}': bitte entweder 'path' ODER 'dataBase64' angeben, nicht beide.`);
      let bytes: Uint8Array;
      if (att.dataBase64) bytes = enforceSize(b64ToBytes(att.dataBase64), `Anhang '${att.name}'`);
      else if (att.path) {
        try { bytes = enforceSize(new Uint8Array(await readFile(att.path)), `Anhang '${att.name}'`); }
        catch (e) { throw new pdf.ToolError(`Anhang nicht lesbar: '${att.path}' (${e instanceof Error ? e.message : String(e)}).`, "FILE_READ"); }
      } else throw new pdf.ToolError(`Anhang '${att.name}': 'path' (lokal) oder 'dataBase64' (remote) angeben.`);
      attachments.push({
        name: att.name, bytes, mimeType: att.mimeType,
        description: att.description, relationship: att.relationship,
      });
    }

    let documentDate: Date | undefined;
    if (a.documentDate) {
      documentDate = new Date(a.documentDate);
      if (Number.isNaN(documentDate.getTime())) {
        throw new pdf.ToolError(`Das Feld documentDate ist kein gültiger ISO-8601-Zeitstempel: ${a.documentDate}`);
      }
    }
    const part = a.part ?? 2;
    const r = await pdfa.toPdfA(await loadPdf(a), {
      flattenForm: a.flattenForm ?? true,
      embedFonts: a.embedFonts ?? true,
      part,
      attachments,
      facturX: a.facturX,
      documentDate,
    });
    const level = `PDF/A-${part}b`;
    const summary = r.warnings.length
      ? `${level} (Best Effort) erzeugt — ${r.warnings.length} Hinweis(e):\n- ${r.warnings.join("\n- ")}`
      : `${level} (Best Effort) erzeugt — keine Hinweise. Konformität extern prüfen (z. B. veraPDF).`;
    return ok({
      part,
      attachments: attachments.map((x) => x.name),
      warnings: r.warnings,
      ...(await emitPdf(r.bytes, a.outputPath)),
    }, summary);
  }));

  server.registerTool("pdf_ua_prepare", {
    title: "PDF/UA vorbereiten (Kennzeichnung + Bericht)",
    description: `Bereitet eine PDF Richtung PDF/UA-1 vor — NUR Kennzeichnung + ehrlicher Prüfbericht, KEINE PDF/UA-Konformitätsgarantie. Setzt /MarkInfo (Marked true), Catalog /Lang, /ViewerPreferences /DisplayDocTitle und XMP pdfuaid:part=1. Der Bericht meldet (ohne zu reparieren): fehlenden /StructTreeRoot ("Dokument ist nicht getaggt" — echtes Tagging liegt AUSSERHALB des Scopes und kann nicht synthetisiert werden), fehlenden Dokumenttitel, Bild-XObjects ohne Alternativtexte (/Alt) und Schriften ohne ToUnicode-Mapping. Echte Barrierefreiheit erfordert getaggte Quelldokumente.
Eingabe: 'path'/'dataBase64', optional 'lang' (BCP-47, Default: "de-DE"). Ausgabe: 'outputPath' oder 'dataBase64'. Returns: { report, ... }.`,
    inputSchema: {
      ...srcIn,
      lang: z.string().optional().describe('Dokumentsprache als BCP-47-Code für Catalog /Lang (z. B. "de-DE", "en-US"; Default: "de-DE").'),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; lang?: string; outputPath?: string }) => {
    const r = await pdfua.preparePdfUa(await loadPdf(a), { lang: a.lang });
    const summary = `PDF/UA-Vorbereitung abgeschlossen — ${r.report.length} Punkt(e):\n- ${r.report.join("\n- ")}`;
    return ok({ report: r.report, ...(await emitPdf(r.bytes, a.outputPath)) }, summary);
  }));

  server.registerTool("pdf_sign", {
    title: "PDF signieren (Zertifikat, P12/PFX)",
    description: `Signiert eine PDF mit einem P12/PFX-Zertifikat: PAdES-B-B (SubFilter 'ETSI.CAdES.detached') mit SHA-256, unsichtbares Signaturfeld auf Seite 1, Zertifikatskette eingebettet.
Die signierten Attribute (contentType, messageDigest, signingTime, signingCertificateV2) sind in DER-Reihenfolge sortiert (RFC 5652 §5.4); signingCertificateV2 (RFC 5035) trägt certHash und issuerSerial. Damit auch für Prüfer brauchbar, die vor dem Vergleich neu kodieren (BouncyCastle, eIDAS-Validatoren), nicht nur für Adobe.
ERNEUTES SIGNIEREN: trägt das Dokument bereits eine Signatur, wird die neue als inkrementelles Update angehängt — die Originalbytes bleiben unangetastet, die bestehende Signatur gültig. Voraussetzung ist eine klassische xref-Tabelle; Dokumente mit Cross-Reference-Streams werden mit 'UNSUPPORTED' abgelehnt.
EHRLICHE GRENZEN: Grundstufe B-B — kein Zeitstempel (RFC 3161), kein LTV, also NICHT B-T oder höher.
Eingabe: 'path'/'dataBase64' + Zertifikat als 'p12Path' (lokal) oder 'p12Base64' (remote) + 'password'. Optional 'reason'/'location'/'contactInfo'.
Ausgabe: 'outputPath' oder 'dataBase64'. Returns: { signerSubject, warnings, ... }.`,
    inputSchema: {
      ...srcIn,
      p12Path: z.string().optional().describe("Lokaler Pfad zur P12/PFX-Zertifikatsdatei (stdio-Modus)."),
      p12Base64: z.string().optional().describe("P12/PFX-Zertifikat als base64 (remote/HTTP-Modus)."),
      password: z.string().describe("Passwort der P12/PFX-Datei."),
      reason: z.string().optional().describe("Grund der Signatur (/Reason, optional)."),
      location: z.string().optional().describe("Ort der Signatur (/Location, optional)."),
      contactInfo: z.string().optional().describe("Kontaktinfo (/ContactInfo, optional)."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; p12Path?: string; p12Base64?: string; password: string; reason?: string; location?: string; contactInfo?: string; outputPath?: string }) => {
    if (a.p12Path && a.p12Base64) throw new pdf.ToolError("Bitte entweder 'p12Path' ODER 'p12Base64' angeben, nicht beide.");
    let p12Bytes: Uint8Array;
    if (a.p12Base64) p12Bytes = enforceSize(b64ToBytes(a.p12Base64), "P12/PFX");
    else if (a.p12Path) {
      try { p12Bytes = enforceSize(new Uint8Array(await readFile(a.p12Path)), "P12/PFX"); }
      catch (e) { throw new pdf.ToolError(`Zertifikat nicht lesbar: '${a.p12Path}' (${e instanceof Error ? e.message : String(e)}).`, "FILE_READ"); }
    } else throw new pdf.ToolError("Zertifikat fehlt: 'p12Path' (lokal) oder 'p12Base64' (remote) angeben.");

    const r = await sign.signPdf(await loadPdf(a), p12Bytes, a.password, {
      reason: a.reason, location: a.location, contactInfo: a.contactInfo,
    });
    const summary = r.warnings.length
      ? `Signiert als '${r.signerSubject}' — ${r.warnings.length} Hinweis(e):\n- ${r.warnings.join("\n- ")}`
      : `Signiert als '${r.signerSubject}' (adbe.pkcs7.detached, SHA-256).`;
    return ok({ signerSubject: r.signerSubject, warnings: r.warnings, ...(await emitPdf(r.bytes, a.outputPath)) }, summary);
  }));

  // --- Designer-Tools (WYSIWYG-Designs der PWA, *.pbdesign.json) ---------------

  // Design-JSON kommt als Inline-String ('json') oder lokaler Pfad ('path').
  const designSrcIn = {
    path: z.string().optional().describe("Lokaler Pfad zur Design-Datei (*.pbdesign.json, stdio-Modus)."),
    json: z.string().optional().describe("Design-Dokument als JSON-String (remote/HTTP-Modus)."),
  };
  const loadDesignJson = async (a: { path?: string; json?: string }): Promise<string> => {
    if (a.path && a.json) throw new pdf.ToolError("Bitte entweder 'path' ODER 'json' angeben, nicht beide.");
    if (a.json) return a.json;
    if (a.path) {
      try { return await readFile(a.path, "utf8"); }
      catch (e) { throw new pdf.ToolError(`Datei nicht lesbar: '${a.path}' (${e instanceof Error ? e.message : String(e)}).`, "FILE_READ"); }
    }
    throw new pdf.ToolError("Eingabe fehlt: 'path' (lokal) oder 'json' (remote) angeben.");
  };
  const emitText = async (text: string, outputPath?: string): Promise<Record<string, unknown>> => {
    if (outputPath) {
      try { await writeFile(outputPath, text, "utf8"); }
      catch (e) { throw new pdf.ToolError(`Ausgabe nicht schreibbar: '${outputPath}' (${e instanceof Error ? e.message : String(e)}).`, "FILE_WRITE"); }
      return { outputPath, bytes: Buffer.byteLength(text, "utf8") };
    }
    return { text, bytes: Buffer.byteLength(text, "utf8") };
  };

  server.registerTool("design_catalog", {
    title: "Designer-Katalog",
    description: `Listet die Bausteine des Pagebound-WYSIWYG-Designers: 6 Theme-Presets (Schriften/Farben), erlaubte Schrift-Schlüssel, Seitenlayouts (inkl. DIN lang & A6 quer) und alle verfügbaren Vorlagen/Standard-Designs ('kind' für design_create). Read-only, keine Eingabe.`,
    inputSchema: {},
    annotations: readAnn,
  }, guard(async () => {
    const c = design.catalog();
    return ok(c as unknown as Record<string, unknown>,
      `${c.themes.length} Themes, ${c.layouts.length} Layouts, ${c.designs.length} Vorlagen/Designs.`);
  }));

  server.registerTool("design_create", {
    title: "Design erzeugen",
    description: `Erzeugt ein Pagebound-Design-Dokument (Schablone) aus einer Vorlage — als JSON, das die PWA direkt importieren kann (Design-Ordner: '*.pbdesign.json' oder „Import (JSON-Dokument)").
'kind' aus design_catalog (z. B. 'flyer', 'party-flyer-dunkel', 'speisekarte', 'blank'); optional 'title', 'theme' (Preset-Name) und 'layout' überschreiben die Vorlage.
Ausgabe: 'outputPath' (geschrieben) ODER 'text' (JSON inline).`,
    inputSchema: {
      kind: z.string().describe("Vorlagen-Schlüssel aus design_catalog (z. B. 'flyer', 'blank')."),
      title: z.string().optional().describe("Dokumenttitel (überschreibt den Vorlagen-Titel)."),
      theme: z.string().optional().describe("Theme-Preset-Name (z. B. 'Dunkel') — überschreibt das Vorlagen-Theme."),
      layout: z.string().optional().describe("Seitenlayout (z. B. 'DinLong') — überschreibt das Vorlagen-Layout."),
      ...outOpt,
    },
    annotations: writeAnn,
  }, guard(async (a: { kind: string; title?: string; theme?: string; layout?: string; outputPath?: string }) => {
    const docObj = design.createDesign(a.kind, { title: a.title, theme: a.theme, layout: a.layout });
    const json = JSON.stringify(docObj, null, 2);
    return ok(
      { title: docObj.title, layout: docObj.layout, theme: docObj.theme?.name ?? null, pageCount: docObj.pages.length, ...(await emitText(json, a.outputPath)) },
      `Design '${docObj.title}' (${docObj.layout}, ${docObj.pages.length} Seite(n)) erzeugt.`);
  }));

  server.registerTool("design_validate", {
    title: "Design prüfen/normalisieren",
    description: `Validiert und normalisiert ein Design-Dokument (*.pbdesign.json): nur Hex-Farben und data:image-URLs, Wertebereiche begrenzt, aktives HTML (Script/Event-Handler) entfernt, Legacy-Dokumente migriert. Meldet alle Korrekturen als 'issues'.
Eingabe: 'path' oder 'json'. Ausgabe: normalisiertes JSON ('outputPath' oder 'text') + 'issues'.`,
    inputSchema: { ...designSrcIn, ...outOpt },
    annotations: readAnn,
  }, guard(async (a: { path?: string; json?: string; outputPath?: string }) => {
    const { doc: normalized, issues } = design.validateDesign(await loadDesignJson(a));
    const json = JSON.stringify(normalized, null, 2);
    return ok(
      {
        title: normalized.title, layout: normalized.layout, pageCount: normalized.pages.length, issues,
        // Welche {{platzhalter}} die Vorlage erwartet — für Aufrufer, die die Daten dazu bauen.
        placeholders: designData.collectPlaceholders(normalized),
        ...(await emitText(json, a.outputPath)),
      },
      issues.length === 0 ? "Design ist gültig — keine Korrekturen nötig." : `Design normalisiert, ${issues.length} Korrektur(en).`);
  }));

  // Datenbindung: dieselben zwei Felder für alle Werkzeuge, die eine Vorlage füllen.
  const dataIn = {
    data: z.record(z.string(), z.unknown()).optional()
      .describe("JSON-Objekt, das die {{platzhalter}} der Vorlage füllt. Verschachtelt ({{kunde.anschrift.ort}}) und mit Listen für Wiederholungen (Block-Feld 'repeat'). Ohne 'data' wird nichts ersetzt."),
    onMissing: z.enum(["error", "report"]).optional()
      .describe("Verhalten bei Platzhaltern ohne Wert: 'error' (Default) bricht ab und nennt sie, 'report' füllt das Dokument und gibt die Lücken als 'missing' zurück."),
  };

  /** Vorlage füllen, wenn Daten mitgegeben wurden — sonst unverändert lassen. */
  const applyData = (
    doc: design.EditorDocument,
    a: { data?: Record<string, unknown>; onMissing?: "error" | "report" },
  ): { doc: design.EditorDocument; missing: designData.MissingValue[]; notes: string[] } => {
    if (!a.data) return { doc, missing: [], notes: [] };
    return designData.mergeDesign(doc, a.data, { onMissing: a.onMissing });
  };

  server.registerTool("design_merge_data", {
    title: "Vorlage mit Daten füllen",
    description: `Füllt die {{platzhalter}} eines Design-Dokuments aus einem JSON-Objekt und gibt das gefüllte Design zurück (JSON, direkt weiterverwendbar mit design_render_pdf).
DREI BAUSTEINE, alle im Designmodell:
• {{pfad.zum.wert}} — verschachtelte Werte; Listenindex als Zahl ({{positionen.0.menge}}).
• Block-Feld 'when' / 'unless' — Block nur ausgeben, wenn ein Datenpfad einen Wert hat bzw. keinen. Damit passen sich ausschließende Fälle (Kleinunternehmer § 19 UStG vs. Regelbesteuerung) in EIN Dokument statt in zwei Vorlagen.
• Block-Feld 'repeat' — Datenpfad einer Liste. Bei Tabellen ist die Zeile nach der Kopfzeile die Schablone (weitere Zeilen sind Fußzeilen und erscheinen einmal), andere Blöcke werden je Eintrag wiederholt. In der Schablone greifen Platzhalter zuerst auf den Eintrag zu, dann auf das Wurzelobjekt; {{index}} ist die laufende Nummer ab 1.
FEHLENDE WERTE: ein Platzhalter ohne Wert bleibt NICHT still leer — mit 'onMissing': 'error' (Default) bricht der Aufruf ab und nennt jeden fehlenden Platzhalter mit Fundort, mit 'report' wird gefüllt und die Liste steht in 'missing'. Als fehlend gilt auch ein leerer Text; ein Feld, das entfallen darf, gehört in einen 'when'-Block.
Werte werden beim Einsetzen HTML-maskiert — Auszeichnung gehört in die Vorlage, nicht in die Daten. Fertige Vorlage: design_create mit kind 'invoice-data'.
Eingabe: 'path'/'json' + 'data'. Ausgabe: 'outputPath' oder 'text' (JSON). Returns: { missing, notes, ... }.`,
    inputSchema: { ...designSrcIn, ...dataIn, ...outOpt },
    annotations: readAnn,
  }, guard(async (a: { path?: string; json?: string; data?: Record<string, unknown>; onMissing?: "error" | "report"; outputPath?: string }) => {
    if (!a.data) throw new pdf.ToolError("Ohne 'data' gibt es nichts zu füllen — bitte ein JSON-Objekt mitgeben.");
    const { doc: normalized } = design.validateDesign(await loadDesignJson(a));
    const merged = applyData(normalized, a);
    // Nach dem Füllen erneut prüfen: die Daten könnten Unerwünschtes mitbringen.
    const { doc: clean, issues } = design.validateDesign(JSON.stringify(merged.doc));
    const json = JSON.stringify(clean, null, 2);
    const summary = merged.missing.length
      ? `Vorlage gefüllt — ${merged.missing.length} Platzhalter ohne Wert:\n- ${merged.missing.map((m) => `{{${m.placeholder}}} (${m.where})`).join("\n- ")}`
      : `Vorlage '${clean.title}' vollständig gefüllt.`;
    return ok({
      title: clean.title, pageCount: clean.pages.length,
      missing: merged.missing, notes: merged.notes, issues,
      ...(await emitText(json, a.outputPath)),
    }, summary);
  }));

  server.registerTool("design_render_html", {
    title: "Design → HTML",
    description: `Rendert ein Design-Dokument als eigenständiges HTML (gleiche Druck-CSS wie der PWA-Export: @page-Größe, Theme-Variablen, Hintergrund-Ebenen). Im Browser geöffnet ergibt „Drucken → Als PDF speichern" das fertige PDF.
Die Eingabe wird vor dem Rendern automatisch validiert/normalisiert (wie design_validate).
Eingabe: 'path' oder 'json'. Ausgabe: 'outputPath' (geschrieben) ODER 'text' (HTML inline).`,
    inputSchema: { ...designSrcIn, ...outOpt },
    annotations: readAnn,
  }, guard(async (a: { path?: string; json?: string; outputPath?: string }) => {
    const { doc: normalized, issues } = design.validateDesign(await loadDesignJson(a));
    const html = design.renderHtml(normalized);
    return ok(
      { title: normalized.title, layout: normalized.layout, pageCount: normalized.pages.length, issues, ...(await emitText(html, a.outputPath)) },
      `HTML für '${normalized.title}' gerendert (${normalized.pages.length} Seite(n)).`);
  }));

  server.registerTool("design_render_pdf", {
    title: "Design → PDF (ohne Browser)",
    description: `Rendert ein Design-Dokument direkt als PDF — serverseitig, OHNE Browser und ohne Print-Dialog. Für Hintergrundprozesse gedacht (Rechnungen, Serienbriefe), die ein fertiges PDF brauchen statt HTML.
REPRODUZIERBAR: gleiches Design → byte-gleiches PDF (keine Uhrzeit im Ergebnis, Datei-/ID aus dem Design abgeleitet). Schriften sind eingebettet (Liberation, SIL OFL 1.1, subsetted).
EHRLICHE GRENZEN, jeweils als 'warnings' gemeldet: die Theme-Schriften (Georgia/Newsreader/Hanken/JetBrains Mono) liegen serverseitig nicht vor und werden durch metrisch kompatible Liberation-Schnitte ersetzt; vom Inline-HTML werden b/strong, i/em, u, br, p/div, ul/ol/li und span/font mit Farbe umgesetzt, alles andere wird zu Klartext; abgerundete Bildecken und Schatten fehlen; Bilder nur als data:-URL in PNG oder JPEG. Anders als der Browser bricht der Renderer zu lange Blöcke auf Folgeseiten um — Tabellen mit wiederholter Kopfzeile.
Die Eingabe wird vor dem Rendern automatisch validiert/normalisiert (wie design_validate).
Eingabe: 'path' oder 'json'. Ausgabe: 'outputPath' oder 'dataBase64'. Returns: { pageCount, issues, warnings, ... }.`,
    inputSchema: { ...designSrcIn, ...dataIn, ...outOpt },
    annotations: writeAnn,
  }, guard(async (a: { path?: string; json?: string; data?: Record<string, unknown>; onMissing?: "error" | "report"; outputPath?: string }) => {
    const { doc: parsed, issues } = design.validateDesign(await loadDesignJson(a));
    const merged = applyData(parsed, a);
    // Nach dem Füllen erneut normalisieren — die Daten könnten Unerwünschtes mitbringen.
    const normalized = a.data ? design.validateDesign(JSON.stringify(merged.doc)).doc : parsed;
    const r = await designPdf.renderPdf(normalized);
    const summary = r.warnings.length
      ? `PDF für '${normalized.title}' gerendert (${r.pageCount} Seite(n)) — ${r.warnings.length} Hinweis(e):\n- ${r.warnings.join("\n- ")}`
      : `PDF für '${normalized.title}' gerendert (${r.pageCount} Seite(n)).`;
    return ok({
      title: normalized.title, layout: normalized.layout, pageCount: r.pageCount,
      issues, warnings: r.warnings, missing: merged.missing, notes: merged.notes,
      ...(await emitPdf(r.bytes, a.outputPath)),
    }, summary);
  }));

  server.registerTool("design_render_interactive_html", {
    title: "Design → interaktives HTML",
    description: `Rendert ein Design als eigenständige, DYNAMISCHE HTML-Präsentation: Folien-Layouts (Slide16x9, mehrseitig) werden ein Deck mit Navigation (Pfeiltasten/Buttons, eine Folie je Ansicht). Mindmap-Blöcke erscheinen als scharfes Vektor-SVG (serverseitig kein Live-Widget — das hat die PWA). Nicht zum Drucken gedacht.
Die Eingabe wird vor dem Rendern automatisch validiert/normalisiert (wie design_validate).
Eingabe: 'path' oder 'json'. Ausgabe: 'outputPath' (geschrieben) ODER 'text' (HTML inline).`,
    inputSchema: { ...designSrcIn, ...outOpt },
    annotations: readAnn,
  }, guard(async (a: { path?: string; json?: string; outputPath?: string }) => {
    const { doc: normalized, issues } = design.validateDesign(await loadDesignJson(a));
    const html = design.renderInteractiveHtml(normalized);
    const deck = normalized.layout === "Slide16x9" && normalized.pages.length > 1;
    return ok(
      { title: normalized.title, layout: normalized.layout, pageCount: normalized.pages.length, deck, issues, ...(await emitText(html, a.outputPath)) },
      `Interaktives HTML für '${normalized.title}' gerendert${deck ? " (Folien-Deck mit Navigation)" : ""}.`);
  }));
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "pagebound-pdf-mcp-server", version: SERVER_VERSION });
  registerTools(server);
  return server;
}

// --- transports --------------------------------------------------------------

async function runStdio() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error("pagebound-pdf-mcp-server läuft (stdio).");
}

async function runHttp() {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json({ limit: HTTP_BODY_LIMIT }));

  app.get("/healthz", (_req, res) => res.json({ ok: true, server: "pagebound-pdf-mcp-server", version: SERVER_VERSION }));

  app.post("/mcp", async (req, res) => {
    // Stateless: pro Request ein frischer Server + Transport (keine Sessions).
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("HTTP-Request-Fehler:", e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });

  // Zu großer Body: sauber melden statt mit der Express-Standardseite abstürzen.
  // Dieselbe Kennung wie im Tool-Fehlerpfad, damit Aufrufer nur einen Fall kennen müssen.
  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) { next(err); return; }
    const tooLarge = (err as { type?: string })?.type === "entity.too.large";
    if (tooLarge) {
      res.status(413).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: `Anfrage überschreitet das Body-Limit dieses Servers (${HTTP_BODY_LIMIT}).`,
          data: { code: "INPUT_TOO_LARGE", bodyLimit: HTTP_BODY_LIMIT, maxBytesPerFile: MAX_PDF_BYTES },
        },
        id: null,
      });
      return;
    }
    console.error("HTTP-Fehler:", err);
    res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal error", data: { code: "INTERNAL" } },
      id: null,
    });
  };
  app.use(onError);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.error(`pagebound-pdf-mcp-server läuft (http) auf :${port}/mcp`));
}

const mode = process.env.MCP_TRANSPORT === "http" ? runHttp : runStdio;
mode().catch((e) => { console.error("Fataler Fehler:", e); process.exit(1); });
