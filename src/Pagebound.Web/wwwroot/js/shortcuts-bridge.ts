// =============================================================================
// Pagebound — Keyboard Shortcuts Bridge
// ----------------------------------------------------------------------------
// Registers a single window-level keydown listener that forwards interesting
// shortcuts to a Blazor component via DotNetObjectReference. Each component
// (currently only ReaderPage) calls register() on mount and unregister() on
// dispose, so shortcuts are only active where they make sense.
//
// Active shortcut → C# string mapping (string keeps the interop signature tiny):
//   ArrowLeft  / PageUp      → "page-prev"
//   ArrowRight / PageDown    → "page-next"
//   Home                     → "page-first"
//   End                      → "page-last"
//   Ctrl+F                   → "focus-search"   (preventDefault → no browser find)
//   Escape                   → "clear-search"
//   Ctrl+= / Ctrl++          → "zoom-in"        (preventDefault)
//   Ctrl+-                   → "zoom-out"       (preventDefault)
//   Ctrl+0                   → "zoom-reset"     (preventDefault)
//
// While focus is inside an input/textarea/select/contenteditable, only Escape
// and Ctrl+F fire — everything else is left to the form control.
// =============================================================================

type DotNetRef = {
  invokeMethodAsync: (methodName: string, ...args: unknown[]) => Promise<unknown>;
};

let activeRef: DotNetRef | null = null;
let handler: ((e: KeyboardEvent) => void) | null = null;

function isEditingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function shortcutFor(e: KeyboardEvent): { id: string; preventDefault: boolean } | null {
  const editing = isEditingTarget(e.target);

  // Allowed while editing:
  if (e.key === "Escape") return { id: "clear-search", preventDefault: false };
  if (e.ctrlKey && (e.key === "f" || e.key === "F")) {
    return { id: "focus-search", preventDefault: true };
  }

  // Block everything else while typing:
  if (editing) return null;

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === "ArrowLeft" || e.key === "PageUp") {
      return { id: "page-prev", preventDefault: true };
    }
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      return { id: "page-next", preventDefault: true };
    }
    if (e.key === "Home") return { id: "page-first", preventDefault: true };
    if (e.key === "End") return { id: "page-last", preventDefault: true };
  }

  if (e.ctrlKey && !e.altKey) {
    if (e.key === "=" || e.key === "+") return { id: "zoom-in", preventDefault: true };
    if (e.key === "-") return { id: "zoom-out", preventDefault: true };
    if (e.key === "0") return { id: "zoom-reset", preventDefault: true };
  }

  return null;
}

export function register(ref: DotNetRef): void {
  unregister();
  activeRef = ref;
  handler = (e: KeyboardEvent) => {
    const sc = shortcutFor(e);
    if (!sc) return;
    if (sc.preventDefault) e.preventDefault();
    // Fire-and-forget; errors on the C# side are surfaced through Blazor's
    // own unhandled-exception channel, no need to attach a catch here.
    void activeRef?.invokeMethodAsync("HandleShortcut", sc.id);
  };
  window.addEventListener("keydown", handler);
}

export function unregister(): void {
  if (handler) {
    window.removeEventListener("keydown", handler);
    handler = null;
  }
  activeRef = null;
}

export function focusElement(selector: string): void {
  const el = document.querySelector(selector);
  if (el instanceof HTMLElement) el.focus();
}

/**
 * Convert an absolute clientX/clientY (from a mouse event) into a 0..1
 * fraction relative to the element matched by the given selector. The value
 * is clamped to the [0, 1] range so callers can store it as a position even
 * if the click happens to land just outside the element.
 *
 * Returns null when the selector does not match an HTMLElement.
 */
export function clientPositionToFraction(
  selector: string,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y))
  };
}

export interface SelectionFractionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionInContainer {
  text: string;
  rects: SelectionFractionRect[];
  anchorX: number;
  anchorY: number;
}

/**
 * Read the current text selection and project its bounding rectangles into
 * 0..1 fractions of the element matched by the given selector. Returns null
 * when there is no live selection or it does not intersect the container.
 *
 * Used by the Highlight feature (FA-010) to translate a Browser
 * selection over the PDF text layer into a stored HighlightAnnotation.
 */
export function getCurrentTextSelection(
  containerSelector: string
): SelectionInContainer | null {
  const container = document.querySelector(containerSelector);
  if (!(container instanceof HTMLElement)) return null;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  // We require the selection to live inside the container; otherwise this
  // event is not "ours" (e.g. user selected text in the sidebar).
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  const text = selection.toString();
  if (text.trim().length === 0) return null;

  const containerRect = container.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0) return null;

  const clientRects = Array.from(range.getClientRects());
  const rects: SelectionFractionRect[] = clientRects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x: (r.left - containerRect.left) / containerRect.width,
      y: (r.top - containerRect.top) / containerRect.height,
      width: r.width / containerRect.width,
      height: r.height / containerRect.height
    }))
    .filter((r) => r.width > 0 && r.height > 0);

  if (rects.length === 0) return null;

  // Anchor point for an inline toolbar: top-center of the first rect.
  const anchorX = rects[0].x + rects[0].width / 2;
  const anchorY = rects[0].y;

  return { text, rects, anchorX, anchorY };
}

export function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
}
