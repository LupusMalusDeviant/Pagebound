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

/**
 * Initialisiert eine contentEditable-Wurzel: erzwingt Einfügen als REINEN Text
 * (kein Fremd-HTML aus der Zwischenablage → konsistentes, sauberes Dokument).
 * Mehrfachaufruf ist idempotent (Flag am Element).
 */
export function initializeEditor(elementId: string): void {
  const root = document.getElementById(elementId);
  if (!root || (root as any).__pbWired) return;
  (root as any).__pbWired = true;
  root.addEventListener("paste", (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.isContentEditable) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text);
  });
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
