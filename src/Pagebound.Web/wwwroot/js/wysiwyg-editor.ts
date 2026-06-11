// =============================================================================
// Pagebound — WYSIWYG-Editor Bridge (PF-02)
// ----------------------------------------------------------------------------
// Global `pageboundWysiwyg`, genutzt von Features/Editor/* via IJSRuntime.
// Der Editor selbst ist nativ (contentEditable-Blöcke, von Blazor gerendert) —
// diese Brücke kapselt nur die DOM-/Browser-Operationen, die C# nicht direkt
// kann: Rich-Text-Formatierung der Auswahl, Druck (= PDF-Export via Print-CSS),
// dynamische @page-Größe und das Auslesen von sauberem HTML (LF-05).
// 100 % lokal, kein Netzwerk, keine Fremd-Bibliothek.
// =============================================================================

import QRCode from "qrcode";

// Zuletzt bekannte Auswahl innerhalb eines `.pb-edit`-Blocks. Wird laufend per
// `selectionchange` gemerkt, damit Bedien­elemente, die den Fokus stehlen (z. B.
// der native Farbwähler `<input type="color">`), die Auswahl wiederherstellen
// und darauf ein Rich-Text-Kommando ausführen können.
let savedRange: Range | null = null;

function editableOf(range: Range | null): HTMLElement | null {
  if (!range) return null;
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  return (el?.closest(".pb-edit") as HTMLElement | null) ?? null;
}

/**
 * Initialisiert den Editor (einmal pro App-Lauf, idempotent): erzwingt Einfügen
 * als REINEN Text (kein Fremd-HTML aus der Zwischenablage → konsistentes,
 * sauberes Dokument) und merkt sich laufend die Auswahl in `.pb-edit`-Blöcken.
 * Delegiert auf Dokumentebene, damit auch dynamisch hinzugefügte Seiten/Blöcke
 * abgedeckt sind (Multi-Page).
 */
export function initializeEditor(_elementId?: string): void {
  if ((document as any).__pbEditorWired) return;
  (document as any).__pbEditorWired = true;

  document.addEventListener("paste", (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.isContentEditable) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text);
  });

  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (editableOf(range)) savedRange = range.cloneRange();
  });

  window.addEventListener("resize", applyZoom);
}

// --- Zoom der Seiten-Leinwand (Mobile: Seiten passen sonst nicht in den Viewport).
// "auto" skaliert die mm-breite Seite auf die verfügbare Stage-Breite (max 100 %).
// CSS `zoom` statt transform: beeinflusst das Layout (kein Leerraum), Druck setzt
// es per Print-CSS auf 1 zurück.
let zoomMode = "auto";
let zoomPageWidthMm = 210;

function applyZoom(): void {
  const stage = document.querySelector(".pb-doc-stage") as HTMLElement | null;
  const wrap = document.querySelector(".pb-zoom") as HTMLElement | null;
  if (!stage || !wrap) return;
  let z = 1;
  if (zoomMode === "auto") {
    const avail = stage.clientWidth - 24;
    const pageWidthPx = (zoomPageWidthMm * 96) / 25.4;
    z = Math.min(1, avail / pageWidthPx);
  } else {
    z = (parseInt(zoomMode, 10) || 100) / 100;
  }
  (wrap.style as unknown as { zoom: string }).zoom = z === 1 ? "" : z.toFixed(3);
}

/** Setzt den Zoom-Modus ("auto" | "50" … "150") und die aktuelle Seitenbreite in mm. */
export function setZoom(mode: string, pageWidthMm: number): void {
  zoomMode = mode || "auto";
  zoomPageWidthMm = pageWidthMm > 0 ? pageWidthMm : 210;
  applyZoom();
}

// --- Datei-Drop auf die Leinwand ---------------------------------------------
// Blazor-Drop-Events liefern keine Dateien — diese Brücke liest sie (Bilder als
// Data-URL, JSON als Text) und reicht sie samt Zielseite an C# durch. Block-
// Drag&Drop (ohne Dateien) läuft rein über Blazor-Events und wird hier ignoriert.

const MAX_DROP_FILES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024;

interface DroppedFilePayload {
  name: string;
  kind: "image" | "json";
  dataUrl?: string;
  text?: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type DotNetRef = { invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown> };

// --- PWA-File-Handler (.pbdesign.json) -----------------------------------------
// Der launchQueue-Consumer feuert beim App-Start (vor Blazor-Boot) und parkt den
// Dateiinhalt; der Designer holt ihn nach dem Mount per consumeLaunchDesign() ab.
if ("launchQueue" in globalThis) {
  (globalThis as any).launchQueue.setConsumer(async (params: { files?: Array<{ getFile(): Promise<File> }> }) => {
    try {
      if (!params.files || params.files.length === 0) return;
      const file = await params.files[0].getFile();
      (globalThis as any).__pbLaunchDesign = await file.text();
    } catch {
      /* Datei nicht lesbar — ignorieren */
    }
  });
}

/** Holt eine per Datei-Doppelklick (PWA-File-Handler) übergebene Design-Datei ab (einmalig). */
export function consumeLaunchDesign(): string | null {
  const text = (globalThis as any).__pbLaunchDesign as string | undefined;
  (globalThis as any).__pbLaunchDesign = undefined;
  return text ?? null;
}

/** QR-Code als PNG-Data-URL erzeugen (lokal, kein Netz). */
export function makeQr(text: string, sizePx: number): Promise<string> {
  return QRCode.toDataURL(text || " ", { width: Math.max(64, Math.min(1024, sizePx || 512)), margin: 1 });
}

/**
 * Re-encodiert ein Bild platzsparend (Data-URLs blähen Entwürfe sonst auf):
 * skaliert auf max. `maxDim` px Kantenlänge und encodiert als JPEG, außer das
 * Original ist ein kleines PNG (Transparenz erhalten). Liefert das kleinere
 * Ergebnis von Original/Re-Encode.
 */
export async function compressDataUrl(dataUrl: string, maxDim = 2000, quality = 0.85): Promise<string> {
  try {
    const isPng = dataUrl.startsWith("data:image/png");
    if (isPng && dataUrl.length < 1_500_000) return dataUrl;
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); img.src = dataUrl; });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", quality);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

// --- Tastatur-Shortcuts + Overlay-Interaktionen (Pointer-basiert = Touch-fähig) --

let editorRef: DotNetRef | null = null;

function wireShortcuts(): void {
  if ((document as any).__pbShortcutsWired) return;
  (document as any).__pbShortcutsWired = true;
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!editorRef || !document.querySelector(".pb-doc-stage")) return;
    const target = e.target as HTMLElement | null;
    const inEdit = !!target?.closest?.(".pb-edit, [contenteditable='true'], input, textarea, select");
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      void editorRef.invokeMethodAsync("OnShortcut", "save");
    } else if (mod && !inEdit && key === "z" && !e.shiftKey) {
      e.preventDefault();
      void editorRef.invokeMethodAsync("OnShortcut", "undo");
    } else if (mod && !inEdit && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      void editorRef.invokeMethodAsync("OnShortcut", "redo");
    } else if (!mod && !inEdit && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      void editorRef.invokeMethodAsync("OnShortcut", "delete");
    }
  });
}

// Drag/Resize frei platzierter Overlays: Pointer Events (Maus + Touch + Stift).
// Während der Geste wird nur der Inline-Style aktualisiert; erst am Ende geht
// die Geometrie (in % der Seitenfläche) an C# — ein Undo-Schritt pro Geste.
function wireOverlayInteractions(): void {
  if ((document as any).__pbOverlayWired) return;
  (document as any).__pbOverlayWired = true;

  document.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!editorRef) return;
    const target = e.target as HTMLElement | null;
    const handle = target?.closest?.(".pb-ov-move, .pb-ov-resize") as HTMLElement | null;
    if (!handle) return;
    const overlay = handle.closest(".pb-overlay") as HTMLElement | null;
    const page = handle.closest(".pb-page") as HTMLElement | null;
    if (!overlay || !page) return;
    e.preventDefault();
    const resize = handle.classList.contains("pb-ov-resize");
    const pageRect = page.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseFloat(overlay.style.left) || 0;   // %
    const startTop = parseFloat(overlay.style.top) || 0;     // %
    const startWidth = parseFloat(overlay.style.width) || 20; // %
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetische Events haben keine gültige Pointer-Id */ }

    const onMove = (ev: PointerEvent) => {
      const dxPct = ((ev.clientX - startX) / pageRect.width) * 100;
      const dyPct = ((ev.clientY - startY) / pageRect.height) * 100;
      if (resize) {
        overlay.style.width = `${Math.min(100, Math.max(4, startWidth + dxPct)).toFixed(2)}%`;
      } else {
        overlay.style.left = `${Math.min(98, Math.max(-20, startLeft + dxPct)).toFixed(2)}%`;
        overlay.style.top = `${Math.min(98, Math.max(-10, startTop + dyPct)).toFixed(2)}%`;
      }
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      const id = overlay.id.startsWith("ov-") ? overlay.id.slice(3) : overlay.id;
      void editorRef?.invokeMethodAsync("OnOverlayGeometry", id,
        parseFloat(overlay.style.left) || 0,
        parseFloat(overlay.style.top) || 0,
        parseFloat(overlay.style.width) || startWidth);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

export function registerFileDrop(dotnetRef: DotNetRef): void {
  editorRef = dotnetRef;
  wireShortcuts();
  wireOverlayInteractions();
  const stage = document.querySelector(".pb-doc-stage") as HTMLElement | null;
  if (!stage || (stage as any).__pbDropWired) return;
  (stage as any).__pbDropWired = true;

  stage.addEventListener("dragover", (e: DragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      stage.classList.add("pb-file-drop");
    }
  });
  stage.addEventListener("dragleave", (e: DragEvent) => {
    if (e.target === stage) stage.classList.remove("pb-file-drop");
  });
  stage.addEventListener("drop", (e: DragEvent) => {
    stage.classList.remove("pb-file-drop");
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return; // Block-Drag (Blazor) — nicht unsere Baustelle
    e.preventDefault();

    const pageEl = (e.target as HTMLElement | null)?.closest?.(".pb-page") as HTMLElement | null;
    const pageIndex = pageEl?.id?.startsWith("pb-page-") ? parseInt(pageEl.id.slice("pb-page-".length), 10) : -1;

    void (async () => {
      const payload: DroppedFilePayload[] = [];
      for (const f of Array.from(files).slice(0, MAX_DROP_FILES)) {
        try {
          if (f.type.startsWith("image/")) {
            if (f.size > MAX_IMAGE_BYTES) continue;
            payload.push({ name: f.name, kind: "image", dataUrl: await readAsDataUrl(f) });
          } else if (f.type === "application/json" || f.name.toLowerCase().endsWith(".json")) {
            if (f.size > MAX_JSON_BYTES) continue;
            payload.push({ name: f.name, kind: "json", text: await f.text() });
          }
        } catch {
          /* unlesbare Datei überspringen */
        }
      }
      if (payload.length > 0) {
        await dotnetRef.invokeMethodAsync("OnFilesDropped", pageIndex, payload);
      }
    })();
  });
}

/**
 * Wendet ein Farb-Kommando (`foreColor` / `hiliteColor`) auf die zuletzt im
 * Editor gemerkte Auswahl an. Nötig, weil der native Farbwähler beim Öffnen den
 * Fokus aus dem contentEditable nimmt — wir stellen die Auswahl zuvor wieder her.
 */
export function applyColor(command: string, value: string): void {
  const editable = editableOf(savedRange);
  const sel = window.getSelection();
  if (editable && sel && savedRange) {
    editable.focus();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  try {
    document.execCommand(command, false, value);
  } catch {
    /* Kommando nicht unterstützt — Editor bleibt nutzbar */
  }
}

/**
 * Wendet ein Rich-Text-Kommando auf die aktuelle Auswahl im fokussierten
 * contentEditable an (bold/italic/underline/strikeThrough, insertUnorderedList,
 * insertOrderedList, justifyLeft/Center/Right/Full, removeFormat …).
 * execCommand ist „deprecated", aber in allen Zielbrowsern für contentEditable
 * der zuverlässigste Weg ohne Fremd-Lib.
 */
export function execFormat(command: string, value?: string): void {
  try {
    document.execCommand(command, false, value);
  } catch {
    /* einzelnes Kommando nicht unterstützt — Rest des Editors bleibt nutzbar */
  }
}

/** Öffnet den systemweiten Druckdialog (→ „Als PDF speichern"). Erfüllt AK-03. */
export function triggerPrint(): void {
  window.print();
}

/**
 * Setzt die Ziel-Seitengröße fürs Drucken dynamisch (LF-02). `size` ist ein
 * CSS-`@page`-Wert, z. B. "210mm 297mm" (A4 hoch) oder "297mm 210mm" (quer).
 * Wir setzen `margin: 0`; die sichtbaren Ränder macht das Seiten-Element selbst,
 * damit Bildschirm und Druck identisch aussehen.
 */
export function setPageSize(size: string): void {
  let el = document.getElementById("pb-page-size") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "pb-page-size";
    document.head.appendChild(el);
  }
  el.textContent = `@page { size: ${size}; margin: 0; }`;
}

/** Innen-HTML eines Elements (für den „sauberer HTML-Quellcode"-Export, LF-05). */
export function getHtmlContent(elementId: string): string {
  return document.getElementById(elementId)?.innerHTML ?? "";
}

/**
 * Wie getHtmlContent, aber ohne Editier-Affordances: klont das Element und
 * entfernt alle `.no-print`-Knoten (Seiten-/Block-Werkzeugleisten), damit der
 * HTML-Export pro Seite sauberer Inhalt ist (Multi-Page).
 */
export function getCleanHtml(elementId: string): string {
  const el = document.getElementById(elementId);
  if (!el) return "";
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".no-print").forEach((n) => n.remove());
  return clone.innerHTML;
}

/**
 * Liest das innerHTML mehrerer Elemente in einem Rutsch. Der Editor ruft dies
 * vor Speichern/Export auf, um alle contentEditable-Blöcke deterministisch ins
 * C#-Modell zu übernehmen (kein Fokus-/Blur-Timing-Problem).
 */
export function readValues(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids ?? []) {
    const el = document.getElementById(id);
    if (el) out[id] = el.innerHTML;
  }
  return out;
}

/** Entfernt den Fokus vom aktiven Element (löst dessen blur-Sync aus). */
export function blurActive(): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && typeof el.blur === "function") el.blur();
}

/** Lädt HTML in ein Element (PF-02-Kompatibilität; vom Block-Editor i. d. R. ungenutzt). */
export function setHtmlContent(elementId: string, html: string): void {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = html;
}

/**
 * Misst pro Element, ob dessen Inhalt höher ist als das Element selbst —
 * der Editor zeigt damit eine Überlauf-Warnung an Seiten, deren Inhalt das
 * feste Papierformat sprengt (würde im Druck abgeschnitten).
 */
export function measureOverflow(ids: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of ids ?? []) {
    const el = document.getElementById(id);
    if (el) out[id] = el.scrollHeight > el.clientHeight + 1;
  }
  return out;
}

// Beim Import fremder Dokument-/Theme-Dateien (JSON) könnten Text-Felder
// aktives HTML enthalten. Dieser DOM-basierte Sanitizer entfernt Skripte,
// Event-Handler und gefährliche URLs, bevor der Inhalt als Markup gerendert wird.
const BLOCKED_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "FORM", "TEMPLATE",
]);

function sanitizeNode(el: Element): void {
  for (const child of Array.from(el.children)) {
    if (BLOCKED_TAGS.has(child.tagName)) {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) child.removeAttribute(attr.name);
      else if ((name === "href" || name === "src" || name === "xlink:href") &&
               (value.startsWith("javascript:") || value.startsWith("vbscript:") ||
                (name !== "href" && value.startsWith("data:") && !value.startsWith("data:image/")))) {
        child.removeAttribute(attr.name);
      }
    }
    sanitizeNode(child);
  }
}

/** Säubert eine Liste von HTML-Fragmenten (Dokument-Import, LF-05). */
export function sanitizeHtmlBatch(values: string[]): string[] {
  return (values ?? []).map((html) => {
    const tpl = document.createElement("template");
    tpl.innerHTML = html ?? "";
    sanitizeNode(tpl.content as unknown as Element);
    return tpl.innerHTML;
  });
}

/** Setzt den Cursor ans Ende eines (gerade hinzugefügten) editierbaren Blocks. */
export function focusBlockEnd(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
