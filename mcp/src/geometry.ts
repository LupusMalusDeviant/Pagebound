// =============================================================================
// Pagebound MCP — Seitengeometrie: Anzeigeraum → PDF-Userspace
// -----------------------------------------------------------------------------
// PORT von src/Pagebound.Web/wwwroot/js/page-geometry.ts. Wie encrypt.ts,
// pdfa.ts und pdfua.ts ist dieses Paket eine eigenständige Kopie der Engine —
// es wird als npm-Paket veröffentlicht und kann nicht über die Paketgrenze
// hinweg importieren. Wer dort etwas ändert, ändert es hier mit.
//
// Der Punkt dieser Datei: PDF-Annotationen und Formularfelder liegen im
// UNGEDREHTEN Userspace einer Seite. Wer mit der MediaBox und „height - y"
// rechnet, trifft nur bei /Rotate 0 und einer CropBox ab (0,0). Auf gedrehten
// oder beschnittenen Seiten landet alles woanders.
// =============================================================================

import type { PDFPage } from "pdf-lib";

export interface DisplayGeometry {
  /** Angezeigte Breite in Punkten (nach Rotation). */
  width: number;
  /** Angezeigte Höhe in Punkten (nach Rotation). */
  height: number;
  /** Normalisierte Drehung: 0, 90, 180 oder 270 (im Uhrzeigersinn, wie /Rotate). */
  rotation: 0 | 90 | 180 | 270;
  /** cm-Matrix [a b c d e f]: Anzeigeraum (unten-links) → Userspace. */
  matrix: [number, number, number, number, number, number];
}

/** /Rotate wie PDF.js normalisieren: nur Vielfache von 90 zählen, sonst 0. */
export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(angle) || angle % 90 !== 0) return 0;
  const r = ((angle % 360) + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

export function computeDisplayGeometry(
  box: { x: number; y: number; width: number; height: number },
  rotateAngle: number
): DisplayGeometry {
  const rotation = normalizeRotation(rotateAngle);
  const { x: x0, y: y0, width: w, height: h } = box;
  switch (rotation) {
    case 90:
      return { width: h, height: w, rotation, matrix: [0, 1, -1, 0, x0 + w, y0] };
    case 180:
      return { width: w, height: h, rotation, matrix: [-1, 0, 0, -1, x0 + w, y0 + h] };
    case 270:
      return { width: h, height: w, rotation, matrix: [0, -1, 1, 0, x0, y0 + h] };
    default:
      return { width: w, height: h, rotation, matrix: [1, 0, 0, 1, x0, y0] };
  }
}

/** Sichtbares Rechteck einer Seite wie PDF.js (`page.view`): CropBox ∩ MediaBox. */
export function visibleBox(page: PDFPage): { x: number; y: number; width: number; height: number } {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  // Entartete Schnittmenge (kaputte CropBox): PDF.js fällt auf die MediaBox zurück.
  if (right - left <= 0 || top - bottom <= 0) return media;
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

export function displayGeometry(page: PDFPage): DisplayGeometry {
  return computeDisplayGeometry(visibleBox(page), page.getRotation().angle);
}

/** Angezeigte Maße einer Seite in Punkten. */
export function displaySize(page: PDFPage): { width: number; height: number } {
  const g = displayGeometry(page);
  return { width: g.width, height: g.height };
}

/** Normierter Anzeigepunkt (0..1, Ursprung oben links) → Userspace. */
function pointToUser(g: DisplayGeometry, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = g.matrix;
  const u = x * g.width;
  const v = g.height - y * g.height;
  return { x: a * u + c * v + e, y: b * u + d * v + f };
}

/**
 * Rückweg. Die Matrix ist stets Drehung plus Verschiebung (|det| = 1), also
 * exakt invertierbar — keine Näherung.
 */
function userToNorm(g: DisplayGeometry, X: number, Y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = g.matrix;
  const det = a * d - b * c;
  const dx = X - e, dy = Y - f;
  const u = (d * dx - c * dy) / det;
  const v = (-b * dx + a * dy) / det;
  return { x: u / g.width, y: (g.height - v) / g.height };
}

export function normPointsToUser(
  page: PDFPage,
  points: readonly { x: number; y: number }[]
): { x: number; y: number }[] {
  const g = displayGeometry(page);
  return points.map((p) => pointToUser(g, p.x, p.y));
}

export function userPointsToNorm(
  page: PDFPage,
  points: readonly { x: number; y: number }[]
): { x: number; y: number }[] {
  const g = displayGeometry(page);
  return points.map((p) => userToNorm(g, p.x, p.y));
}

export function normRectToUser(
  page: PDFPage,
  r: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number; rotation: 0 | 90 | 180 | 270 } {
  const g = displayGeometry(page);
  const pts = [
    pointToUser(g, r.x, r.y),
    pointToUser(g, r.x + r.width, r.y),
    pointToUser(g, r.x, r.y + r.height),
    pointToUser(g, r.x + r.width, r.y + r.height),
  ];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation: g.rotation };
}

export function userRectToNorm(
  page: PDFPage,
  r: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const g = displayGeometry(page);
  const pts = [
    userToNorm(g, r.x, r.y),
    userToNorm(g, r.x + r.width, r.y),
    userToNorm(g, r.x, r.y + r.height),
    userToNorm(g, r.x + r.width, r.y + r.height),
  ];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Umschließendes Userspace-Rechteck einer Punktwolke. */
export function boundsOfUserPoints(
  points: readonly { x: number; y: number }[],
  pad = 0
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}
