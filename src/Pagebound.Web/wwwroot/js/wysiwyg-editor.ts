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

export function registerFileDrop(dotnetRef: { invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown> }): void {
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
