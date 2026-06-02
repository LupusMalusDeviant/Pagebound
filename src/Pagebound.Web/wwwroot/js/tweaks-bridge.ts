// =============================================================================
// Pagebound — Tweaks / Settings Bridge (M5 "Warm Ink")
// ----------------------------------------------------------------------------
// Single source of truth for the user-facing display tweaks, mapped onto the
// CSS variables the design system reads:
//   theme     → data-theme="dark|light"
//   accent    → --accent-h / --accent-c   (4 kuratierte Töne)
//   fontScale → --font-scale               (0.85–1.35)
//   density   → --d                        (kompakt .82 / normal 1 / luftig 1.2)
//   motion    → data-motion="on|off"
//
// Persisted in localStorage under `pagebound:tweaks`. The pre-boot inline
// script in index.html applies the saved values before first paint (no FOUC);
// this bridge handles runtime changes from the Blazor Settings panel.
// Exposed as the `pageboundTweaks` IIFE global (see esbuild.mjs).
// =============================================================================

export interface Tweaks {
  theme: string;     // "dark" | "light"
  accent: string;    // "teal" | "jade" | "aqua" | "coral"
  fontScale: number; // 0.85 .. 1.35
  density: string;   // "kompakt" | "normal" | "luftig"
  motion: boolean;
}

const ACCENTS: Record<string, { h: number; c: number }> = {
  teal:   { h: 192, c: 0.115 },
  jade:   { h: 158, c: 0.115 },
  aqua:   { h: 205, c: 0.085 },
  coral:  { h: 35,  c: 0.130 },
  violet: { h: 295, c: 0.105 },
  blue:   { h: 255, c: 0.105 },
  rose:   { h: 0,   c: 0.115 },
  amber:  { h: 70,  c: 0.120 },
};
const DENSITY: Record<string, number> = { kompakt: 0.82, normal: 1, luftig: 1.2 };

const KEY = "pagebound:tweaks";
const DEFAULTS: Tweaks = { theme: "dark", accent: "teal", fontScale: 1, density: "normal", motion: true };

function clampScale(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.35, Math.max(0.85, n));
}

export function apply(t: Tweaks): void {
  const r = document.documentElement;
  const a = ACCENTS[t.accent] ?? ACCENTS.teal;
  r.setAttribute("data-theme", t.theme === "light" ? "light" : "dark");
  r.setAttribute("data-motion", t.motion ? "on" : "off");
  r.style.setProperty("--accent-h", String(a.h));
  r.style.setProperty("--accent-c", String(a.c));
  r.style.setProperty("--font-scale", String(clampScale(t.fontScale)));
  r.style.setProperty("--d", String(DENSITY[t.density] ?? 1));
}

export function load(): Tweaks {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(t: Tweaks): Tweaks {
  const merged: Tweaks = { ...DEFAULTS, ...t };
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* storage blocked */ }
  apply(merged);
  return merged;
}

// Convenience for the Blazor panel: set one key, persist + apply, return the
// full new state (so the C# side stays in sync without a second round-trip).
export function set(key: string, value: unknown): Tweaks {
  const t = load() as unknown as Record<string, unknown>;
  t[key] = value;
  return save(t as unknown as Tweaks);
}

export function init(): void {
  apply(load());
}

// Auto-apply on bridge load too (belt-and-braces with the pre-boot inline script).
try { init(); } catch { /* DOM not ready / storage blocked */ }
