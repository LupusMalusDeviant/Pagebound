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
