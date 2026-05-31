// =============================================================================
// Pagebound — Split-View Bridge
// ----------------------------------------------------------------------------
// Two DOM concerns for the side-by-side Split-View (FA-092):
//   1. Drag-resize of the divider ("gutter") between the two reader panes.
//   2. Optional synchronized, proportional scrolling between the panes.
//
// Both manipulate the DOM directly so the per-frame work stays smooth — Blazor
// is only involved in enabling/disabling, never per pointer-move or per scroll.
// Exposed as the `pageboundSplit` IIFE global (see esbuild.mjs).
//
// Module-level state is intentionally single-instance: there is only ever one
// Split-View mounted at a time. Both init functions tear down any previous
// wiring first, so navigating away and back cannot stack listeners.
// =============================================================================

// --- Resize -----------------------------------------------------------------

interface ResizeState {
  gutter: HTMLElement;
  onDown: (e: PointerEvent) => void;
}

let resizeState: ResizeState | null = null;

// Keep both panes usefully visible — never let one collapse completely.
const MIN_FRAC = 0.15;
const MAX_FRAC = 0.85;

export function initResize(
  container: HTMLElement,
  gutter: HTMLElement,
  leftPane: HTMLElement
): void {
  teardownResize();
  if (!container || !gutter || !leftPane) return;

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    // Pointer capture routes every subsequent move/up to the gutter, even when
    // the cursor crosses over the PDF canvas in either pane.
    try { gutter.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      let frac = (ev.clientX - rect.left) / rect.width;
      frac = Math.min(MAX_FRAC, Math.max(MIN_FRAC, frac));
      leftPane.style.flexBasis = `${(frac * 100).toFixed(2)}%`;
      leftPane.style.flexGrow = "0";
      leftPane.style.flexShrink = "0";
    };
    const onUp = (ev: PointerEvent) => {
      try { gutter.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      gutter.removeEventListener("pointermove", onMove);
      gutter.removeEventListener("pointerup", onUp);
      gutter.removeEventListener("pointercancel", onUp);
    };

    gutter.addEventListener("pointermove", onMove);
    gutter.addEventListener("pointerup", onUp);
    gutter.addEventListener("pointercancel", onUp);
  };

  gutter.addEventListener("pointerdown", onDown);
  resizeState = { gutter, onDown };
}

export function teardownResize(): void {
  if (resizeState) {
    resizeState.gutter.removeEventListener("pointerdown", resizeState.onDown);
    resizeState = null;
  }
}

// --- Sync scroll ------------------------------------------------------------

interface SyncState {
  left: HTMLElement;
  right: HTMLElement;
  onLeft: () => void;
  onRight: () => void;
}

let syncState: SyncState | null = null;

export function setSyncScroll(
  left: HTMLElement,
  right: HTMLElement,
  enabled: boolean
): void {
  // Always tear down the previous wiring first so toggling can't stack listeners.
  if (syncState) {
    syncState.left.removeEventListener("scroll", syncState.onLeft);
    syncState.right.removeEventListener("scroll", syncState.onRight);
    syncState = null;
  }
  if (!enabled || !left || !right) return;

  // Re-entrancy guard: mirroring sets scrollTop on the other pane, which fires
  // *its* scroll event — without the lock the two panes would ping-pong.
  let locked = false;
  const mirror = (src: HTMLElement, dst: HTMLElement) => {
    if (locked) return;
    locked = true;
    // Proportional, not absolute: the two documents can have very different
    // lengths, so we mirror the scroll *fraction* (0..1), not the pixel offset.
    const srcMax = src.scrollHeight - src.clientHeight;
    const dstMax = dst.scrollHeight - dst.clientHeight;
    const frac = srcMax > 0 ? src.scrollTop / srcMax : 0;
    dst.scrollTop = frac * dstMax;
    // Release after the mirrored scroll event has had a chance to fire & be
    // swallowed by the guard.
    requestAnimationFrame(() => { locked = false; });
  };

  const onLeft = () => mirror(left, right);
  const onRight = () => mirror(right, left);
  left.addEventListener("scroll", onLeft, { passive: true });
  right.addEventListener("scroll", onRight, { passive: true });
  syncState = { left, right, onLeft, onRight };
}
