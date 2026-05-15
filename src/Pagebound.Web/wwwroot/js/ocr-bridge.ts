// =============================================================================
// Pagebound — OCR-Bridge (Tesseract.js)
// ----------------------------------------------------------------------------
// Wird von Blazor WASM via IJSRuntime.InvokeAsync("pageboundOcr.<fn>", ...) genutzt.
// Tesseract.js läuft im eigenen Web-Worker (kein UI-Block), das Sprach-Bundle
// (~10 MB pro Sprache) wird einmal pro Session lazy geladen und wiederverwendet.
//
// Entsprechende C#-Klasse: Pagebound.Infrastructure.Ocr.TesseractOcrService.
// =============================================================================

import { createWorker, type Worker } from "tesseract.js";

let cachedWorker: Worker | null = null;
let cachedLangs: string | null = null;

async function ensureWorker(languages: string): Promise<Worker> {
  // Tesseract.js erlaubt mehrere Sprachen kombiniert (z.B. "eng+deu") — die
  // Engine matched dann beide. Wir terminieren und neu-erzeugen nur, wenn
  // sich die Sprach-Liste ändert.
  if (cachedWorker && cachedLangs === languages) return cachedWorker;
  if (cachedWorker) {
    try {
      await cachedWorker.terminate();
    } catch {
      // ignore — Worker war eh defekt
    }
    cachedWorker = null;
  }
  cachedWorker = await createWorker(languages);
  cachedLangs = languages;
  return cachedWorker;
}

export interface OcrWord {
  text: string;
  /** Bbox in image-pixel coordinates relativ zum gerenderten Page-Bild. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Tesseract confidence 0..100. */
  confidence: number;
}

export interface OcrPageResult {
  /** Voller OCR-Text der Seite (Zeilen-getrennt). */
  text: string;
  /** Page-Confidence 0..100 (gewichtet über alle Wörter). */
  confidence: number;
  /** Word-bounding-boxes für Text-Layer + Click-Selection. */
  words: OcrWord[];
  /** Bildgröße, auf die sich die Word-Koordinaten beziehen. */
  imageWidth: number;
  imageHeight: number;
}

/**
 * OCR einer einzelnen Seite. Das `imageSource` muss von <c>Image</c> akzeptiert
 * werden — entweder data:-URL, Blob, HTMLImageElement, ImageData …; aus C#
 * schicken wir den base64-Data-URL des renderten PDF-Page-PNGs.
 */
export async function recognizePage(
  imageSource: string,
  languages: string
): Promise<OcrPageResult> {
  const worker = await ensureWorker(languages || "eng");
  const result = await worker.recognize(imageSource, {}, { blocks: true });
  const data: any = result.data;

  const words: OcrWord[] = [];
  let imageWidth = 0;
  let imageHeight = 0;

  // Tesseract.js liefert die Word-Liste in einer verschachtelten Struktur:
  // blocks > paragraphs > lines > words. Wir flatten alles und nehmen nur
  // Wörter mit irgendwie sinnvollem Text — leere Strings und niedrige
  // Confidence schmeißen wir raus, damit Highlight-Overlays sauber bleiben.
  const blocks = data.blocks ?? [];
  for (const block of blocks) {
    const paragraphs = block.paragraphs ?? [];
    for (const paragraph of paragraphs) {
      const lines = paragraph.lines ?? [];
      for (const line of lines) {
        const ws = line.words ?? [];
        for (const w of ws) {
          const text = (w.text ?? "").trim();
          if (!text) continue;
          const confidence = w.confidence ?? 0;
          // Niedrige Confidence rauswerfen — bei stylisierten Layouts
          // (Headlines mit Outlines, dünnen Glyphen) erkennt Tesseract sonst
          // Phantom-Wörter ("L L L L" oben auf "Lenk", "AHRUNG" überlappend
          // mit "BERUFSERFAHRUNG"), die als verwirrende Selection-Overlays
          // im Reader landen.
          if (confidence < 60) continue;
          const bbox = w.bbox ?? {};
          words.push({
            text,
            x: bbox.x0 ?? 0,
            y: bbox.y0 ?? 0,
            width: (bbox.x1 ?? 0) - (bbox.x0 ?? 0),
            height: (bbox.y1 ?? 0) - (bbox.y0 ?? 0),
            confidence
          });
          imageWidth = Math.max(imageWidth, bbox.x1 ?? 0);
          imageHeight = Math.max(imageHeight, bbox.y1 ?? 0);
        }
      }
    }
  }

  return {
    text: data.text ?? "",
    confidence: data.confidence ?? 0,
    words,
    imageWidth,
    imageHeight
  };
}

/**
 * Aufräumen — Tesseract-Worker freigeben. Aktuell rufen wir das nicht
 * automatisch (User wechselt vielleicht zur nächsten Seite und braucht
 * den geladenen Sprach-Stack gleich wieder). Bei einem manuellen Reset
 * oder kompletten App-Close können wir es jederzeit aufräumen.
 */
export async function terminate(): Promise<void> {
  if (cachedWorker) {
    try {
      await cachedWorker.terminate();
    } catch {
      // ignore
    }
    cachedWorker = null;
    cachedLangs = null;
  }
}
