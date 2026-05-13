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

  return { pageNumber, widthPx, heightPx, rasterBase64, rasterFormat: "image/png" };
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
