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

/**
 * Live-drag an element inside a container, snapping to the container's 0..1
 * fraction grid. Used to move PNG signatures around the PDF canvas (FA-015).
 *
 * Behaviour:
 *  - At mousedown, the caller captures the start clientX/clientY and passes
 *    them in; we compute the offset between mouse and element top-left so
 *    the element follows the cursor naturally (no jump on first pointermove).
 *  - During pointermove we write live left/top CSS in percent of the
 *    container, so the element follows the cursor at 60 fps without a
 *    Blazor round-trip per event.
 *  - At pointerup we drop the listeners, clamp the final fractions into
 *    [0, 1 - element-extent] so the element stays inside the container,
 *    and call back into C# (dotNetRef.invokeMethodAsync(callbackMethod,
 *    callbackArg, finalX, finalY)) so the page can persist the move.
 */
export function dragElementToFraction(
  elementSelector: string,
  containerSelector: string,
  startClientX: number,
  startClientY: number,
  dotNetRef: DotNetRef,
  callbackMethod: string,
  callbackArg: string
): void {
  const element = document.querySelector(elementSelector);
  const container = document.querySelector(containerSelector);
  if (!(element instanceof HTMLElement) || !(container instanceof HTMLElement)) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0) return;

  // How far inside the element the cursor grabbed — keeps the grab point
  // aligned with the cursor for the whole drag.
  const grabOffsetX = startClientX - elementRect.left;
  const grabOffsetY = startClientY - elementRect.top;

  // Element extent as 0..1 fraction; used to clamp the top-left so the
  // element never leaves the container.
  const elementWidthFrac = elementRect.width / containerRect.width;
  const elementHeightFrac = elementRect.height / containerRect.height;

  let finalX = (elementRect.left - containerRect.left) / containerRect.width;
  let finalY = (elementRect.top - containerRect.top) / containerRect.height;

  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  const onMove = (e: PointerEvent) => {
    e.preventDefault();
    const rawX = (e.clientX - grabOffsetX - containerRect.left) / containerRect.width;
    const rawY = (e.clientY - grabOffsetY - containerRect.top) / containerRect.height;
    finalX = clamp(rawX, 0, Math.max(0, 1 - elementWidthFrac));
    finalY = clamp(rawY, 0, Math.max(0, 1 - elementHeightFrac));
    element.style.left = `${(finalX * 100).toFixed(3)}%`;
    element.style.top = `${(finalY * 100).toFixed(3)}%`;
  };

  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    void dotNetRef.invokeMethodAsync(callbackMethod, callbackArg, finalX, finalY);
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
}

/**
 * Trigger a file download from in-memory text. Used by the Markdown export
 * (FA-080) and likely by future sidecar / image exports. We stay on the
 * blob+object-url pattern so very large strings don't have to live inside
 * a data: URL.
 */
export function downloadFile(
  filename: string,
  content: string,
  mimeType: string = "text/plain"
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Binary variant of downloadFile: takes Base64-encoded bytes and produces a
 * proper binary Blob with the given mime type. Used by the PDF-tools save
 * action (FA-020..024) so the resulting PDF is byte-perfect.
 */
export function downloadBytes(
  filename: string,
  base64: string,
  mimeType: string
): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
