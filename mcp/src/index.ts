#!/usr/bin/env node
// =============================================================================
// pagebound-pdf-mcp-server — exposes Pagebound's PDF operations to LLM agents
// over a tokenless stdio MCP transport. Same engines as the web app (pdf-lib +
// pdfjs-dist). Tools work on local file paths so results stay small.
// =============================================================================
//
// CRITICAL: stdio MCP servers speak JSON-RPC on STDOUT. Any stray stdout write
// (e.g. a pdfjs warning) corrupts the protocol. Route every console.* to STDERR
// before anything else loads.
for (const k of ["log", "info", "debug", "warn"] as const) {
  console[k] = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as pdf from "./pdf.js";

const CHARACTER_LIMIT = 25_000;

const server = new McpServer({ name: "pagebound-pdf-mcp-server", version: "1.0.0" });

// --- response helpers --------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

function ok(structured: Record<string, unknown>, summary: string): ToolResult {
  return { content: [{ type: "text", text: summary }], structuredContent: structured };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: `Fehler: ${message}` }], isError: true };
}

/** Wraps a handler: turns ToolError into a clean message, others into a generic one. */
function guard<T>(handler: (args: T) => Promise<ToolResult>) {
  return async (args: T): Promise<ToolResult> => {
    try {
      return await handler(args);
    } catch (e) {
      if (e instanceof pdf.ToolError) return fail(e.message);
      return fail(`Unerwarteter Fehler: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// --- tools -------------------------------------------------------------------

server.registerTool(
  "pdf_info",
  {
    title: "PDF-Infos",
    description: `Liest Metadaten einer lokalen PDF-Datei: Seitenzahl, Titel/Autor und je Seite die Größe in Punkt (1 pt = 1/72 Zoll). Verändert nichts.

Args:
  - path (string): absoluter Pfad zur PDF.

Returns (structured): { path, pageCount, title?, author?, pages: [{ page, widthPt, heightPt }] }.

Beispiel: "Wie viele Seiten hat report.pdf?" → pdf_info({ path: "/abs/report.pdf" }).
Fehler: klare Meldung, wenn die Datei fehlt, beschädigt oder verschlüsselt ist.`,
    inputSchema: { path: z.string().min(1).describe("Absoluter Pfad zur PDF-Datei") },
    annotations: readAnnotations,
  },
  guard(async ({ path }: { path: string }) => {
    const info = await pdf.getInfo(path);
    return ok(info as unknown as Record<string, unknown>, `${info.pageCount} Seite(n)${info.title ? `, Titel: ${info.title}` : ""}. Seite 1: ${info.pages[0]?.widthPt}×${info.pages[0]?.heightPt} pt.`);
  }),
);

server.registerTool(
  "pdf_extract_text",
  {
    title: "PDF-Text extrahieren",
    description: `Extrahiert den Text-Layer einer PDF (kein OCR — funktioniert bei „echten" Text-PDFs, nicht bei reinen Scans). Optional nur bestimmte Seiten.

Args:
  - path (string): absoluter Pfad zur PDF.
  - pages (string, optional): Seitenauswahl wie "1-3,5,8" (Default: alle).

Returns (structured): { pageCount, totalChars, pages: [{ page, text }] }. Die Textantwort wird bei ~25k Zeichen gekürzt (dann gezielt 'pages' einschränken).

Beispiel: "Worum geht es auf Seite 1 von vertrag.pdf?" → pdf_extract_text({ path, pages: "1" }).`,
    inputSchema: {
      path: z.string().min(1).describe("Absoluter Pfad zur PDF-Datei"),
      pages: z.string().optional().describe('Optionale Seitenauswahl, z. B. "1-3,5" (Default: alle Seiten)'),
    },
    annotations: readAnnotations,
  },
  guard(async ({ path, pages }: { path: string; pages?: string }) => {
    const res = await pdf.extractText(path, pages);
    let text = res.pages.map((p) => `--- Seite ${p.page} ---\n${p.text}`).join("\n\n");
    let truncated = false;
    if (text.length > CHARACTER_LIMIT) {
      text = text.slice(0, CHARACTER_LIMIT) + `\n\n[gekürzt bei ${CHARACTER_LIMIT} Zeichen — 'pages' einschränken für mehr]`;
      truncated = true;
    }
    return ok({ pageCount: res.pageCount, totalChars: res.totalChars, truncated, pages: res.pages }, text || "(kein extrahierbarer Text — evtl. ein Scan ohne Text-Layer)");
  }),
);

server.registerTool(
  "pdf_merge",
  {
    title: "PDFs zusammenführen",
    description: `Fügt mehrere PDFs in der angegebenen Reihenfolge zu einer neuen PDF zusammen. Die Eingaben bleiben unverändert.

Args:
  - inputs (string[]): ≥2 absolute Pfade, in gewünschter Reihenfolge.
  - output (string): absoluter Zielpfad der neuen PDF.

Returns (structured): { output, pageCount, sources }.`,
    inputSchema: {
      inputs: z.array(z.string().min(1)).min(2).describe("Mindestens zwei PDF-Pfade in Reihenfolge"),
      output: z.string().min(1).describe("Zielpfad der zusammengeführten PDF"),
    },
    annotations: writeAnnotations,
  },
  guard(async ({ inputs, output }: { inputs: string[]; output: string }) => {
    const r = await pdf.merge(inputs, output);
    return ok(r as unknown as Record<string, unknown>, `${r.sources} PDFs → '${r.output}' (${r.pageCount} Seiten).`);
  }),
);

server.registerTool(
  "pdf_extract_pages",
  {
    title: "Seiten extrahieren",
    description: `Kopiert ausgewählte Seiten (in angegebener Reihenfolge) in eine neue PDF. Original bleibt unverändert. So lässt sich auch splitten (mehrfach mit verschiedenen Bereichen aufrufen).

Args:
  - input (string): Quell-PDF.
  - pages (string): Seitenauswahl/-reihenfolge, z. B. "1-3,5,8" oder "3,1,2".
  - output (string): Zielpfad.

Returns (structured): { output, pageCount }.`,
    inputSchema: {
      input: z.string().min(1).describe("Quell-PDF"),
      pages: z.string().min(1).describe('Seiten/Bereiche, z. B. "1-3,5"'),
      output: z.string().min(1).describe("Zielpfad"),
    },
    annotations: writeAnnotations,
  },
  guard(async ({ input, pages, output }: { input: string; pages: string; output: string }) => {
    const r = await pdf.extractPages(input, pages, output);
    return ok(r as unknown as Record<string, unknown>, `Seiten '${pages}' → '${r.output}' (${r.pageCount} Seiten).`);
  }),
);

server.registerTool(
  "pdf_delete_pages",
  {
    title: "Seiten löschen",
    description: `Entfernt die angegebenen Seiten; der Rest bleibt in Originalreihenfolge in einer neuen PDF. Original bleibt unverändert.

Args:
  - input (string): Quell-PDF.
  - pages (string): zu löschende Seiten, z. B. "2,4-6".
  - output (string): Zielpfad.

Returns (structured): { output, pageCount, deleted }.`,
    inputSchema: {
      input: z.string().min(1).describe("Quell-PDF"),
      pages: z.string().min(1).describe('Zu löschende Seiten, z. B. "2,4-6"'),
      output: z.string().min(1).describe("Zielpfad"),
    },
    annotations: writeAnnotations,
  },
  guard(async ({ input, pages, output }: { input: string; pages: string; output: string }) => {
    const r = await pdf.deletePages(input, pages, output);
    return ok(r as unknown as Record<string, unknown>, `${r.deleted} Seite(n) gelöscht → '${r.output}' (${r.pageCount} Seiten übrig).`);
  }),
);

server.registerTool(
  "pdf_rotate_pages",
  {
    title: "Seiten drehen",
    description: `Dreht ausgewählte Seiten um ein Vielfaches von 90° (additiv zur bestehenden Drehung) und schreibt eine neue PDF.

Args:
  - input (string): Quell-PDF.
  - pages (string): zu drehende Seiten, z. B. "1-3" oder "all-Trick: 1-<n>".
  - degrees (number): -270…270, Vielfaches von 90 (z. B. 90, -90, 180).
  - output (string): Zielpfad.

Returns (structured): { output, rotated }.`,
    inputSchema: {
      input: z.string().min(1).describe("Quell-PDF"),
      pages: z.string().min(1).describe('Zu drehende Seiten, z. B. "1-3,5"'),
      degrees: z.number().int().describe("Drehwinkel, Vielfaches von 90 (z. B. 90, -90, 180)"),
      output: z.string().min(1).describe("Zielpfad"),
    },
    annotations: writeAnnotations,
  },
  guard(async ({ input, pages, degrees, output }: { input: string; pages: string; degrees: number; output: string }) => {
    const r = await pdf.rotatePages(input, pages, degrees, output);
    return ok(r as unknown as Record<string, unknown>, `${r.rotated} Seite(n) um ${degrees}° gedreht → '${r.output}'.`);
  }),
);

server.registerTool(
  "pdf_reorder_pages",
  {
    title: "Seiten neu anordnen",
    description: `Ordnet die Seiten gemäß einer vollständigen 1-basierten Reihenfolge neu an (jede Seite genau einmal) und schreibt eine neue PDF.

Args:
  - input (string): Quell-PDF.
  - order (number[]): neue Reihenfolge, z. B. [3,1,2] für ein 3-Seiten-PDF.
  - output (string): Zielpfad.

Returns (structured): { output, pageCount }.`,
    inputSchema: {
      input: z.string().min(1).describe("Quell-PDF"),
      order: z.array(z.number().int().positive()).min(1).describe("Vollständige neue Seitenreihenfolge, 1-basiert"),
      output: z.string().min(1).describe("Zielpfad"),
    },
    annotations: writeAnnotations,
  },
  guard(async ({ input, order, output }: { input: string; order: number[]; output: string }) => {
    const r = await pdf.reorderPages(input, order, output);
    return ok(r as unknown as Record<string, unknown>, `Neu angeordnet → '${r.output}' (${r.pageCount} Seiten).`);
  }),
);

server.registerTool(
  "images_to_pdf",
  {
    title: "Bilder → PDF",
    description: `Erzeugt aus PNG/JPG-Bildern eine PDF (eine Seite je Bild, in angegebener Reihenfolge).

Args:
  - images (string[]): Pfade zu PNG/JPG-Dateien, in Reihenfolge.
  - output (string): Zielpfad der PDF.
  - pageSize ('image'|'a4'|'letter'): 'image' = Seite = Bildgröße; 'a4'/'letter' = Bild zentriert eingepasst (Default: 'image').

Returns (structured): { output, pageCount }.`,
    inputSchema: {
      images: z.array(z.string().min(1)).min(1).describe("PNG/JPG-Pfade in Reihenfolge"),
      output: z.string().min(1).describe("Zielpfad der PDF"),
      pageSize: z.enum(["image", "a4", "letter"]).default("image").describe("Seitengröße: 'image' | 'a4' | 'letter'"),
    },
    annotations: writeAnnotations,
  },
  guard(async ({ images, output, pageSize }: { images: string[]; output: string; pageSize: pdf.PageSizeMode }) => {
    const r = await pdf.imagesToPdf(images, output, pageSize);
    return ok(r as unknown as Record<string, unknown>, `${images.length} Bild(er) → '${r.output}' (${r.pageCount} Seiten).`);
  }),
);

// --- run ---------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("pagebound-pdf-mcp-server läuft (stdio).");
}

main().catch((e) => {
  console.error("Fataler Fehler:", e);
  process.exit(1);
});
