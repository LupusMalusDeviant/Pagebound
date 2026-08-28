// =============================================================================
// OCR für gescannte PDFs — kopflos, ohne Browser, ohne native Abhängigkeit.
//
// WARUM DAS HIER NEU GEBAUT IST: die PWA hat OCR schon (wwwroot/js/ocr-bridge.ts),
// aber die Erkennung läuft dort in einem Web-Worker und der C#-Dienst ist nur
// ein IJSRuntime-Wrapper. Ohne Browser gibt es kein IJSRuntime — kopfloses OCR
// existierte bisher nicht.
//
// DIE DREI FALLEN DES MCP-SERVERS UND WIE SIE UMGANGEN SIND:
//
//   1. KEIN NETZ. tesseract.js lädt Sprachpakete sonst beim ersten Aufruf nach.
//      Hier liegen sie unter mcp/tessdata/ und werden über langPath lokal
//      geladen (dieselben Dateien wie in der PWA, damit beide Wege gleich
//      erkennen). Der WASM-Kern kommt aus dem npm-Paket tesseract.js-core.
//
//   2. KEINE NATIVEN DEPS. Eine gescannte Seite MUSS nicht gerastert werden —
//      sie besteht fast immer aus genau einem Bild-XObject. pdfjs dekodiert das
//      Bild im Worker (reines JS: Flate, DCT, CCITT, JBIG2, JPX) und liefert
//      fertige Pixel; Canvas braucht pdfjs erst beim MALEN. Die Pixel werden
//      hier zu einem Graustufen-PNG verpackt (fflate ist ohnehin Abhängigkeit)
//      und so an tesseract gegeben. Kein Canvas, kein node-gyp.
//
//   3. STDOUT. tesseract.js meldet Fortschritt über einen Logger, der per
//      Default nach stdout schreibt — eine Zeile davon zerlegt das JSON-RPC auf
//      stdio. logger und errorHandler sind deshalb stummgeschaltet; ein Test
//      misst, dass während einer Erkennung null Bytes nach stdout gehen.
//
// EHRLICHE GRENZEN: erkannt wird das größte Bild je Seite. Seiten ohne Bild
// liefern leeren Text (OCR erfindet nichts). Seiten, die aus mehreren
// Bildstreifen bestehen, werden nur teilweise erfasst — das meldet eine Warnung.
// =============================================================================
import { zlibSync } from "fflate";
import { createWorker, type Worker } from "tesseract.js";
import { ToolError, parsePageSpec } from "./pdf.js";

/** Tesseract-Engine-Modus: nur LSTM (schnell, ohne Legacy-Engine). */
const OEM_LSTM_ONLY = 1;

/** Wörter unterhalb dieser Konfidenz gelten als Rauschen (wie in ocr-bridge.ts). */
const WORD_CONFIDENCE_FLOOR = 60;

export interface OcrWord {
  text: string;
  /** Bounding-Box in Bildpixeln, relativ zum extrahierten Seitenbild. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..100 */
  confidence: number;
}

export interface OcrPage {
  page: number;
  text: string;
  /** 0..100. Bei einer Seite ohne Bild 0 — dann ist auch der Text leer. */
  confidence: number;
  imageWidth: number;
  imageHeight: number;
  words?: OcrWord[];
}

export interface OcrResult {
  pages: OcrPage[];
  /** Über die Seiten gemittelte Konfidenz (Seiten ohne Bild zählen nicht mit). */
  meanConfidence: number;
  warnings: string[];
}

export interface OcrOptions {
  /** Seitenauswahl wie überall, z. B. "1-3,5". Ohne Angabe: alle Seiten. */
  pages?: string;
  /** Tesseract-Sprachen, z. B. "deu", "eng", "deu+eng". */
  languages?: string;
  /** Wort-Koordinaten mitliefern (für Feldzuordnung nach Position). */
  words?: boolean;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- Graustufen → PNG ---------------------------------------------------------
// tesseract nimmt Bildformate, keine rohen Pixel-Arrays. PNG von Hand zu bauen
// ist wenige Zeilen und spart eine Bildbibliothek.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array[] {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const typed = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
  typed.set(data, 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(typed));
  return [len, typed, crc];
}

/** Graustufenbild (8 bit) als PNG. */
export function grayscaleToPng(gray: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // Filter: none
    raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // 8 bit
  ihdr[9] = 0; // Graustufen
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ...pngChunk("IHDR", ihdr),
    ...pngChunk("IDAT", zlibSync(raw)),
    ...pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// --- Bild einer Seite holen ---------------------------------------------------
interface DecodedImage { width: number; height: number; gray: Uint8Array; extraImages: number }

/** pdfjs-Bildarten (ImageKind). */
const KIND_GRAYSCALE_1BPP = 1;
const KIND_RGB_24BPP = 2;
const KIND_RGBA_32BPP = 3;

const luminance = (r: number, g: number, b: number): number => (r * 299 + g * 587 + b * 114) / 1000;

/** Wandelt das, was pdfjs liefert, in ein 8-bit-Graustufenbild. */
function toGrayscale(kind: number, data: Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  if (kind === KIND_RGB_24BPP) {
    for (let i = 0, j = 0; i < gray.length; i++, j += 3) gray[i] = luminance(data[j], data[j + 1], data[j + 2]);
  } else if (kind === KIND_RGBA_32BPP) {
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = luminance(data[j], data[j + 1], data[j + 2]);
  } else if (kind === KIND_GRAYSCALE_1BPP) {
    // Gepackt: ein Bit je Pixel, jede Zeile auf volle Bytes aufgefüllt.
    // pdfjs setzt Bit=0 für Schwarz (so wird es auch auf Canvas gemalt).
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        gray[y * width + x] = bit ? 255 : 0;
      }
    }
  } else {
    // Unbekannte Art: als Graustufen durchreichen, wenn die Größe passt.
    gray.set(data.subarray(0, Math.min(data.length, gray.length)));
  }
  return gray;
}

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfjsPage = Awaited<ReturnType<Awaited<ReturnType<PdfjsModule["getDocument"]>["promise"]>["getPage"]>>;

/**
 * Holt das größte Bild einer Seite — dekodiert, aber ohne Canvas. Eine
 * gescannte Seite ist fast immer genau ein Bild; gibt es mehrere, gewinnt das
 * flächengrößte und die Zahl der übrigen wird gemeldet.
 */
async function largestImageOfPage(pdfjs: PdfjsModule, page: PdfjsPage): Promise<DecodedImage | null> {
  const ops = await page.getOperatorList();
  const names: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) {
      const arg = ops.argsArray[i][0];
      if (typeof arg === "string") names.push(arg);
    }
  }
  if (names.length === 0) return null;

  let best: DecodedImage | null = null;
  for (const name of names) {
    const store = name.startsWith("g_") ? page.commonObjs : page.objs;
    // objs.get löst asynchron auf; ohne Zeitgrenze könnte ein defektes
    // Dokument den Aufruf hängen lassen.
    const obj = await Promise.race([
      new Promise<unknown>((resolve) => store.get(name, resolve)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
    ]) as { width?: number; height?: number; kind?: number; data?: Uint8Array } | null;
    if (!obj?.data || !obj.width || !obj.height) continue;
    if (best && best.width * best.height >= obj.width * obj.height) continue;
    best = {
      width: obj.width,
      height: obj.height,
      gray: toGrayscale(obj.kind ?? KIND_RGB_24BPP, obj.data, obj.width, obj.height),
      extraImages: 0,
    };
  }
  if (best) best.extraImages = names.length - 1;
  return best;
}

/** Pfad zu den mitgelieferten Sprachdaten (mcp/tessdata/, wie mcp/fonts/). */
function langPath(): string {
  const url = new URL("../tessdata/", import.meta.url);
  // tesseract.js erwartet einen Pfad, keine file://-URL.
  return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
}

/**
 * Erkennt Text auf den gescannten Seiten einer PDF.
 *
 * Kein automatischer Rückfall aus pdf_extract_text: OCR ist um Größenordnungen
 * teurer, die Entscheidung gehört dem Aufrufer.
 */
export async function ocrPdf(bytes: Uint8Array, opts: OcrOptions = {}): Promise<OcrResult> {
  const languages = (opts.languages ?? "deu+eng").trim() || "deu+eng";
  if (!/^[a-z]{3}(\+[a-z]{3})*$/.test(languages)) {
    throw new ToolError(
      `Ungültige Sprachangabe '${languages}'. Erwartet werden Tesseract-Codes, z. B. "deu", "eng" oder "deu+eng".`,
    );
  }
  for (const lang of languages.split("+")) {
    if (lang !== "deu" && lang !== "eng") {
      throw new ToolError(
        `Sprache '${lang}' ist nicht mitgeliefert. Verfügbar sind 'deu' und 'eng' (mcp/tessdata/); ` +
        "der Server lädt bewusst nichts nach.",
        "UNSUPPORTED",
      );
    }
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  } catch (e) {
    throw new ToolError(`Keine gültige PDF oder beschädigt (${errMsg(e)}).`, "PDF_CORRUPT");
  }

  const warnings: string[] = [];
  const pages: OcrPage[] = [];
  let worker: Worker | null = null;

  try {
    const total = doc.numPages;
    const wanted = opts.pages ? parsePageSpec(opts.pages, total) : Array.from({ length: total }, (_, i) => i + 1);

    for (const pageNumber of wanted) {
      const page = await doc.getPage(pageNumber);
      let image: DecodedImage | null = null;
      try {
        image = await largestImageOfPage(pdfjs, page);
      } catch (e) {
        warnings.push(`Seite ${pageNumber}: Bild konnte nicht gelesen werden (${errMsg(e)}).`);
      }

      if (!image) {
        warnings.push(
          `Seite ${pageNumber} enthält kein Bild — hier gibt es nichts zu erkennen. ` +
          "Bei einer PDF mit Textebene ist pdf_extract_text das richtige Werkzeug.",
        );
        pages.push({ page: pageNumber, text: "", confidence: 0, imageWidth: 0, imageHeight: 0, ...(opts.words ? { words: [] } : {}) });
        continue;
      }
      if (image.extraImages > 0) {
        warnings.push(
          `Seite ${pageNumber} enthält ${image.extraImages + 1} Bilder — erkannt wurde nur das größte. ` +
          "Bei in Streifen zerlegten Scans fehlt dadurch Text.",
        );
      }

      if (!worker) {
        worker = await createWorker(languages, OEM_LSTM_ONLY, {
          langPath: langPath(),
          gzip: true,
          // Ohne das entpackt tesseract die Sprachdaten und legt sie als
          // "<lang>.traineddata" im ARBEITSVERZEICHNIS ab (Default: "."). Der
          // gehostete Container läuft mit read_only-Rootfs — der Schreibversuch
          // liefe dort bei jedem Aufruf ins Leere. Entpackt wird stattdessen im
          // Speicher; die Dateien liegen ohnehin lokal, es gibt nichts zu cachen.
          cacheMethod: "none",
          // Stummschalten: eine Zeile auf stdout zerlegt das JSON-RPC (stdio).
          logger: () => {},
          errorHandler: () => {},
        });
      }

      const png = grayscaleToPng(image.gray, image.width, image.height);
      const { data } = await worker.recognize(Buffer.from(png), {}, { blocks: opts.words === true });

      const entry: OcrPage = {
        page: pageNumber,
        text: (data.text ?? "").trim(),
        confidence: Math.round((data.confidence ?? 0) * 10) / 10,
        imageWidth: image.width,
        imageHeight: image.height,
      };

      if (opts.words) {
        const words: OcrWord[] = [];
        for (const block of data.blocks ?? []) {
          for (const paragraph of block.paragraphs ?? []) {
            for (const line of paragraph.lines ?? []) {
              for (const w of line.words ?? []) {
                const confidence = w.confidence ?? 0;
                if (confidence < WORD_CONFIDENCE_FLOOR) continue;
                const text = (w.text ?? "").trim();
                if (!text) continue;
                const b = w.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
                words.push({
                  text,
                  x: b.x0 ?? 0,
                  y: b.y0 ?? 0,
                  width: (b.x1 ?? 0) - (b.x0 ?? 0),
                  height: (b.y1 ?? 0) - (b.y0 ?? 0),
                  confidence: Math.round(confidence * 10) / 10,
                });
              }
            }
          }
        }
        entry.words = words;
      }

      if (!entry.text) {
        warnings.push(
          `Seite ${pageNumber}: Bild vorhanden (${image.width}×${image.height}), aber kein Text erkannt — ` +
          "leeres Blatt, Handschrift oder zu geringe Auflösung.",
        );
      }
      pages.push(entry);
    }
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* Worker war ohnehin defekt */ }
    }
  }

  const scored = pages.filter((p) => p.imageWidth > 0);
  const meanConfidence = scored.length
    ? Math.round((scored.reduce((s, p) => s + p.confidence, 0) / scored.length) * 10) / 10
    : 0;

  const weak = scored.filter((p) => p.confidence > 0 && p.confidence < 70).map((p) => p.page);
  if (weak.length) {
    warnings.push(
      `Niedrige Konfidenz auf Seite(n) ${weak.join(", ")} (unter 70 %) — das Ergebnis dort ist nicht belastbar.`,
    );
  }

  return { pages, meanConfidence, warnings };
}
