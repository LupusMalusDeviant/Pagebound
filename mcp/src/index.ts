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
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as pdf from "./pdf.js";
import { encryptPdf } from "./encrypt.js";

const CHARACTER_LIMIT = 25_000;
const MAX_PDF_BYTES = Number(process.env.MCP_MAX_PDF_BYTES) || 25 * 1024 * 1024; // 25 MB
const HTTP_BODY_LIMIT = "40mb"; // base64 von 25 MB ≈ 33 MB + JSON-RPC-Overhead

// --- I/O resolution (path OR base64) -----------------------------------------

function enforceSize(bytes: Uint8Array, what = "PDF"): Uint8Array {
  if (bytes.length > MAX_PDF_BYTES) {
    throw new pdf.ToolError(`${what} ist ${(bytes.length / 1048576).toFixed(1)} MB groß — Limit sind ${(MAX_PDF_BYTES / 1048576).toFixed(0)} MB.`);
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
      throw new pdf.ToolError(`Datei nicht lesbar: '${args.path}' (${e instanceof Error ? e.message : String(e)}).`);
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
      catch (e) { throw new pdf.ToolError(`Bild nicht lesbar: '${p}' (${e instanceof Error ? e.message : String(e)}).`); }
    }));
  }
  throw new pdf.ToolError("Eingabe fehlt: 'imagePaths' (lokal) oder 'imagesBase64' (remote) angeben.");
}

async function emitPdf(bytes: Uint8Array, outputPath?: string): Promise<Record<string, unknown>> {
  if (outputPath) {
    try { await writeFile(outputPath, bytes); }
    catch (e) { throw new pdf.ToolError(`Ausgabe nicht schreibbar: '${outputPath}' (${e instanceof Error ? e.message : String(e)}).`); }
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
      catch (e) { throw new pdf.ToolError(`Teil ${i + 1} nicht schreibbar: '${file}' (${e instanceof Error ? e.message : String(e)}).`); }
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
const fail = (m: string): ToolResult => ({ content: [{ type: "text", text: `Fehler: ${m}` }], isError: true });

function guard<T>(handler: (args: T) => Promise<ToolResult>) {
  return async (args: T): Promise<ToolResult> => {
    try { return await handler(args); }
    catch (e) {
      if (e instanceof pdf.ToolError) return fail(e.message);
      return fail(`Unerwarteter Fehler: ${e instanceof Error ? e.message : String(e)}`);
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
Eingabe: 'path'/'dataBase64', optional 'pages' (z. B. "1-3,5").
Returns: { pageCount, totalChars, pages: [{ page, text }] }. Text wird bei ~25k Zeichen gekürzt.`,
    inputSchema: { ...srcIn, pages: z.string().optional().describe('Seitenauswahl, z. B. "1-3,5" (Default: alle).') },
    annotations: readAnn,
  }, guard(async (a: { path?: string; dataBase64?: string; pages?: string }) => {
    const res = await pdf.extractText(await loadPdf(a), a.pages);
    let text = res.pages.map((p) => `--- Seite ${p.page} ---\n${p.text}`).join("\n\n");
    let truncated = false;
    if (text.length > CHARACTER_LIMIT) { text = text.slice(0, CHARACTER_LIMIT) + `\n\n[gekürzt — 'pages' einschränken]`; truncated = true; }
    return ok({ pageCount: res.pageCount, totalChars: res.totalChars, truncated, pages: res.pages }, text || "(kein extrahierbarer Text — evtl. Scan ohne Text-Layer)");
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
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "pagebound-pdf-mcp-server", version: "1.2.0" });
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

  app.get("/healthz", (_req, res) => res.json({ ok: true, server: "pagebound-pdf-mcp-server" }));

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

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.error(`pagebound-pdf-mcp-server läuft (http) auf :${port}/mcp`));
}

const mode = process.env.MCP_TRANSPORT === "http" ? runHttp : runStdio;
mode().catch((e) => { console.error("Fataler Fehler:", e); process.exit(1); });
