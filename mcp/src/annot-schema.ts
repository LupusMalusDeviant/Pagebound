// =============================================================================
// Pagebound MCP — der Eingabetyp von pdf_annotations_write
// -----------------------------------------------------------------------------
// Eigene Datei, weil index.ts beim Import sofort den Server startet: der
// Selbsttest soll GEGEN DAS REGISTRIERTE Schema prüfen können, nicht gegen eine
// Nachbildung. Der Befund, um den es geht (Codex-Review 2026-11-12, Nr. 11),
// lag genau im Schema und nicht im Motor — eine Nachbildung hätte ihn
// strukturell nicht finden können.
// =============================================================================

import { z } from "zod";

const annotPoint = z.object({ x: z.number(), y: z.number() });

/**
 * `.nullish()` statt `.optional()` bei allem, was pdf_annotations_read als
 * `null` zurückgibt: sonst lässt sich ein gelesenes Ergebnis nicht wieder in
 * pdf_annotations_write stecken — eine Notiz mit `"color": null` würde am
 * Schema scheitern, obwohl genau dieser Weg der angekündigte ist.
 */
export const annotItem = z.object({
  kind: z.enum(["highlight", "ink", "shape", "note", "text"])
    .describe("Art der Anmerkung. 'signature' gibt es hier NICHT — siehe pdf_sign."),
  pageNumber: z.number().int().min(1).describe("1-basierte Seitenzahl."),
  color: z.string().nullish().describe('Farbe als "#rrggbb". null/weggelassen = Vorgabe.'),
  opacity: z.number().min(0).max(1).nullish().describe("Deckkraft (nur highlight)."),
  strokeWidth: z.number().nullish().describe("Strichbreite als Anteil der angezeigten Seitenbreite."),
  rects: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })).nullish()
    .describe("Rechtecke (highlight), 0..1, Ursprung oben links."),
  strokes: z.array(z.array(annotPoint)).nullish().describe("Striche (ink), je Strich eine Punktfolge."),
  shape: z.enum(["rectangle", "line", "arrow"]).nullish(),
  startX: z.number().nullish(), startY: z.number().nullish(),
  endX: z.number().nullish(), endY: z.number().nullish(),
  text: z.string().nullish().describe("Inhalt (note, text) bzw. hervorgehobener Text (highlight)."),
  fontSize: z.number().nullish().describe("Schriftgröße als Anteil der angezeigten Seitenhöhe (text)."),
  x: z.number().nullish(), y: z.number().nullish(),
  id: z.string().nullish().describe("Stabile Id → /NM. null/weggelassen heißt: kein /NM."),
  modified: z.string().nullish().describe("ISO-8601-Zeitpunkt → /M. KEINE Systemuhr: ohne Angabe fehlt /M."),
});
