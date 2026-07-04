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

/** Schneidet ein Bild zu (Anteile 0..0.45 je Kante) und liefert die neue Data-URL. */
export async function cropDataUrl(dataUrl: string, left: number, top: number, right: number, bottom: number): Promise<string> {
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); img.src = dataUrl; });
  const clampPct = (v: number) => Math.min(0.45, Math.max(0, v || 0));
  const l = clampPct(left), t = clampPct(top), r = clampPct(right), b = clampPct(bottom);
  const sx = Math.round(img.naturalWidth * l);
  const sy = Math.round(img.naturalHeight * t);
  const sw = Math.max(1, Math.round(img.naturalWidth * (1 - l - r)));
  const sh = Math.max(1, Math.round(img.naturalHeight * (1 - t - b)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return dataUrl.startsWith("data:image/png") ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9);
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

// Touch-Fallback fürs Block-Umsortieren: HTML5-Drag&Drop feuert auf Touch nicht,
// daher zieht ein Touch-Pointer am Grip-Handle hier per Pointer Events. Während
// der Geste markiert elementFromPoint den Ziel-Block (pb-drop-target), am Ende
// meldet ein DotNet-Callback Quelle/Ziel. Maus bleibt beim nativen HTML5-DnD.
function wireTouchBlockReorder(): void {
  if ((document as any).__pbTouchReorderWired) return;
  (document as any).__pbTouchReorderWired = true;

  document.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!editorRef || e.pointerType !== "touch") return;
    const handle = (e.target as HTMLElement | null)?.closest?.(".pb-drag-handle") as HTMLElement | null;
    if (!handle) return;
    const source = handle.closest(".pb-block") as HTMLElement | null;
    if (!source?.dataset.blk) return;
    e.preventDefault();
    let targetBlock: HTMLElement | null = null;
    let targetPage: HTMLElement | null = null;
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetische Events */ }

    const clearMark = () => document.querySelectorAll(".pb-block.pb-drop-target").forEach((el) => el.classList.remove("pb-drop-target"));
    const onMove = (ev: PointerEvent) => {
      const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const block = under?.closest?.(".pb-block") as HTMLElement | null;
      targetPage = (under?.closest?.(".pb-page") as HTMLElement | null) ?? targetPage;
      clearMark();
      targetBlock = block && block !== source ? block : null;
      if (targetBlock) targetBlock.classList.add("pb-drop-target");
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      clearMark();
      const pageIdx = targetPage?.id?.startsWith("pb-page-") ? parseInt(targetPage.id.slice("pb-page-".length), 10) : -1;
      if (targetBlock?.dataset.blk || pageIdx >= 0) {
        void editorRef?.invokeMethodAsync("OnBlockTouchDrop", source.dataset.blk, targetBlock?.dataset.blk ?? null, pageIdx);
      }
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
  wireTouchBlockReorder();
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

/** Lädt eine Text-Ressource (z. B. ein JS-Bundle) zum Inlinen in den HTML-Export. */
export async function fetchText(url: string): Promise<string> {
  try { const r = await fetch(url, { cache: "no-store" }); return r.ok ? await r.text() : ""; }
  catch { return ""; }
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

// =============================================================================
// HTML-Datei-Import (PF-02-Erweiterung)
// ----------------------------------------------------------------------------
// Wandelt eine hochgeladene HTML-Datei in ein EditorDocument-förmiges JSON, das
// C# über die bestehende Import-/Sanitize-Pipeline (ParseDesignJsonAsync) lädt.
// Fokus auf Textstruktur: Überschriften, Absätze, Listen, Tabellen und Bilder
// werden auf die nativen Block-Typen abgebildet. Skripte, Styles, Layout-
// Frameworks (Tailwind o. Ä.), Icons und interaktive Elemente werden verworfen —
// das DOM wird per `DOMParser` robust geparst (verträgt auch fehlerhaftes HTML).
// =============================================================================

/** Inline-Tags, die als Auszeichnung erhalten bleiben (auf Standard-Tags gemappt). */
const INLINE_MAP: Record<string, string> = {
  B: "strong", STRONG: "strong", I: "em", EM: "em", U: "u", S: "s", STRIKE: "s",
  SUB: "sub", SUP: "sup", CODE: "code", MARK: "mark", SMALL: "small",
};

/** Elemente, deren Inhalt beim Import komplett ignoriert wird (kein Textinhalt). */
const IMPORT_SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "IFRAME", "OBJECT", "EMBED",
  "NAV", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "HEAD", "LINK", "META",
  "AUDIO", "VIDEO", "FORM", "TEMPLATE", "DIALOG", "BASE",
]);

function escImportHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escImportAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function sanitizeImportHref(href: string | null): string | null {
  const v = (href ?? "").trim();
  const low = v.toLowerCase();
  if (low.startsWith("http://") || low.startsWith("https://") || low.startsWith("mailto:") || low.startsWith("tel:")) return v;
  return null;
}

function isInlineTag(tag: string): boolean {
  return tag === "BR" || tag === "A" || tag === "SPAN" || tag in INLINE_MAP;
}

/** Serialisiert einen Knoten zu sauberem Inline-HTML (nur Whitelist-Auszeichnung). */
function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escImportHtml(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName;
  if (tag === "BR") return "<br>";
  if (IMPORT_SKIP_TAGS.has(tag)) return "";
  const inner = Array.from(el.childNodes).map(serializeInline).join("");
  if (tag === "A") {
    const href = sanitizeImportHref(el.getAttribute("href"));
    return href && inner.trim() ? `<a href="${escImportAttr(href)}">${inner}</a>` : inner;
  }
  const mapped = INLINE_MAP[tag];
  if (mapped) return inner.trim() ? `<${mapped}>${inner}</${mapped}>` : ""; // leere Icons (<i class="fa…">) verwerfen
  return inner; // unbekanntes/Block-Element im Inline-Kontext: nur Inhalt übernehmen
}

function cleanInlineHtml(parent: Element): string {
  return Array.from(parent.childNodes).map(serializeInline).join("").replace(/\s+/g, " ").trim();
}

/** Knoten eines Mindmap-Baums (Im-/Export-Form, deckt sich mit C# MindmapNode). */
interface MNode { id: string; label: string; children: MNode[]; }

// Medien-Job: nachgelagert aufgelöste Bildquelle (externes Bild, gerastertes
// SVG/Canvas oder gezeichneter Mindmap-Baum). `place` schreibt die data-URL zurück.
type MediaJob =
  | { kind: "url"; src: string; place: (d: string | null) => void }
  | { kind: "svg"; el: Element; place: (d: string | null) => void }
  | { kind: "canvas"; el: HTMLCanvasElement; place: (d: string | null) => void }
  | { kind: "mindmap"; tree: MNode; place: (d: string | null) => void };

// Walk-Kontext: gesammelte Medien-Jobs + optionales `win` für getComputedStyle.
// Ist `win` gesetzt (Rich-Modus über iframe), übernimmt der Walker zusätzlich
// Farben/Boxen/Schriftgrößen, rastert Grafiken und erkennt Mindmaps (→ `trees`).
interface ImportCtx { jobs: MediaJob[]; win: Window | null; trees: MNode[]; }

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Stil-Helfer (nur Rich-Modus) -------------------------------------------
function rgbToHex(rgb: string | null | undefined): string | null {
  const m = (rgb ?? "").match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const p = m[1].split(",").map((s) => parseFloat(s.trim()));
  if (p.length >= 4 && p[3] < 0.06) return null; // transparent
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n || 0))).toString(16).padStart(2, "0");
  return "#" + h(p[0]) + h(p[1]) + h(p[2]);
}
function pxToPt(px: string | null | undefined): number | undefined {
  const v = parseFloat(px ?? "");
  if (!isFinite(v) || v <= 0) return undefined;
  return Math.max(6, Math.min(120, Math.round(v * 0.75)));
}
function alignOf(v: string | null | undefined): string {
  return v === "center" || v === "right" || v === "justify" ? v : "left";
}
/** Block-Eigenschaften (Ausrichtung, Schriftgröße) aus den berechneten Stilen. */
function styleProps(el: Element, win: Window | null): any {
  if (!win) return {};
  const cs = win.getComputedStyle(el);
  const out: any = {};
  const a = alignOf(cs.textAlign); if (a !== "left") out.align = a;
  const pt = pxToPt(cs.fontSize); if (pt) out.fontSizePt = pt;
  return out;
}
/** Bäckt Textfarbe/-gewicht/-stil als Inline-<span> ein (block.Color wird vom
 *  Renderer für Texte nicht angewandt — der Sanitizer behält aber `style`). */
function decorateText(el: Element, win: Window | null, inner: string): string {
  if (!win || !inner) return inner;
  const cs = win.getComputedStyle(el);
  const parts: string[] = [];
  const color = rgbToHex(cs.color);
  if (color && color.toLowerCase() !== "#000000") parts.push(`color:${color}`);
  const weight = parseInt(cs.fontWeight, 10) || 400;
  if (weight >= 600) parts.push(`font-weight:${Math.min(weight, 800)}`);
  if (cs.fontStyle === "italic") parts.push("font-style:italic");
  return parts.length ? `<span style="${parts.join(";")}">${inner}</span>` : inner;
}
/** Erkennt eine „Box" (Hintergrund/Rahmen) und liefert passendes Inline-CSS. */
function computeBox(el: Element, win: Window | null): { hasBox: boolean; css: string } {
  if (!win) return { hasBox: false, css: "" };
  const cs = win.getComputedStyle(el);
  const out: string[] = [];
  const bg = rgbToHex(cs.backgroundColor);
  if (bg) out.push(`background:${bg}`);
  const sides = ["Top", "Right", "Bottom", "Left"];
  let maxW = 0, bColor = "", bSide = "";
  for (const s of sides) {
    const w = parseFloat((cs as any)[`border${s}Width`]) || 0;
    if (w > maxW) { maxW = w; bColor = rgbToHex((cs as any)[`border${s}Color`]) || ""; bSide = s.toLowerCase(); }
  }
  if (maxW >= 1 && bColor) {
    const allEq = sides.every((s) => Math.abs((parseFloat((cs as any)[`border${s}Width`]) || 0) - maxW) < 0.5);
    out.push(allEq ? `border:${Math.min(maxW, 8)}px solid ${bColor}`
                   : `border-${bSide}:${Math.min(maxW, 8)}px solid ${bColor}`);
  }
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  if (radius >= 1) out.push(`border-radius:${Math.min(radius, 24)}px`);
  const pad = parseFloat(cs.paddingTop) || 0;
  if (pad >= 4) out.push(`padding:${Math.min(pad, 32)}px`);
  return { hasBox: !!bg || (maxW >= 1 && !!bColor), css: out.join(";") };
}

function buildImportList(el: Element): string {
  const tag = el.tagName === "OL" ? "ol" : "ul";
  let items = "";
  for (const li of Array.from(el.children)) {
    if (li.tagName !== "LI") continue;
    const inner = cleanInlineHtml(li);
    if (inner) items += `<li>${inner}</li>`;
  }
  return items ? `<${tag}>${items}</${tag}>` : "";
}

function buildImportTable(el: Element): any | null {
  const rows: string[][] = [];
  let headerRow = false;
  const trs = Array.from(el.querySelectorAll("tr"));
  for (let r = 0; r < trs.length; r++) {
    const cells = Array.from(trs[r].children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
    if (cells.length === 0) continue;
    if (rows.length === 0 && cells.some((c) => c.tagName === "TH")) headerRow = true;
    rows.push(cells.map((c) => cleanInlineHtml(c)));
  }
  if (rows.length === 0) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < cols) r.push("");
  return { type: "Table", rows, headerRow };
}

function pushImportImage(el: Element, blocks: any[], ctx: ImportCtx): void {
  const src = (el.getAttribute("src") ?? "").trim();
  if (!src) return;
  const alt = (el.getAttribute("alt") ?? "").trim();
  if (src.startsWith("data:image/")) { blocks.push({ type: "Image", src, alt, widthPercent: 100 }); return; }
  // Externe Bilder werden best-effort eingebettet; der Block wird verworfen, wenn das scheitert.
  const block: any = { type: "Image", src: null, alt, widthPercent: 100 };
  blocks.push(block);
  ctx.jobs.push({ kind: "url", src, place: (d) => { block.src = d; } });
}

/** SVG/Canvas-Grafik einreihen. Wurde ein Mindmap-Baum extrahiert, entsteht statt
 *  eines Bildes ein bearbeitbarer Mindmap-Block; sonst ein (etwas schmaleres) Bild. */
function rasterizeGraphic(el: Element, blocks: any[], ctx: ImportCtx): void {
  // Mindmap erkannt (Baumdaten aus dem Script) → bearbeitbarer Mindmap-Block.
  if (el.tagName !== "CANVAS" && ctx.trees.length > 0) {
    const tree = ctx.trees.shift()!;
    const block: any = { type: "Mindmap", mind: tree, src: null, widthPercent: 80 };
    blocks.push(block);
    ctx.jobs.push({ kind: "mindmap", tree, place: (d) => { block.src = d; } });
    return;
  }
  const block: any = { type: "Image", src: null, alt: "", widthPercent: 70 };
  blocks.push(block);
  if (el.tagName === "CANVAS") ctx.jobs.push({ kind: "canvas", el: el as HTMLCanvasElement, place: (d) => { block.src = d; } });
  else ctx.jobs.push({ kind: "svg", el, place: (d) => { block.src = d; } });
}

/** Läuft die direkten Kinder eines Containers ab und sammelt Blöcke (mit Inline-Puffer für Streutext). */
function walkImportBlocks(root: Element, blocks: any[], ctx: ImportCtx, pageSet: Set<Element>, self: Element): void {
  let inlineBuf = "";
  const flush = () => {
    const t = inlineBuf.replace(/\s+/g, " ").trim();
    if (t) blocks.push({ type: "Paragraph", text: t });
    inlineBuf = "";
  };
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) { inlineBuf += escImportHtml(node.textContent ?? ""); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName;
    if (pageSet.has(el) && el !== self) continue;       // gehört zu einer anderen Seite → Grenze
    if (IMPORT_SKIP_TAGS.has(tag)) continue;
    if (isInlineTag(tag)) { inlineBuf += serializeInline(el); continue; }
    flush();                                            // Block-Element beendet den Inline-Lauf
    handleImportBlock(el, blocks, ctx, pageSet, self);
  }
  flush();
}

/** Emittiert einen Textblock (Absatz) mit optionaler Stil-/Box-Übernahme. */
function pushTextBlock(el: Element, blocks: any[], ctx: ImportCtx, bold = false): void {
  let inner = cleanInlineHtml(el);
  if (!inner) return;
  if (bold) inner = `<strong>${inner}</strong>`;
  if (ctx.win) {
    inner = decorateText(el, ctx.win, inner);
    const box = computeBox(el, ctx.win);
    if (box.hasBox) inner = `<div style="${box.css}">${inner}</div>`;
    blocks.push({ type: "Paragraph", text: inner, ...styleProps(el, ctx.win) });
  } else {
    blocks.push({ type: "Paragraph", text: inner });
  }
}

function handleImportBlock(el: Element, blocks: any[], ctx: ImportCtx, pageSet: Set<Element>, self: Element): void {
  const tag = el.tagName;
  // Grafiken zuerst: gerendertes SVG/Canvas (Mindmap, Diagramme) → Bild.
  if (ctx.win) {
    const g = (tag === "SVG" || tag === "CANVAS") ? el : el.querySelector?.("svg, canvas");
    if (g) { rasterizeGraphic(g, blocks, ctx); return; }
  }
  switch (tag) {
    case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
      const inner = cleanInlineHtml(el);
      if (!inner) return;
      blocks.push({ type: "Heading", level: Math.min(3, Number(tag[1])),
        text: decorateText(el, ctx.win, inner), ...styleProps(el, ctx.win) });
      return;
    }
    case "P": case "BLOCKQUOTE": case "FIGCAPTION": case "PRE": case "DD": case "DT":
      pushTextBlock(el, blocks, ctx); return;
    case "SUMMARY":
      pushTextBlock(el, blocks, ctx, true); return;
    case "UL": case "OL": {
      const list = buildImportList(el);
      if (list) blocks.push({ type: "Paragraph", text: list, ...styleProps(el, ctx.win) });
      return;
    }
    case "TABLE": {
      const tbl = buildImportTable(el);
      if (tbl) blocks.push(tbl);
      return;
    }
    case "IMG": pushImportImage(el, blocks, ctx); return;
    case "HR": blocks.push({ type: "Shape", shape: "divider", color: "#d1d5db", heightPx: 2 }); return;
    default: {
      // Container, der selbst wie eine gestaltete Text-Box aussieht (Hintergrund/
      // Rahmen) und keine eigenständigen Blöcke enthält → als eine Box übernehmen.
      if (ctx.win) {
        const box = computeBox(el, ctx.win);
        const leaf = box.hasBox && !el.querySelector("h1,h2,h3,h4,h5,h6,table,ul,ol,img,svg,canvas") && !!(el.textContent ?? "").trim();
        if (leaf) {
          let inner = cleanInlineHtml(el);
          if (inner) {
            inner = decorateText(el, ctx.win, inner);
            blocks.push({ type: "Paragraph", text: `<div style="${box.css}">${inner}</div>`, ...styleProps(el, ctx.win) });
          }
          return;
        }
      }
      walkImportBlocks(el, blocks, ctx, pageSet, self); // gewöhnlicher Container (div, section, details, figure …)
      return;
    }
  }
}

/** Bestimmt die Seiten-Container (Slides/Sektionen → je eine Seite). */
function collectPageContainers(doc: Document): Element[] {
  const els = Array.from(doc.querySelectorAll(
    ".slide, [class*='slide'], section, article, [data-page], [data-slide]",
  )) as Element[];
  return els.filter((el) => (el.textContent ?? "").trim().length > 0);
}

/** Hintergrundfarbe einer Seite = erste deckende Hintergrundfarbe aufwärts (z. B. Karten-Fläche). */
function pageBgOf(el: Element | null, win: Window): string | null {
  let n: Element | null = el;
  for (let i = 0; i < 6 && n; i++) {
    const c = rgbToHex(win.getComputedStyle(n).backgroundColor);
    if (c && c.toLowerCase() !== "#ffffff") return c;
    n = n.parentElement;
  }
  return null;
}

/** Bettet ein Bild als data-URL ein. 100 % offline: KEINE Requests an fremde Hosts —
 *  data:-URLs sind schon lokal, gleiche Herkunft (eigener Server) ist erlaubt, alles
 *  Fremd-Origin wird beim Import verworfen (kein Nachladen). Fehler → null. */
async function tryEmbedImage(src: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(src, location.href); } catch { return null; }
  if (url.protocol === "data:") return src;                 // bereits lokal, kein Request
  if (url.origin !== location.origin) return null;          // fremder Host → verwerfen
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(url.toString(), { signal: ctrl.signal }); // same-origin, kein cors
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob.type.startsWith("image/") || blob.size > 12_000_000) return null;
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error("read"));
      fr.readAsDataURL(blob);
    });
    return await compressDataUrl(dataUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Rastert ein gerendertes SVG (z. B. die D3-Mindmap) zu einer PNG-data-URL.
 *  Schneidet auf den tatsächlich gezeichneten Inhalt zu (D3 platziert den Baum
 *  oft in einer Ecke der SVG-Fläche → sonst riesige Leerräume / Überlauf). */
async function svgToDataUrl(svg: Element): Promise<string | null> {
  try {
    const svgEl = svg as SVGSVGElement;
    const svgRect = svgEl.getBoundingClientRect();
    if (svgRect.width < 4 || svgRect.height < 4) return null;
    // Standard: ganze SVG-Fläche. SVG hat width/height ohne viewBox → 1 Unit = 1 px.
    let vx = 0, vy = 0, vw = Math.round(svgRect.width), vh = Math.round(svgRect.height);
    // Auf den gezeichneten Inhalt (innere <g>) zuschneiden, falls vorhanden.
    const content = svgEl.querySelector("g");
    if (content) {
      const cr = (content as SVGGraphicsElement).getBoundingClientRect();
      if (cr.width > 4 && cr.height > 4) {
        const pad = 18;
        vx = Math.max(0, Math.round(cr.left - svgRect.left) - pad);
        vy = Math.max(0, Math.round(cr.top - svgRect.top) - pad);
        vw = Math.min(vw - vx, Math.round(cr.width) + pad * 2);
        vh = Math.min(vh - vy, Math.round(cr.height) + pad * 2);
      }
    }
    if (vw < 4 || vh < 4) return null;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
    clone.setAttribute("width", String(vw));
    clone.setAttribute("height", String(vh));
    return await svgStringToPng(new XMLSerializer().serializeToString(clone), vw, vh);
  } catch {
    return null;
  }
}

/** Rastert einen SVG-String (mit bekannter Größe) zu einer PNG-data-URL (2×, weißer Grund). */
async function svgStringToPng(svgStr: string, w: number, h: number): Promise<string | null> {
  try {
    if (w < 4 || h < 4) return null;
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("svg")); img.src = url; });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale; canvas.height = h * scale;
    const cctx = canvas.getContext("2d");
    if (!cctx) return null;
    cctx.fillStyle = "#ffffff"; cctx.fillRect(0, 0, canvas.width, canvas.height);
    cctx.scale(scale, scale);
    cctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// =============================================================================
// Mindmap: Extraktion (aus D3-`treeData`), Zeichnen (eigener Renderer, kein D3)
// und Neu-Rendern aus dem C#-Editor.
// =============================================================================

function mindId(): string {
  try { return crypto.randomUUID().replace(/-/g, ""); }
  catch { return "n" + Math.floor(performance.now() * 1000) + Math.floor(Math.random() * 1e6); }
}

/** Normalisiert ein beliebiges Baum-Objekt ({name|label, children}) auf MNode. */
function normMindNode(o: any, depth = 0): MNode | null {
  if (!o || typeof o !== "object" || depth > 12) return null;
  const label = String(o.name ?? o.label ?? o.title ?? o.text ?? "").replace(/\s+/g, " ").trim();
  const kids = Array.isArray(o.children) ? o.children : (Array.isArray(o._children) ? o._children : []);
  const children = kids.map((k: any) => normMindNode(k, depth + 1)).filter(Boolean) as MNode[];
  return { id: mindId(), label, children };
}

function countMindNodes(n: MNode): number {
  return 1 + n.children.reduce((s, c) => s + countMindNodes(c), 0);
}

/** Liest die schließende Klammer zu `s[open]` ('{') heraus (string-bewusst). */
function readBalancedObject(s: string, open: number): string | null {
  let depth = 0; let str = "";
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (str) { if (ch === "\\") { i++; continue; } if (ch === str) str = ""; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return s.slice(open, i + 1); }
  }
  return null;
}

/** Tolerant-Parser für einfache JS-Objekt-Literale (Mindmap-Bäume) OHNE Code-
 *  Ausführung: erst striktes JSON, sonst Schlüssel quoten / '…' → "…" / Trailing-
 *  Commas entfernen und erneut JSON.parse. Nicht Parsbares → null (wird übersprungen). */
function parseLooseObject(lit: string): any {
  try { return JSON.parse(lit); } catch { /* nicht strikt JSON → normalisieren */ }
  try {
    const s = lit
      .replace(/'(?:[^'\\]|\\.)*'/g, (m) => JSON.stringify(m.slice(1, -1).replace(/\\'/g, "'")))
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(s);
  } catch { return null; }
}

/** Extrahiert Mindmap-Bäume aus `…treeData = { … }`-Literalen der Inline-Skripte.
 *  Das Literal wird OHNE Ausführung geparst (parseLooseObject), nie ge-eval-t. */
function extractMindmapTrees(idoc: Document): MNode[] {
  const trees: MNode[] = [];
  const scripts = Array.from(idoc.querySelectorAll("script")).map((s) => s.textContent || "");
  for (const code of scripts) {
    let idx = code.indexOf("treeData");
    while (idx >= 0) {
      const eq = code.indexOf("=", idx);
      const brace = eq >= 0 ? code.indexOf("{", eq) : -1;
      if (brace >= 0 && brace - eq < 24) {
        const lit = readBalancedObject(code, brace);
        if (lit) {
          const obj = parseLooseObject(lit);
          const t = obj ? normMindNode(obj) : null;
          if (t && countMindNodes(t) >= 2) trees.push(t);
        }
      }
      idx = code.indexOf("treeData", idx + 8);
    }
  }
  // Größten Baum zuerst (typischerweise der eigentliche Inhalt).
  trees.sort((a, b) => countMindNodes(b) - countMindNodes(a));
  return trees;
}

/** Zeichnet einen Mindmap-Baum als horizontalen SVG-Baum (Wurzel links). */
function buildMindmapSvg(root: MNode): { svg: string; w: number; h: number } {
  const rowH = 36, colGap = 54, nodeH = 30, padX = 14;
  const palette = ["#3f6651", "#4A7C59", "#C16641", "#5b7c99", "#8a6d3b", "#7c5b8a"];
  const widthOf = (l: string) => Math.max(54, Math.min(240, (l || " ").length * 7.1 + padX * 2));
  const depthMaxW: number[] = [];
  const measure = (n: MNode, d: number) => { depthMaxW[d] = Math.max(depthMaxW[d] || 0, widthOf(n.label)); n.children.forEach((c) => measure(c, d + 1)); };
  measure(root, 0);
  const colX: number[] = []; let acc = 12;
  for (let d = 0; d < depthMaxW.length; d++) { colX[d] = acc; acc += depthMaxW[d] + colGap; }
  const pos = new Map<MNode, { x: number; y: number; w: number; d: number }>();
  let leaf = 0;
  const assign = (n: MNode, d: number): number => {
    const w = widthOf(n.label);
    let y: number;
    if (!n.children.length) { y = leaf * rowH + rowH / 2; leaf++; }
    else { const ys = n.children.map((c) => assign(c, d + 1)); y = (ys[0] + ys[ys.length - 1]) / 2; }
    pos.set(n, { x: colX[d], y, w, d });
    return y;
  };
  assign(root, 0);
  let maxX = 0, maxY = 0;
  pos.forEach((p) => { maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + nodeH); });
  const W = Math.ceil(maxX + 12), H = Math.ceil(maxY + 8);
  const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let links = "", nodes = "";
  const walk = (n: MNode) => {
    const p = pos.get(n)!;
    for (const c of n.children) {
      const cp = pos.get(c)!;
      const x1 = p.x + p.w, y1 = p.y, x2 = cp.x, y2 = cp.y, mx = (x1 + x2) / 2;
      links += `<path d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="#9aa6a0" stroke-width="2"/>`;
      walk(c);
    }
    const fill = palette[Math.min(p.d, palette.length - 1)];
    nodes += `<g><rect x="${p.x}" y="${p.y - nodeH / 2}" width="${p.w}" height="${nodeH}" rx="${nodeH / 2}" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>`
      + `<text x="${p.x + p.w / 2}" y="${p.y}" dominant-baseline="central" text-anchor="middle" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="13" font-weight="600" fill="#ffffff">${esc(n.label)}</text></g>`;
  };
  walk(root);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="100%" height="100%" fill="#F9F8F6"/>${links}${nodes}</svg>`;
  return { svg, w: W, h: H };
}

/** Vektor-SVG-data-URL eines Baums. Bevorzugt die D3-Bridge (pageboundMind);
 *  ohne sie der eigene schlanke Renderer als Fallback. Synchron (Import-Job). */
function renderMindmapDataUrlSafe(tree: MNode): string {
  const pm = (globalThis as any).pageboundMind;
  if (pm && typeof pm.renderMindmapDataUrl === "function") {
    try { return pm.renderMindmapDataUrl(JSON.stringify(tree)); } catch { /* Fallback unten */ }
  }
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(buildMindmapSvg(tree).svg);
}

/** Zeichnet einen Mindmap-Baum (JSON) und liefert eine komprimierte PNG-data-URL.
 *  Vom C#-Editor nach jeder Baum-Änderung aufgerufen. */
export async function renderMindmapImage(treeJson: string): Promise<string> {
  let root: MNode;
  try { root = JSON.parse(treeJson); } catch { return ""; }
  if (!root || typeof root !== "object") return "";
  if (!Array.isArray(root.children)) root.children = [];
  const { svg, w, h } = buildMindmapSvg(root);
  const png = await svgStringToPng(svg, w, h);
  if (!png) return "";
  try { return await compressDataUrl(png); } catch { return png; }
}

/** Macht alle Folien/Sektionen sichtbar (sonst 0-Breite → Grafiken rendern nicht). */
function forceVisible(idoc: Document): void {
  idoc.querySelectorAll<HTMLElement>(".slide, section, article").forEach((el) => {
    el.classList.add("active");
    el.style.setProperty("display", "block", "important");
    el.style.opacity = "1";
    el.style.visibility = "visible";
  });
}

/** Stößt bekannte Lazy-Renderer (z. B. D3-Mindmap) an. Bewusst KEINE Navigations-/
 *  Update-Funktionen — die würden Folien wieder verstecken. Alles best-effort. */
function triggerGraphics(win: Window): void {
  const re = /(mind|chart|graph|diagram|tree|plot)/i;
  const skip = /(update|nav|next|prev|slide|hide|show)/i;
  let names: string[] = [];
  try { names = Object.getOwnPropertyNames(win); } catch { names = []; }
  for (const k of names) {
    if (!re.test(k) || skip.test(k)) continue;
    try { const fn = (win as any)[k]; if (typeof fn === "function") fn.call(win); } catch { /* egal */ }
  }
}

/**
 * Rich-Import: rendert die Datei in einem Sandbox-iframe OHNE Skriptausführung
 * (nur allow-same-origin) und übernimmt die aus statischem CSS berechneten Stile/
 * Boxen/Schriftgrößen auf die Block-Eigenschaften; SVG-Grafiken und Mindmap-Bäume
 * werden zu Bildern verarbeitet. Texte bleiben editierbar. Fehler → struktureller Fallback.
 */
async function importHtmlRich(html: string): Promise<string> {
  const iframe = document.createElement("iframe");
  // Sicherheit: NUR allow-same-origin (damit der Parent Layout/getComputedStyle des
  // iframes lesen darf), aber KEIN allow-scripts. So werden Skripte aus der fremden
  // HTML-Datei NIE ausgeführt (XSS im App-Origin ausgeschlossen). Farben/Boxen kommen
  // aus statischem CSS (inline <style>/style=""), Mindmap-Bäume werden aus dem Skript-
  // TEXT geparst (ohne Ausführung) und über unseren eigenen Renderer neu gezeichnet.
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText = "position:fixed;left:-12000px;top:0;width:1100px;height:1500px;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);
  try {
    const win = iframe.contentWindow as Window | null;
    const idoc = iframe.contentDocument;
    if (!win || !idoc) throw new Error("iframe");
    await new Promise<void>((res) => {
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      iframe.addEventListener("load", () => fin(), { once: true });
      idoc.open(); idoc.write(html ?? ""); idoc.close();
      setTimeout(fin, 4500); // harte Obergrenze, falls kein load-Event feuert
    });
    await delay(600);                 // Tailwind-/CSS-Stile anwenden lassen
    forceVisible(idoc);
    triggerGraphics(win);
    forceVisible(idoc);               // erneut, falls ein Trigger Sichtbarkeit verändert hat
    await delay(550);                 // Mindmap zeichnen / Layout setzen lassen

    const title = (idoc.querySelector("title")?.textContent || idoc.querySelector("h1")?.textContent || "Import")
      .replace(/\s+/g, " ").trim().slice(0, 120) || "Import";

    const ctx: ImportCtx = { jobs: [], win, trees: extractMindmapTrees(idoc) };
    const pageEls = collectPageContainers(idoc);
    const pages: any[] = [];
    if (pageEls.length > 0) {
      const pageSet = new Set(pageEls);
      for (const pageEl of pageEls) {
        const blocks: any[] = [];
        walkImportBlocks(pageEl, blocks, ctx, pageSet, pageEl);
        pages.push({ background: pageBgOf(pageEl, win), blocks });
      }
    } else {
      const blocks: any[] = [];
      const body = idoc.body ?? idoc.documentElement;
      walkImportBlocks(body, blocks, ctx, new Set(), body);
      pages.push({ background: pageBgOf(body, win), blocks });
    }

    // Medien auflösen, solange das iframe noch lebt (Rasterung liest Live-Elemente).
    await Promise.all(ctx.jobs.map(async (j) => {
      let url: string | null = null;
      try {
        if (j.kind === "url") url = await tryEmbedImage(j.src);
        else if (j.kind === "svg") url = await svgToDataUrl(j.el);
        else if (j.kind === "canvas") url = j.el.toDataURL("image/png");
        else if (j.kind === "mindmap") url = renderMindmapDataUrlSafe(j.tree);
      } catch { url = null; }
      // Mindmaps sind Vektor-SVG (scharf im Druck) → nicht rastern/komprimieren.
      if (url && j.kind !== "mindmap") { try { url = await compressDataUrl(url); } catch { /* Original behalten */ } }
      j.place(url);
    }));

    for (const p of pages) p.blocks = p.blocks.filter((b: any) => !(b.type === "Image" && !b.src));
    let result = pages.filter((p) => p.blocks.length > 0);
    if (result.length === 0) result = [{ blocks: [] }];
    const slideLike = pageEls.some((el) => /slide/i.test(el.className || ""));
    return JSON.stringify({ title, layout: slideLike ? "Slide16x9" : "A4Portrait", pages: result });
  } finally {
    iframe.remove();
  }
}

/** Struktureller Import ohne Stile/Grafiken (Fallback, falls Rich-Render scheitert). */
async function importHtmlStructural(html: string): Promise<string> {
  const dom = new DOMParser().parseFromString(html ?? "", "text/html");
  const title = (dom.querySelector("title")?.textContent || dom.querySelector("h1")?.textContent || "Import")
    .replace(/\s+/g, " ").trim().slice(0, 120) || "Import";
  const ctx: ImportCtx = { jobs: [], win: null, trees: [] };
  const pageEls = collectPageContainers(dom);
  const pages: any[] = [];
  if (pageEls.length > 0) {
    const pageSet = new Set(pageEls);
    for (const pageEl of pageEls) {
      const blocks: any[] = [];
      walkImportBlocks(pageEl, blocks, ctx, pageSet, pageEl);
      pages.push({ blocks });
    }
  } else {
    const blocks: any[] = [];
    const body = dom.body ?? dom.documentElement;
    walkImportBlocks(body, blocks, ctx, new Set(), body);
    pages.push({ blocks });
  }
  await Promise.all(ctx.jobs.map(async (j) => { j.place(j.kind === "url" ? await tryEmbedImage(j.src) : null); }));
  for (const p of pages) p.blocks = p.blocks.filter((b: any) => !(b.type === "Image" && !b.src));
  let result = pages.filter((p) => p.blocks.length > 0);
  if (result.length === 0) result = [{ blocks: [] }];
  const slideLike = pageEls.some((el) => /slide/i.test(el.className || ""));
  return JSON.stringify({ title, layout: slideLike ? "Slide16x9" : "A4Portrait", pages: result });
}

/**
 * Importiert eine HTML-Datei als EditorDocument-JSON. Versucht den Rich-Modus
 * (Stil-Übernahme + Grafik-Rasterung im Sandbox-iframe); fällt bei Fehlern auf
 * den rein strukturellen Import zurück. Rückgabe läuft C#-seitig durch ParseDesignJsonAsync.
 */
export async function importHtmlToDocument(html: string): Promise<string> {
  try {
    return await importHtmlRich(html);
  } catch {
    return await importHtmlStructural(html);
  }
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
