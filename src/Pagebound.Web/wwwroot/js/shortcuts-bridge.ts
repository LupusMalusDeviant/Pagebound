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
    // Fire-and-forget. .catch ist nötig: feuert ein Tastendruck genau während die
    // Komponente disposed wird (Navigation), rejectet invokeMethodAsync mit
    // "There is no tracked object with id …" — ohne catch wird das ein
    // "Uncaught (in promise)" in der Konsole. Der Reject bedeutet nur "Ref weg".
    void activeRef?.invokeMethodAsync("HandleShortcut", sc.id).catch(() => { /* Komponente disposed */ });
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
    // F-13: Kommt der erste pointermove OHNE gedrückte Taste, ist das ein
    // schneller Klick, dessen pointerup schon vor dem Listener-Attach kam (die
    // Listener werden erst nach C#→JS-Hops registriert). Dann NICHT mitziehen
    // ("Ghost-Drag"), sondern sofort mit den aktuellen (Start-)Koordinaten
    // abschließen — beendet zugleich das hängende pointerup sauber.
    if (e.buttons === 0) {
      onUp();
      return;
    }
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
    // .catch: endet der Drag erst nachdem die Reader-Komponente disposed wurde,
    // ist die Ref weg → Reject bewusst schlucken statt "Uncaught (in promise)".
    void dotNetRef.invokeMethodAsync(callbackMethod, callbackArg, finalX, finalY).catch(() => { /* Komponente disposed */ });
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
}

/**
 * Live-resize an element inside a container by dragging its bottom-right
 * corner. Companion to `dragElementToFraction`. Used for the signature
 * resize handle (FA-015).
 *
 * Live-writes width / height as percent of the container during pointermove,
 * clamps so the element does not leave the container nor go below a tiny
 * minimum, and reports the final 0..1 fractions back to C# at pointerup.
 */
export function resizeElementToFraction(
  elementSelector: string,
  containerSelector: string,
  startClientX: number,
  startClientY: number,
  minWidthFrac: number,
  minHeightFrac: number,
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

  const leftFrac = (elementRect.left - containerRect.left) / containerRect.width;
  const topFrac = (elementRect.top - containerRect.top) / containerRect.height;

  let finalW = elementRect.width / containerRect.width;
  let finalH = elementRect.height / containerRect.height;

  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  const onMove = (e: PointerEvent) => {
    e.preventDefault();
    // Mauszeiger relativ zum Container.
    const cursorXFrac = (e.clientX - containerRect.left) / containerRect.width;
    const cursorYFrac = (e.clientY - containerRect.top) / containerRect.height;
    finalW = clamp(cursorXFrac - leftFrac, minWidthFrac, 1 - leftFrac);
    finalH = clamp(cursorYFrac - topFrac, minHeightFrac, 1 - topFrac);
    element.style.width = `${(finalW * 100).toFixed(3)}%`;
    element.style.height = `${(finalH * 100).toFixed(3)}%`;
  };

  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    // .catch: Ref evtl. schon disposed (s. o.) → Reject schlucken.
    void dotNetRef.invokeMethodAsync(callbackMethod, callbackArg, finalW, finalH).catch(() => { /* Komponente disposed */ });
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
 * Öffnet base64-Bytes als Blob in einem neuen Browser-Tab (für ansehbare Formate
 * wie SVG/PDF/PNG/Text). Der Aufruf muss aus einer Nutzer-Geste kommen (Button),
 * sonst blockt der Popup-Blocker. 100 % lokal — die Blob-URL ist same-origin.
 */
export function openBytesInNewTab(base64: string, mimeType: string): void {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    window.open(url, "_blank", "noopener");
    // Nicht sofort widerrufen — der neue Tab lädt die URL asynchron.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    /* ignore */
  }
}

// ============================================================================
// Drawing capture (FA-013 Stift, FA-014 Formen)
// ----------------------------------------------------------------------------
// `startDrawingCapture` attaches pointer listeners to a page-canvas element
// and renders a live SVG preview during each pointerdown→up cycle. At pointerup
// it calls back into C# with the captured points in 0..1 page coordinates so
// the Razor side can persist the Annotation. Designed to stay attached for
// many strokes/shapes in a row (the user picks a tool and draws multiple
// times) — `stopDrawingCapture` removes the listeners and the preview SVG
// when the user leaves the drawing mode.

type DrawMode = "ink" | "rect" | "arrow" | "line";

interface DrawingCaptureOptions {
  color: string;
  /** Strichstärke als Anteil der Container-Breite. JS rechnet daraus die
   *  Pixel-Stärke für den Live-Preview und gibt sie 1:1 zurück an C#. */
  strokeWidthFraction: number;
}

interface DrawingResult {
  mode: DrawMode;
  color: string;
  strokeWidthFraction: number;
  strokes: { x: number; y: number }[][];
}

let activeDrawingCapture: { cleanup: () => void } | null = null;

export function startDrawingCapture(
  containerSelector: string,
  mode: DrawMode,
  options: DrawingCaptureOptions,
  dotNetRef: DotNetRef,
  callbackMethod: string
): void {
  stopDrawingCapture();

  const container = document.querySelector(containerSelector);
  if (!(container instanceof HTMLElement)) return;

  const strokeWidthPx = Math.max(
    1,
    options.strokeWidthFraction * container.clientWidth
  );

  // Eigener SVG-Layer für Live-Preview. Wir hängen ihn an den Container, nicht
  // an document.body — dann skaliert er mit der Seite und ist bei Page-Wechsel
  // sofort weg (Container wird neu gerendert).
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute(
    "style",
    "position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:30;"
  );
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("preserveAspectRatio", "none");
  container.appendChild(svg);

  let isDrawing = false;
  let inkPoints: { x: number; y: number }[] = [];
  let shapeStart: { x: number; y: number } | null = null;
  let shapeEnd: { x: number; y: number } | null = null;
  let previewNode: SVGElement | null = null;

  function pointFromEvent(e: PointerEvent): { x: number; y: number } {
    const rect = container!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function clearPreview(): void {
    if (previewNode) {
      previewNode.remove();
      previewNode = null;
    }
  }

  function renderInkPreview(): void {
    clearPreview();
    if (inkPoints.length < 2) return;
    const d = inkPoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", options.color);
    path.setAttribute("stroke-width", String(strokeWidthPx));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(path);
    previewNode = path;
  }

  function renderShapePreview(): void {
    clearPreview();
    if (!shapeStart || !shapeEnd) return;
    let node: SVGElement;
    if (mode === "rect") {
      const x = Math.min(shapeStart.x, shapeEnd.x);
      const y = Math.min(shapeStart.y, shapeEnd.y);
      const w = Math.abs(shapeEnd.x - shapeStart.x);
      const h = Math.abs(shapeEnd.y - shapeStart.y);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(h));
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", options.color);
      rect.setAttribute("stroke-width", String(strokeWidthPx));
      rect.setAttribute("vector-effect", "non-scaling-stroke");
      node = rect;
    } else {
      // arrow + line: gerade Linie zwischen Start und Ende
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(shapeStart.x));
      line.setAttribute("y1", String(shapeStart.y));
      line.setAttribute("x2", String(shapeEnd.x));
      line.setAttribute("y2", String(shapeEnd.y));
      line.setAttribute("stroke", options.color);
      line.setAttribute("stroke-width", String(strokeWidthPx));
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      if (mode === "arrow") {
        // Spitze im quadratischen Pixel-Raum berechnen (x mit dem Seiten-
        // verhältnis skalieren), sonst verzerrt der viewBox 0..1 mit
        // preserveAspectRatio=none die Geometrie → schiefe Spitze.
        const aspect = container!.clientWidth / Math.max(1, container!.clientHeight);
        const sxs = shapeStart.x * aspect;
        const exs = shapeEnd.x * aspect;
        const dxs = exs - sxs;
        const dys = shapeEnd.y - shapeStart.y;
        const len = Math.hypot(dxs, dys);
        if (len > 0) {
          const ux = dxs / len;
          const uy = dys / len;
          // skaliert mit der Strichstärke (Seitenbreiten-Anteil → ×aspect),
          // bei kurzen Pfeilen auf 40 % der Länge gedeckelt.
          const arrowSize = Math.min(len * 0.4, Math.max(0.024, options.strokeWidthFraction * aspect * 4.0));
          const baseX = exs - ux * arrowSize;
          const baseY = shapeEnd.y - uy * arrowSize;
          // Schaft endet an der Spitzen-Basis (Rundkappe unter dem Dreieck → kein Punkt).
          line.setAttribute("x2", String(baseX / aspect));
          line.setAttribute("y2", String(baseY));
          // 90° gedrehte Normale (im skalierten Raum)
          const nx = -uy;
          const ny = ux;
          const halfBase = arrowSize * 0.5;
          const p1 = `${shapeEnd.x},${shapeEnd.y}`;
          const p2 = `${(baseX + nx * halfBase) / aspect},${baseY + ny * halfBase}`;
          const p3 = `${(baseX - nx * halfBase) / aspect},${baseY - ny * halfBase}`;
          const tri = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          tri.setAttribute("points", `${p1} ${p2} ${p3}`);
          tri.setAttribute("fill", options.color);
          tri.setAttribute("stroke", "none");
          // Wir bauen ein Gruppe-Node aus Line + Triangle.
          const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
          group.appendChild(line);
          group.appendChild(tri);
          node = group;
        } else {
          node = line;
        }
      } else {
        node = line;
      }
    }
    svg.appendChild(node);
    previewNode = node;
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    isDrawing = true;
    const p = pointFromEvent(e);
    if (mode === "ink") {
      inkPoints = [p];
      renderInkPreview();
    } else {
      shapeStart = p;
      shapeEnd = p;
      renderShapePreview();
    }
    container!.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent): void {
    if (!isDrawing) return;
    const p = pointFromEvent(e);
    if (mode === "ink") {
      const last = inkPoints[inkPoints.length - 1];
      // Sehr nahe Punkte überspringen, damit die Stroke-Liste nicht unnötig
      // groß wird — JSON-Roundtrip + IndexedDB-Persistenz danken's.
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.002) {
        inkPoints.push(p);
        renderInkPreview();
      }
    } else {
      shapeEnd = p;
      renderShapePreview();
    }
  }

  function onUp(e: PointerEvent): void {
    if (!isDrawing) return;
    isDrawing = false;
    try {
      container!.releasePointerCapture(e.pointerId);
    } catch {
      // OK — Browser hat capture eventuell schon implizit freigegeben.
    }
    let result: DrawingResult | null = null;
    const strokeWidthFraction = options.strokeWidthFraction;
    if (mode === "ink") {
      if (inkPoints.length >= 2) {
        result = {
          mode,
          color: options.color,
          strokeWidthFraction,
          strokes: [inkPoints.slice()]
        };
      }
      inkPoints = [];
    } else {
      if (shapeStart && shapeEnd) {
        // Mini-Bewegungen (Single-Click) verwerfen.
        const dist = Math.hypot(shapeEnd.x - shapeStart.x, shapeEnd.y - shapeStart.y);
        if (dist > 0.005) {
          result = {
            mode,
            color: options.color,
            strokeWidthFraction,
            strokes: [[shapeStart, shapeEnd]]
          };
        }
      }
      shapeStart = null;
      shapeEnd = null;
    }
    clearPreview();
    if (result) {
      // .catch: Ref evtl. schon disposed (Mode-Wechsel/Navigation) → Reject schlucken.
      void dotNetRef.invokeMethodAsync(callbackMethod, result).catch(() => { /* Komponente disposed */ });
    }
  }

  container.addEventListener("pointerdown", onDown);
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerup", onUp);
  container.addEventListener("pointercancel", onUp);

  activeDrawingCapture = {
    cleanup(): void {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      clearPreview();
      svg.remove();
    }
  };
}

export function stopDrawingCapture(): void {
  activeDrawingCapture?.cleanup();
  activeDrawingCapture = null;
}

/**
 * Binary variant of downloadFile: takes Base64-encoded bytes and produces a
 * proper binary Blob with the given mime type. Used by the PDF-tools save
 * action (FA-020..024) so the resulting PDF is byte-perfect.
 */
/**
 * Theme-Switch (FA-100): setzt das `data-theme`-Attribut am <html>-Element
 * passend zu den CSS-Variablen in `app.src.css`. Ein leerer Name entfernt
 * das Attribut wieder, dann greift der `prefers-color-scheme`-Fallback.
 */
export function applyTheme(name: string): void {
  const html = document.documentElement;
  if (name) {
    html.setAttribute("data-theme", name);
  } else {
    html.removeAttribute("data-theme");
  }
}

/** Sprache (FA-101) als `lang`-Attribut am <html>-Element setzen. */
export function applyLang(code: string): void {
  if (code) {
    document.documentElement.setAttribute("lang", code);
  }
}

/** Voller Seiten-Reload — z.B. nach Sprachwechsel (alles soll neu rendern). */
export function reload(): void {
  window.location.reload();
}

/**
 * Skaliert jeden Text-Layer-Span pixel-genau auf seine Ziel-Bounding-Box,
 * indem `transform: scaleX(...) scaleY(...)` so gesetzt wird, dass die
 * tatsächlich gerenderte Glyphen-Breite/Höhe mit der erwarteten übereinstimmt.
 *
 * Hintergrund: Im PDF-Reader liegt ein transparenter Text-Layer über dem
 * gerenderten Seitenbild, damit der User Text markieren und der Browser ihn
 * suchen kann. Die Spans bekommen Position + Width in Prozent der Seite
 * sowie eine font-size, aber das Browser-Font-Rendering produziert nie exakt
 * dieselben Glyphen-Maße wie das Original-PDF. Ohne Skalierung wandern die
 * Selection-Highlights spürbar gegen das eigentliche Schriftbild — bei OCR-
 * Output ist das besonders auffällig, weil dort jedes Wort eine eigene Box
 * hat. Nach dem ersten DOM-Render messen wir `scrollWidth` und korrigieren.
 *
 * Erwartet pro Span:
 *   data-pb-text="true"
 *   data-pb-target-width / data-pb-target-height = Pixel-Breite/Höhe der
 *     Ziel-Bounding-Box im Container.
 */
export function fixTextLayerScale(containerSelector: string): void {
  const container = document.querySelector(containerSelector);
  if (!(container instanceof HTMLElement)) return;
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0) return;
  const spans = container.querySelectorAll('span[data-pb-text="true"]');
  spans.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    // Nur scaleX — scaleY würde die Glyphen-Höhe stauchen/strecken und das
    // Schriftbild verzerren. font-size aus dem Razor-style sorgt schon für
    // die richtige vertikale Größe; die Pixel-Position wird vom `top`-Style
    // gesetzt.
    const wPercent = parseFloat(node.dataset.pbTargetWidth ?? "");
    if (!isFinite(wPercent) || wPercent <= 0) return;
    const targetPx = (wPercent / 100) * rect.width;

    // Transform vor der Messung zurücksetzen, sonst rechnen wir bei jedem
    // Re-Render mit dem schon skalierten scrollWidth weiter.
    node.style.transform = "";
    const natW = node.scrollWidth;
    if (natW <= 0) return;
    const sx = targetPx / natW;
    if (!isFinite(sx) || sx <= 0) return;
    node.style.transform = `scaleX(${sx.toFixed(4)})`;
    node.style.transformOrigin = "top left";
  });
}

/**
 * Robuste localStorage-Wrapper. Direktes `IJSRuntime.InvokeAsync("localStorage.getItem", ...)`
 * funktioniert in Blazor WASM nicht zuverlässig — die Bridge ruft die Methode dort
 * ohne korrektes `this`-Binding auf. Hier explizit auf `window.localStorage`.
 */
export function getStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private-Mode / disabled storage — silently ignore.
  }
}

// Optionaler Beobachter für PDF-Downloads: Der Reader registriert sich hier,
// um Werkzeug-Ergebnisse aus dem „Werkzeuge"-Tab direkt übernehmen zu können
// (UI-Konsolidierung) — der normale Download läuft unverändert zusätzlich.
let downloadObserver: { invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown> } | null = null;

export function registerDownloadObserver(dotnetRef: { invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown> }): void {
  downloadObserver = dotnetRef;
}

export function unregisterDownloadObserver(): void {
  downloadObserver = null;
}

export function downloadBytes(
  filename: string,
  base64: string,
  mimeType: string
): void {
  if (downloadObserver && mimeType === "application/pdf") {
    void downloadObserver.invokeMethodAsync("OnPdfDownloaded", filename, base64).catch(() => undefined);
  }
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

// ---------------------------------------------------------------------------
// Signatur-Pad: freihändiges Zeichnen einer Unterschrift auf einem <canvas>.
// Pointer-Events werden hier (JS) verarbeitet — pro Strich einen Interop-Call
// zu machen wäre zu chattig. C# ruft init → (Nutzer zeichnet) → getDataUrl.
// ---------------------------------------------------------------------------
interface SigPad {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  drawing: boolean;
  lastX: number;
  lastY: number;
  dirty: boolean;
  handlers: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: (e: PointerEvent) => void };
}
const signaturePads = new Map<string, SigPad>();

export function initSignaturePad(selector: string): void {
  const canvas = document.querySelector(selector);
  if (!(canvas instanceof HTMLCanvasElement)) return;
  disposeSignaturePad(selector);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111827";
  const pad: SigPad = { canvas, ctx, drawing: false, lastX: 0, lastY: 0, dirty: false, handlers: null as never };
  const pos = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };
  const down = (e: PointerEvent) => {
    e.preventDefault();
    pad.drawing = true;
    const p = pos(e);
    pad.lastX = p.x;
    pad.lastY = p.y;
    // Einzelpunkt (Tippen) sichtbar machen
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.fill();
    pad.dirty = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const move = (e: PointerEvent) => {
    if (!pad.drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(pad.lastX, pad.lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    pad.lastX = p.x;
    pad.lastY = p.y;
    pad.dirty = true;
  };
  const up = () => { pad.drawing = false; };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointerleave", up);
  pad.handlers = { down, move, up };
  signaturePads.set(selector, pad);
}

export function clearSignaturePad(selector: string): void {
  const pad = signaturePads.get(selector);
  if (!pad) return;
  pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  pad.dirty = false;
}

export function getSignatureDataUrl(selector: string): string | null {
  const pad = signaturePads.get(selector);
  if (!pad || !pad.dirty) return null;
  return pad.canvas.toDataURL("image/png");
}

export function disposeSignaturePad(selector: string): void {
  const pad = signaturePads.get(selector);
  if (!pad) return;
  pad.canvas.removeEventListener("pointerdown", pad.handlers.down);
  pad.canvas.removeEventListener("pointermove", pad.handlers.move);
  pad.canvas.removeEventListener("pointerup", pad.handlers.up);
  pad.canvas.removeEventListener("pointerleave", pad.handlers.up);
  signaturePads.delete(selector);
}
