// =============================================================================
// Pagebound MCP — Anmerkungen als echte PDF-Annotationen (/Annots)
// ----------------------------------------------------------------------------
// PORT von src/Pagebound.Web/wwwroot/js/pdf-annots.ts. Dieses Paket wird als
// npm-Paket veröffentlicht und kann nicht über die Paketgrenze importieren;
// encrypt.ts, pdfa.ts und pdfua.ts sind aus demselben Grund Kopien. Wer dort
// etwas ändert, ändert es hier mit — der Abgleich ist eine Kopie der Datei,
// danach nur Kopfzeile, Importpfad und die beiden `| null`-Zeilen unten.
//
// Vertrag: docs/contracts/annotationen-als-pdf-annots.md (abgenommen 2026-11-12)
//
// Der Unterschied zum Einbrennen (flattenAnnotations im Manipulator-Bündel):
// dort wird in den SEITENINHALT gezeichnet und ist danach nicht mehr greifbar;
// hier entstehen Annotationsobjekte, die jeder Betrachter anwählen, ändern und
// löschen kann.
//
// Zwei Festlegungen aus dem Vertrag, die hier sichtbar werden:
//   * KEIN selbst gebautes /AP. Gesetzt werden nur die semantischen Einträge
//     (/QuadPoints, /InkList, /L, /DA …); das Erscheinungsbild erzeugt der
//     Betrachter. Ein eigener Kodierer wäre genau der Fehler, den niemand
//     ausser uns bemerkt.
//   * Reproduzierbarkeit (MCP-Zusage seit 2.0.0): weder /M noch /NM dürfen aus
//     der Uhr oder einem Zufallsgenerator kommen. /NM stammt aus der
//     Annotations-Id, /M aus ihrem UpdatedAt — beide reist der Aufrufer an.
//
// Geometrie: Annotationen liegen im UNGEDREHTEN Userspace, nicht im
// Anzeigeraum. Alle Umrechnungen laufen über page-geometry.ts; hier wird keine
// Matrix von Hand gebaut.
// =============================================================================

import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  PDFPage,
  PDFRef,
  StandardFonts,
} from "pdf-lib";
import {
  normPointsToUser,
  normRectToUser,
  userPointsToNorm,
  userRectToNorm,
  boundsOfUserPoints,
  displaySize,
} from "./geometry.js";

/**
 * pdf-lib schreibt beim Laden von sich aus ein frisches `/ModDate` aus der
 * Systemuhr. Das bricht die Zusage „gleiche Eingabe → byte-gleiche Ausgabe"
 * (MCP seit 2.0.0) — zwei identische Läufe mit mehr als einer Sekunde Abstand
 * ergeben verschiedene Dateien. Jeder Ladevorgang hier schaltet das ab.
 */
const NO_METADATA_BUMP = { updateMetadata: false } as const;

// -----------------------------------------------------------------------------
// Der gemeinsame Item-Typ
// -----------------------------------------------------------------------------
// Bewusst DERSELBE Typ wie beim Einbrennen (dort als FlattenItem re-exportiert).
// Zwei parallele Projektionen aus den Domänentypen wären zwei Stellen, an denen
// die Koordinaten auseinanderlaufen können.
//
// `id` und `modified` sind Nachtrag 1 zum Vertrag: ohne sie lassen sich /NM und
// /M nicht reproduzierbar bilden. Das Einbrennen ignoriert beide Felder.
// -----------------------------------------------------------------------------

export interface AnnotItem {
  kind: "highlight" | "ink" | "shape" | "note" | "signature" | "text";
  pageNumber: number;
  color?: string | null;
  opacity?: number | null;
  /** Strichbreite als Anteil der Seitenbreite (wie im Reader). */
  strokeWidth?: number | null;
  rects?: { x: number; y: number; w: number; h: number }[] | null;
  strokes?: { x: number; y: number }[][] | null;
  shape?: "rectangle" | "line" | "arrow" | null;
  // null erlaubt: ein über MCP gelesenes Ergebnis darf unverändert wieder in
  // den Schreiber. `?? 0` unten fängt beides ab.
  startX?: number | null; startY?: number | null; endX?: number | null; endY?: number | null;
  text?: string | null;
  /** Schriftgröße als Anteil der Seitenhöhe (Freitext, wie im Reader via cqh). */
  fontSize?: number | null;
  x?: number | null; y?: number | null;
  imageBase64?: string | null;
  width?: number; height?: number;
  /** Stabile Id der Annotation → /NM. Nur für den /Annots-Weg. */
  id?: string | null;
  /** ISO-8601-Zeitpunkt der letzten Änderung → /M. Nur für den /Annots-Weg. */
  modified?: string | null;
}

export interface WriteAnnotationsResult {
  bytes: Uint8Array;
  written: number;
  skipped: number;
  /** Wie viele vorgefundene Annotationen mit gleichem /NM dabei ersetzt wurden. */
  replaced: number;
}

export interface ReadAnnotationsResult {
  items: AnnotItem[];
  unsupported: number;
}

/** Kantenlänge des Notiz-Markers in Punkten — wie bei Acrobat üblich. */
const NOTE_ICON_SIZE = 20;

/** Zeilenabstand als Vielfaches der Schriftgröße (wie im Reader). */
const LINE_HEIGHT = 1.25;

// -----------------------------------------------------------------------------
// Helvetica ausmessen statt schätzen
// -----------------------------------------------------------------------------
// Die Maße kommen aus pdf-lib selbst, über ein WEGWERF-Dokument: eingebettet
// würde die Schrift sonst als unreferenziertes Objekt in jeder Ausgabedatei
// landen. Einmal geladen, dann gemerkt.
// -----------------------------------------------------------------------------

let helveticaPromise: Promise<{ widthOfTextAtSize(t: string, s: number): number }> | null = null;
let helvetica: { widthOfTextAtSize(t: string, s: number): number } | null = null;

async function loadHelvetica() {
  if (helvetica) return helvetica;
  helveticaPromise ??= PDFDocument.create(NO_METADATA_BUMP)
    .then((scratch) => scratch.embedFont(StandardFonts.Helvetica));
  helvetica = await helveticaPromise;
  return helvetica;
}

function helveticaWidth(text: string, size: number): number {
  if (!helvetica) return text.length * size * 0.5; // sollte nie eintreten
  try {
    return helvetica.widthOfTextAtSize(text, size);
  } catch {
    // WinAnsi kennt nicht jedes Zeichen; dann lieber grosszügig schätzen als
    // werfen — ein zu breites Rechteck schneidet wenigstens nichts ab.
    return text.length * size * 0.6;
  }
}

/**
 * Text auf eine Breite umbrechen, wie es ein Betrachter täte. Ohne das meldet
 * das Rechteck eine Höhe für eine Zeile, während der Betrachter drei braucht.
 */
function wrapToWidth(text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of (text ?? "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (line && helveticaWidth(trial, size) > maxWidth) { out.push(line); line = w; }
      else line = trial;
    }
    if (line) out.push(line);
  }
  return out.length > 0 ? out : [""];
}

/**
 * Markdown auf Klartext herunterbrechen. Wird an zwei Stellen gebraucht —
 * beim Einbrennen (pdf-lib malt Text, kein Markdown) und beim Weg /Annots
 * (/Contents ist Klartext, Vertrag Festlegung 1) — und steht deshalb hier,
 * nicht in einem der beiden Aufrufer.
 */
export function stripMarkdown(md: string): string {
  return (md ?? "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(\*|_){1,3}([^*_]+)(\*|_){1,3}/g, "$2")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

// -----------------------------------------------------------------------------
// Kleine Helfer
// -----------------------------------------------------------------------------

/** "#rrggbb" oder "#rgb" → [r,g,b] in 0..1; null bei unbrauchbarer Eingabe. */
export function hexToComponents(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function componentsToHex(c: readonly number[]): string {
  const b = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");
  return `#${b(c[0] ?? 0)}${b(c[1] ?? 0)}${b(c[2] ?? 0)}`;
}

/**
 * PDF-Datumsformat (D:YYYYMMDDHHmmSSZ) aus einem ISO-Zeitpunkt.
 * Ohne brauchbare Eingabe: `null` — NICHT die aktuelle Uhrzeit, sonst wäre die
 * Ausgabe nicht mehr reproduzierbar.
 */
export function toPdfDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * D:YYYYMMDDHHmmSS mit Zeitzone → ISO-8601, oder null.
 *
 * Die Zone gehört dazu: `D:20261112100000+02'00'` ist 08:00 UTC, nicht 10:00.
 * Wer den Zusatz überliest, verschiebt beim Hin und Her das Änderungsdatum.
 * Form laut PDF 32000-1: `D:YYYYMMDDHHmmSSOHH'mm'` mit O aus `+`, `-` oder `Z`.
 */
export function fromPdfDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*([+-Z])?(\d{2})?'?(\d{2})?'?/
    .exec(raw.trim());
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", sign, offH = "00", offM = "00"] = m;

  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (!Number.isFinite(t)) return null;
  if (sign === "+" || sign === "-") {
    // Der Zusatz sagt, wie weit die ÖRTLICHE Zeit der UTC voraus ist —
    // zum Zurückrechnen also abziehen statt addieren.
    const offset = (+offH * 60 + +offM) * 60_000;
    t += sign === "+" ? -offset : offset;
  }
  return new Date(t).toISOString();
}

function numbers(doc: PDFDocument, values: readonly number[]): PDFArray {
  const arr = PDFArray.withContext(doc.context);
  for (const v of values) arr.push(PDFNumber.of(Number(v.toFixed(4))));
  return arr;
}

function dictOf(doc: PDFDocument, entries: Record<string, any>): PDFDict {
  const dict = PDFDict.withContext(doc.context);
  for (const [k, v] of Object.entries(entries)) {
    if (v === null || v === undefined) continue;
    dict.set(PDFName.of(k), v);
  }
  return dict;
}

/**
 * Beliebigen Text als PDF-Zeichenkette.
 *
 * Immer HEX (UTF-16BE mit BOM), nie literal. Ein literaler String muss
 * Klammern und Rückstriche maskieren; `PDFString.of` tut das NICHT. Eine
 * Notiz mit dem Text „unfinished (" erzeugte so eine Datei, in der die
 * Zeichenkette nie endet — der Betrachter meldet „End of file inside
 * dictionary" und liest KEINE Annotation mehr, während der Aufrufer „1
 * geschrieben" gemeldet bekam. Ausserdem kennt ein literaler String kein
 * Unicode: „中" wurde zu „-", ein Rückstrich verschwand.
 */
function pdfText(value: string): PDFHexString {
  return PDFHexString.fromText(value ?? "");
}

/**
 * Zeichenkette lesen — literal ODER hex. `decodeText()` beherrscht beide und
 * macht die Maskierung rückgängig; `asString()` liefert die rohe, noch
 * maskierte Form und wäre hier falsch.
 */
function strOrNull(dict: PDFDict, key: string): string | null {
  const v = dict.lookup(PDFName.of(key));
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return null;
}

function numsOrNull(dict: PDFDict, key: string): number[] | null {
  const v = dict.lookup(PDFName.of(key));
  if (!(v instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < v.size(); i++) {
    const n = v.lookup(i);
    if (!(n instanceof PDFNumber)) return null;
    out.push(n.asNumber());
  }
  return out;
}

/**
 * Entfernt alle vorhandenen Annotationen mit diesem /NM aus dem ganzen
 * Dokument und liefert ihre Zahl. Über alle Seiten, weil eine Annotation beim
 * erneuten Schreiben auf einer anderen Seite landen kann als beim Import.
 * Annotationen ohne oder mit anderem /NM bleiben unangetastet.
 */
function removeByName(doc: PDFDocument, name: string): number {
  let removed = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    // Rückwärts, damit das Entfernen die noch zu prüfenden Indizes nicht verschiebt.
    for (let i = annots.size() - 1; i >= 0; i--) {
      const dict = annots.lookup(i);
      if (!(dict instanceof PDFDict)) continue;
      if (strOrNull(dict, "NM") !== name) continue;
      annots.remove(i);
      removed++;
    }
  }
  return removed;
}

/** /Annots der Seite, bei Bedarf neu angelegt. */
function annotsArray(doc: PDFDocument, page: PDFPage): PDFArray {
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) return existing;
  const arr = PDFArray.withContext(doc.context);
  page.node.set(PDFName.of("Annots"), arr);
  return arr;
}

// -----------------------------------------------------------------------------
// Schreiben
// -----------------------------------------------------------------------------

/**
 * Baut die gemeinsamen Einträge jeder Markup-Annotation.
 * /F 4 = Print: ohne dieses Bit druckt ein Betrachter die Annotation nicht mit.
 */
function baseAnnot(
  doc: PDFDocument,
  subtype: string,
  rect: { x: number; y: number; width: number; height: number },
  it: AnnotItem,
  extra: Record<string, any>
): PDFDict {
  const comps = hexToComponents(it.color);
  const date = toPdfDate(it.modified);
  return dictOf(doc, {
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of(subtype),
    Rect: numbers(doc, [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]),
    F: PDFNumber.of(4),
    C: comps ? numbers(doc, comps) : undefined,
    NM: it.id ? pdfText(it.id) : undefined,
    M: date ? pdfText(date) : undefined,
    ...extra,
  });
}

/**
 * Schreibt Sidecar-Annotationen als echte /Annots.
 * Signaturen werden übersprungen (Vertrag: als /Stamp wären sie ein Bild ohne
 * Beweiskraft, das wie eine Signatur aussieht — schlechter als heute).
 */
export async function writeAnnotations(
  pdfBytes: Uint8Array,
  items: AnnotItem[]
): Promise<WriteAnnotationsResult> {
  if (!items || items.length === 0) {
    return { bytes: pdfBytes, written: 0, skipped: 0, replaced: 0 };
  }

  const doc = await PDFDocument.load(pdfBytes, { ...NO_METADATA_BUMP, ignoreEncryption: true });
  await loadHelvetica();
  const pages = doc.getPages();
  let written = 0;
  let skipped = 0;
  let replaced = 0;

  for (const it of items) {
    const page = pages[it.pageNumber - 1];
    if (!page) { skipped++; continue; }

    // Signaturen gehen diesen Weg laut Vertrag nicht mit.
    if (it.kind === "signature") { skipped++; continue; }

    // Vertrag: „importierte Annotationen ersetzen die vorgefundenen (gleiche
    // /NM), nicht importierte bleiben unangetastet." Ohne diesen Schritt
    // entstünde bei importieren → ändern → speichern eine Dublette: das alte
    // Objekt bliebe stehen und das neue käme daneben.
    if (it.id) replaced += removeByName(doc, it.id);

    const { width: dw, height: dh } = displaySize(page);
    const thickness = Math.max(0.5, (it.strokeWidth ?? 0.004) * dw);
    const dict = buildAnnot(doc, page, it, dw, dh, thickness, page.ref);
    if (!dict) { skipped++; continue; }

    annotsArray(doc, page).push(doc.context.register(dict));
    written++;
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, written, skipped, replaced };
}

function buildAnnot(
  doc: PDFDocument,
  page: PDFPage,
  it: AnnotItem,
  dw: number,
  dh: number,
  thickness: number,
  pageRef: PDFRef | undefined
): PDFDict | null {
  const P = pageRef ? { P: pageRef } : {};
  const border = { BS: dictOf(doc, { W: PDFNumber.of(Number(thickness.toFixed(4))) }) };

  if (it.kind === "highlight" && it.rects && it.rects.length > 0) {
    // /QuadPoints in der Reihenfolge, die Acrobat erwartet:
    // oben-links, oben-rechts, unten-links, unten-rechts — je Rechteck.
    const quad: number[] = [];
    const all: { x: number; y: number }[] = [];
    for (const r of it.rects) {
      const [tl, tr, bl, br] = normPointsToUser(page, [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x, y: r.y + r.h },
        { x: r.x + r.w, y: r.y + r.h },
      ]);
      quad.push(tl.x, tl.y, tr.x, tr.y, bl.x, bl.y, br.x, br.y);
      all.push(tl, tr, bl, br);
    }
    const rect = boundsOfUserPoints(all);
    const opacity = it.opacity ?? null;
    return baseAnnot(doc, "Highlight", rect, it, {
      QuadPoints: numbers(doc, quad),
      Contents: it.text ? pdfText(it.text) : undefined,
      CA: opacity !== null ? PDFNumber.of(Number(opacity.toFixed(4))) : undefined,
      ...P,
    });
  }

  if (it.kind === "ink" && it.strokes && it.strokes.length > 0) {
    const inkList = PDFArray.withContext(doc.context);
    const all: { x: number; y: number }[] = [];
    for (const stroke of it.strokes) {
      if (stroke.length === 0) continue;
      const pts = normPointsToUser(page, stroke);
      const flat: number[] = [];
      for (const p of pts) { flat.push(p.x, p.y); all.push(p); }
      inkList.push(numbers(doc, flat));
    }
    if (all.length === 0) return null;
    // /Rect muss den Strich samt halber Strichbreite enthalten, sonst
    // schneiden Betrachter die Ränder ab.
    const rect = boundsOfUserPoints(all, thickness / 2 + 1);
    return baseAnnot(doc, "Ink", rect, it, { InkList: inkList, ...border, ...P });
  }

  if (it.kind === "shape") {
    const s = { x: it.startX ?? 0, y: it.startY ?? 0 };
    const e = { x: it.endX ?? 0, y: it.endY ?? 0 };
    if (it.shape === "rectangle") {
      const rect = normRectToUser(page, {
        x: Math.min(s.x, e.x), y: Math.min(s.y, e.y),
        width: Math.abs(e.x - s.x), height: Math.abs(e.y - s.y),
      });
      // Kein /IC → hohl, wie im Reader.
      return baseAnnot(doc, "Square", rect, it, { ...border, ...P });
    }
    const [us, ue] = normPointsToUser(page, [s, e]);
    const rect = boundsOfUserPoints([us, ue], thickness / 2 + 1);
    const ends = it.shape === "arrow"
      ? (() => {
          const arr = PDFArray.withContext(doc.context);
          arr.push(PDFName.of("None"));
          arr.push(PDFName.of("ClosedArrow"));
          return arr;
        })()
      : undefined;
    return baseAnnot(doc, "Line", rect, it, {
      L: numbers(doc, [us.x, us.y, ue.x, ue.y]),
      LE: ends,
      IC: it.shape === "arrow" && hexToComponents(it.color)
        ? numbers(doc, hexToComponents(it.color)!)
        : undefined,
      ...border,
      ...P,
    });
  }

  if (it.kind === "note") {
    // Den ganzen Marker durch die Abbildung schicken, nicht nur seinen Anker:
    // ein danach auf ungedrehten Achsen gebautes Quadrat landet auf einer um
    // 90° gedrehten Seite um seine Kantenlänge daneben.
    const rect = normRectToUser(page, {
      x: it.x ?? 0,
      y: it.y ?? 0,
      width: NOTE_ICON_SIZE / dw,
      height: NOTE_ICON_SIZE / dh,
    });
    return baseAnnot(doc, "Text", rect, it, {
      Name: PDFName.of("Comment"),
      // /Contents ist Klartext — Markdown rendert dort kein Betrachter
      // (Vertrag, Festlegung 1). Das Sidecar behält die Markdown-Fassung.
      Contents: pdfText(stripMarkdown(it.text ?? "")),
      ...P,
    });
  }

  if (it.kind === "text") {
    const size = Math.max(1, (it.fontSize ?? 0.02) * dh);
    const text = it.text ?? "";
    // Gemessen statt geschätzt: zehn „W" in Helvetica bei 16 pt brauchen
    // 151 pt, die alte Schätzung (0,5 em je Zeichen) gab 96 pt frei. Ein
    // Betrachter muss dann umbrechen oder abschneiden, was im Reader passte.
    const lines = wrapToWidth(text, size, dw - size);
    const widthPt = Math.min(dw, Math.max(size, ...lines.map((l) => helveticaWidth(l, size))) + size);
    const heightPt = Math.min(dh, Math.max(1, lines.length) * size * LINE_HEIGHT + size * 0.5);
    const placed = normRectToUser(page, {
      x: it.x ?? 0,
      y: it.y ?? 0,
      width: widthPt / dw,
      height: heightPt / dh,
    });
    const c = hexToComponents(it.color) ?? [0, 0, 0];
    // /DA ist der Bauplan, aus dem Betrachter das Erscheinungsbild erzeugen.
    const da = `/Helv ${size.toFixed(2)} Tf ${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg`;
    return baseAnnot(doc, "FreeText", placed, it, {
      Contents: pdfText(text),
      DA: pdfText(da),
      Q: PDFNumber.of(0),
      // Ohne /Rotate richtet sich der Text am ungedrehten Userspace aus und
      // steht auf einer gedrehten Seite quer im schmalen Rechteck. Denselben
      // Schlüssel schreibt auch der Annotationseditor von PDF.js.
      // Kein eigenes /AP (Vertrag, Festlegung 3) — mehr als diesen Hinweis
      // können wir einem Betrachter nicht geben.
      Rotate: placed.rotation !== 0 ? PDFNumber.of(placed.rotation) : undefined,
      ...P,
    });
  }

  return null;
}

// -----------------------------------------------------------------------------
// Lesen
// -----------------------------------------------------------------------------

/**
 * Liest vorhandene /Annots in das Sidecar-Format zurück.
 * Nicht abgebildete Subtypen zählen in `unsupported` — sie werden NICHT
 * stillschweigend verschluckt, damit die Oberfläche sagen kann, wie viel
 * liegen blieb.
 */
export async function readAnnotations(pdfBytes: Uint8Array): Promise<ReadAnnotationsResult> {
  const doc = await PDFDocument.load(pdfBytes, { ...NO_METADATA_BUMP, ignoreEncryption: true });
  const pages = doc.getPages();
  const items: AnnotItem[] = [];
  let unsupported = 0;

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    const { width: dw, height: dh } = displaySize(page);

    for (let ai = 0; ai < annots.size(); ai++) {
      const dict = annots.lookup(ai);
      if (!(dict instanceof PDFDict)) { unsupported++; continue; }
      const sub = dict.lookup(PDFName.of("Subtype"));
      const subtype = sub instanceof PDFName ? sub.asString().replace(/^\//, "") : "";
      const item = readOne(page, dict, subtype, pi + 1, dw, dh);
      if (item) items.push(item); else unsupported++;
    }
  }

  return { items, unsupported };
}

function readOne(
  page: PDFPage,
  dict: PDFDict,
  subtype: string,
  pageNumber: number,
  dw: number,
  dh: number
): AnnotItem | null {
  const colorArr = numsOrNull(dict, "C");
  const color = colorArr && colorArr.length >= 3 ? componentsToHex(colorArr) : null;
  const id = strOrNull(dict, "NM");
  const modified = fromPdfDate(strOrNull(dict, "M"));
  const contents = strOrNull(dict, "Contents");
  const common = { pageNumber, color, id, modified };

  // Strichbreite zurück in den Anteil der angezeigten Breite.
  const bs = dict.lookup(PDFName.of("BS"));
  const wNum = bs instanceof PDFDict ? bs.lookup(PDFName.of("W")) : null;
  const strokeWidth = wNum instanceof PDFNumber ? wNum.asNumber() / dw : null;

  if (subtype === "Highlight") {
    const quad = numsOrNull(dict, "QuadPoints");
    if (!quad || quad.length < 8 || quad.length % 8 !== 0) return null;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i + 7 < quad.length; i += 8) {
      const pts = userPointsToNorm(page, [
        { x: quad[i], y: quad[i + 1] },
        { x: quad[i + 2], y: quad[i + 3] },
        { x: quad[i + 4], y: quad[i + 5] },
        { x: quad[i + 6], y: quad[i + 7] },
      ]);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      rects.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
    }
    const ca = dict.lookup(PDFName.of("CA"));
    return {
      kind: "highlight", ...common, rects, text: contents,
      opacity: ca instanceof PDFNumber ? ca.asNumber() : null,
    };
  }

  if (subtype === "Ink") {
    const list = dict.lookup(PDFName.of("InkList"));
    if (!(list instanceof PDFArray)) return null;
    const strokes: { x: number; y: number }[][] = [];
    for (let i = 0; i < list.size(); i++) {
      const raw = list.lookup(i);
      // Alles oder nichts: ein übersprungener Strich oder eine abgeschnittene
      // Koordinate wäre ein stiller Verlust. Vorher kam eine gekürzte
      // Annotation zurück und 'unsupported' blieb auf 0 — der Aufrufer hätte
      // nie erfahren, dass die Hälfte fehlt.
      if (!(raw instanceof PDFArray)) return null;
      const flat: number[] = [];
      for (let j = 0; j < raw.size(); j++) {
        const n = raw.lookup(j);
        if (!(n instanceof PDFNumber)) return null;
        flat.push(n.asNumber());
      }
      // Ungerade Zahl von Werten heisst: die letzte Koordinate hat keinen Partner.
      if (flat.length === 0 || flat.length % 2 !== 0) return null;
      const pts: { x: number; y: number }[] = [];
      for (let j = 0; j + 1 < flat.length; j += 2) pts.push({ x: flat[j], y: flat[j + 1] });
      strokes.push(userPointsToNorm(page, pts));
    }
    if (strokes.length === 0) return null;
    return { kind: "ink", ...common, strokes, strokeWidth };
  }

  if (subtype === "Square") {
    const r = numsOrNull(dict, "Rect");
    if (!r || r.length < 4) return null;
    const n = userRectToNorm(page, {
      x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]),
      width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]),
    });
    return {
      kind: "shape", ...common, shape: "rectangle", strokeWidth,
      startX: n.x, startY: n.y, endX: n.x + n.width, endY: n.y + n.height,
    };
  }

  if (subtype === "Line") {
    const l = numsOrNull(dict, "L");
    if (!l || l.length < 4) return null;
    const [s, e] = userPointsToNorm(page, [{ x: l[0], y: l[1] }, { x: l[2], y: l[3] }]);
    const le = dict.lookup(PDFName.of("LE"));
    let shape: "line" | "arrow" = "line";
    if (le instanceof PDFArray) {
      for (let i = 0; i < le.size(); i++) {
        const n = le.lookup(i);
        if (n instanceof PDFName && /Arrow/i.test(n.asString())) { shape = "arrow"; break; }
      }
    }
    return { kind: "shape", ...common, shape, strokeWidth, startX: s.x, startY: s.y, endX: e.x, endY: e.y };
  }

  if (subtype === "Text") {
    const r = numsOrNull(dict, "Rect");
    if (!r || r.length < 4) return null;
    // Spiegelbild des Schreibens: das ganze Rechteck zurückrechnen und seine
    // obere linke Ecke nehmen. Nur den Eckpunkt zu drehen ginge auf gedrehten
    // Seiten um die Kantenlänge daneben.
    const n = userRectToNorm(page, {
      x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]),
      width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]),
    });
    return { kind: "note", ...common, x: n.x, y: n.y, text: contents ?? "" };
  }

  if (subtype === "FreeText") {
    const r = numsOrNull(dict, "Rect");
    if (!r || r.length < 4) return null;
    const n = userRectToNorm(page, {
      x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]),
      width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]),
    });
    // Schriftgröße aus /DA („… 12 Tf …"), zurück als Anteil der Seitenhöhe.
    const da = strOrNull(dict, "DA") ?? "";
    const m = /(?:^|\s)([\d.]+)\s+Tf/.exec(da);
    const fontSize = m ? Number(m[1]) / dh : null;
    return { kind: "text", ...common, x: n.x, y: n.y, text: contents ?? "", fontSize };
  }

  return null;
}
