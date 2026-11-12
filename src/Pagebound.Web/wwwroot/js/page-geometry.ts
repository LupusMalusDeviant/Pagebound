// =============================================================================
// Pagebound — Seitengeometrie: Anzeigeraum → PDF-Userspace
// ----------------------------------------------------------------------------
// Der Reader zeigt Seiten über den PDF.js-Viewport an: sichtbar ist die
// CropBox (geschnitten mit der MediaBox), gedreht um /Rotate. Alle Annotations-
// koordinaten (0..1, Origin oben-links) beziehen sich auf DIESEN Anzeigeraum.
//
// pdf-lib zeichnet dagegen im ungedrehten Userspace der Seite. Wer dort mit
// page.getSize() (MediaBox) und „ph - y" rechnet, trifft nur bei /Rotate 0 und
// einer CropBox ab (0,0) — auf gedrehten oder beschnittenen Seiten landet alles
// an der falschen Stelle und Bilder/Text stehen quer.
//
// withDisplaySpace() schaltet deshalb eine Transformationsmatrix (cm) vor, die
// den Anzeigeraum (Origin UNTEN-links, Breite/Höhe wie angezeigt) auf den
// Userspace abbildet. Innerhalb des Callbacks rechnet der Aufrufer so, als wäre
// die Seite ungedreht und ab (0,0) — Bilder und Text erscheinen automatisch
// aufrecht. Bewusst ohne DOM-/pdfjs-Abhängigkeit, damit es in Node testbar ist.
// =============================================================================

import {
  PDFPage,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from "pdf-lib";

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

/**
 * Reine Geometrie: aus sichtbarem Rechteck (CropBox ∩ MediaBox) und Drehung
 * die Anzeigemaße und die Abbildungsmatrix berechnen.
 */
export function computeDisplayGeometry(
  box: { x: number; y: number; width: number; height: number },
  rotateAngle: number
): DisplayGeometry {
  const rotation = normalizeRotation(rotateAngle);
  const { x: x0, y: y0, width: w, height: h } = box;
  switch (rotation) {
    case 90:
      // Angezeigt oben-links = Userspace (x0, y0). X = x0 + w - v, Y = y0 + u
      return { width: h, height: w, rotation, matrix: [0, 1, -1, 0, x0 + w, y0] };
    case 180:
      // X = x0 + w - u, Y = y0 + h - v
      return { width: w, height: h, rotation, matrix: [-1, 0, 0, -1, x0 + w, y0 + h] };
    case 270:
      // X = x0 + v, Y = y0 + h - u
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
  // Entartete Schnittmenge (kaputte CropBox): PDF.js fällt dann auf die MediaBox zurück.
  if (right - left <= 0 || top - bottom <= 0) return media;
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

export function displayGeometry(page: PDFPage): DisplayGeometry {
  return computeDisplayGeometry(visibleBox(page), page.getRotation().angle);
}

/**
 * Öffnet einen Grafikzustand mit Anzeigeraum-Matrix und liefert die angezeigten
 * Maße. MUSS mit endDisplaySpace() geschlossen werden. Für Schleifen, deren Körper
 * nicht in einen Callback umgebaut werden soll: wirft der Körper, bricht ohnehin
 * das ganze Speichern ab — ein offenes q landet also nie in einer Ausgabedatei.
 */
export function beginDisplaySpace(page: PDFPage): { width: number; height: number } {
  const g = displayGeometry(page);
  const [a, b, c, d, e, f] = g.matrix;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f));
  return { width: g.width, height: g.height };
}

export function endDisplaySpace(page: PDFPage): void {
  page.pushOperators(popGraphicsState());
}

/**
 * Zeichnet im Anzeigeraum: `draw(width, height)` bekommt die angezeigten Maße
 * (Origin unten-links) und benutzt die normalen pdf-lib-Zeichenbefehle. Die
 * Matrix wird in einem eigenen Grafikzustand (q … Q) gekapselt.
 */
export function withDisplaySpace<T>(page: PDFPage, draw: (width: number, height: number) => T): T {
  const g = displayGeometry(page);
  const [a, b, c, d, e, f] = g.matrix;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f));
  try {
    return draw(g.width, g.height);
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

/** Async-Variante (für Zweige, die z. B. Bilder einbetten). */
export async function withDisplaySpaceAsync<T>(
  page: PDFPage,
  draw: (width: number, height: number) => Promise<T>
): Promise<T> {
  const g = displayGeometry(page);
  const [a, b, c, d, e, f] = g.matrix;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f));
  try {
    return await draw(g.width, g.height);
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

/**
 * Ein im Anzeigeraum normierter Punkt (0..1, Origin OBEN-links) in einen
 * Userspace-Punkt. Die eine Quelle der Punkt-Umrechnung: normPointToUser und
 * normRectToUser gehen beide hierüber, damit Rechtecke und Einzelpunkte nicht
 * auseinanderlaufen können.
 *
 * Gebraucht für PDF-Objekte, die Punktlisten statt Rechtecke tragen —
 * /QuadPoints (Highlight), /InkList (Ink), /L (Line) — siehe
 * docs/contracts/annotationen-als-pdf-annots.md.
 */
function pointToUser(g: DisplayGeometry, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = g.matrix;
  const u = x * g.width;
  const v = g.height - y * g.height; // 0..1 oben-links → Anzeigeraum unten-links
  return { x: a * u + c * v + e, y: b * u + d * v + f };
}

/**
 * Punkt im Anzeigeraum (0..1, Origin oben-links) → Userspace-Punkt.
 * Für Annotationen, die Koordinaten direkt tragen (/QuadPoints, /InkList, /L).
 */
export function normPointToUser(
  page: PDFPage,
  p: { x: number; y: number }
): { x: number; y: number } {
  return pointToUser(displayGeometry(page), p.x, p.y);
}

/**
 * Mehrere Punkte in einem Rutsch — spart das wiederholte Aufbauen der
 * Geometrie bei Strichlisten, die leicht tausende Punkte haben.
 */
export function normPointsToUser(
  page: PDFPage,
  points: readonly { x: number; y: number }[]
): { x: number; y: number }[] {
  const g = displayGeometry(page);
  return points.map((p) => pointToUser(g, p.x, p.y));
}

/**
 * Für Objekte mit eigenem Rechteck im Userspace (Formular-Widgets): ein im
 * Anzeigeraum normiertes Rechteck (0..1, Origin oben-links) in ein
 * Userspace-Rechteck umrechnen. Liefert zusätzlich die Drehung, mit der das
 * Widget-Erscheinungsbild gedreht werden muss, um aufrecht zu erscheinen.
 */
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

/**
 * Rückweg: Userspace-Punkt → normierter Anzeigeraum (0..1, Origin oben-links).
 * Gebraucht beim Einlesen vorhandener /Annots, die im Userspace stehen.
 *
 * Die Matrix aus computeDisplayGeometry ist stets Drehung plus Verschiebung
 * (|det| = 1), also exakt invertierbar — keine Näherung.
 */
function userToNorm(g: DisplayGeometry, X: number, Y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = g.matrix;
  const det = a * d - b * c;
  const dx = X - e, dy = Y - f;
  const u = (d * dx - c * dy) / det;
  const v = (-b * dx + a * dy) / det;
  return { x: u / g.width, y: (g.height - v) / g.height };
}

export function userPointToNorm(
  page: PDFPage,
  p: { x: number; y: number }
): { x: number; y: number } {
  return userToNorm(displayGeometry(page), p.x, p.y);
}

export function userPointsToNorm(
  page: PDFPage,
  points: readonly { x: number; y: number }[]
): { x: number; y: number }[] {
  const g = displayGeometry(page);
  return points.map((p) => userToNorm(g, p.x, p.y));
}

/**
 * Userspace-Rechteck → normiertes Anzeige-Rechteck. Über die vier Ecken, weil
 * ein gedrehtes Rechteck sonst Breite und Höhe vertauscht.
 */
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

/** Angezeigte Maße einer Seite in Punkten — für Umrechnungen von Strichstärken. */
export function displaySize(page: PDFPage): { width: number; height: number } {
  const g = displayGeometry(page);
  return { width: g.width, height: g.height };
}

/** Umschließendes Userspace-Rechteck einer Punktwolke (für /Rect aus /InkList, /L). */
export function boundsOfUserPoints(
  points: readonly { x: number; y: number }[],
  pad = 0
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}

/**
 * Optionen für pdf-lib `field.addToPage(page, …)`: pdf-lib dreht das Widget-
 * Rechteck selbst (gegen den Uhrzeigersinn um den Anker x/y, Breite/Höhe im
 * Format des Erscheinungsbilds, siehe rotateRectangle in pdf-lib). Hier wird der
 * Anker so gewählt, dass das Ergebnis genau das angezeigte Rechteck trifft und
 * der Inhalt aufrecht erscheint (/MK /R = /Rotate hebt die Seitendrehung auf).
 */
export function widgetPlacement(
  page: PDFPage,
  r: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number; rotation: 0 | 90 | 180 | 270 } {
  const g = displayGeometry(page);
  const u = normRectToUser(page, r);
  const w = r.width * g.width, h = r.height * g.height; // Maße wie angezeigt
  switch (g.rotation) {
    case 90: return { x: u.x + u.width, y: u.y, width: w, height: h, rotation: 90 };
    case 180: return { x: u.x + u.width, y: u.y + u.height, width: w, height: h, rotation: 180 };
    case 270: return { x: u.x, y: u.y + u.height, width: w, height: h, rotation: 270 };
    default: return { x: u.x, y: u.y, width: w, height: h, rotation: 0 };
  }
}
