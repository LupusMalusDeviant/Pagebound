// =============================================================================
// Pagebound MCP — Anmerkungen als echte PDF-Annotationen (/Annots)
// ----------------------------------------------------------------------------
// PORT von src/Pagebound.Web/wwwroot/js/pdf-annots.ts. Dieses Paket wird als
// npm-Paket veröffentlicht und kann nicht über die Paketgrenze importieren;
// encrypt.ts, pdfa.ts und pdfua.ts sind aus demselben Grund Kopien. Wer dort
// etwas ändert, ändert es hier mit.
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
  PDFName,
  PDFNumber,
  PDFString,
  PDFPage,
  PDFRef,
} from "pdf-lib";
import {
  normPointsToUser,
  normRectToUser,
  userPointsToNorm,
  userRectToNorm,
  boundsOfUserPoints,
  displaySize,
} from "./geometry.js";

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
  startX?: number; startY?: number; endX?: number; endY?: number;
  text?: string | null;
  /** Schriftgröße als Anteil der Seitenhöhe (Freitext, wie im Reader via cqh). */
  fontSize?: number | null;
  x?: number; y?: number;
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
}

export interface ReadAnnotationsResult {
  items: AnnotItem[];
  unsupported: number;
}

/** Kantenlänge des Notiz-Markers in Punkten — wie bei Acrobat üblich. */
const NOTE_ICON_SIZE = 20;

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

/** D:YYYYMMDDHHmmSS… → ISO-8601, oder null. */
function fromPdfDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
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

function strOrNull(dict: PDFDict, key: string): string | null {
  const v = dict.lookup(PDFName.of(key));
  if (v instanceof PDFString) return v.asString();
  // PDFHexString hat ebenfalls decodeText(); über das Interface statt instanceof,
  // damit beide Schreibweisen (literal und hex) gelesen werden.
  const anyV = v as any;
  if (anyV && typeof anyV.decodeText === "function") return anyV.decodeText();
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
    NM: it.id ? PDFString.of(it.id) : undefined,
    M: date ? PDFString.of(date) : undefined,
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
    return { bytes: pdfBytes, written: 0, skipped: 0 };
  }

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  let written = 0;
  let skipped = 0;

  for (const it of items) {
    const page = pages[it.pageNumber - 1];
    if (!page) { skipped++; continue; }

    // Signaturen gehen diesen Weg laut Vertrag nicht mit.
    if (it.kind === "signature") { skipped++; continue; }

    const { width: dw, height: dh } = displaySize(page);
    const thickness = Math.max(0.5, (it.strokeWidth ?? 0.004) * dw);
    const dict = buildAnnot(doc, page, it, dw, dh, thickness, page.ref);
    if (!dict) { skipped++; continue; }

    annotsArray(doc, page).push(doc.context.register(dict));
    written++;
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, written, skipped };
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
      Contents: it.text ? PDFString.of(it.text) : undefined,
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
    const [p] = normPointsToUser(page, [{ x: it.x ?? 0, y: it.y ?? 0 }]);
    // Der Marker hat eine feste Größe; der Punkt ist seine obere linke Ecke.
    const rect = { x: p.x, y: p.y - NOTE_ICON_SIZE, width: NOTE_ICON_SIZE, height: NOTE_ICON_SIZE };
    return baseAnnot(doc, "Text", rect, it, {
      Name: PDFName.of("Comment"),
      // /Contents ist Klartext — Markdown rendert dort kein Betrachter
      // (Vertrag, Festlegung 1). Das Sidecar behält die Markdown-Fassung.
      Contents: PDFString.of(stripMarkdown(it.text ?? "")),
      ...P,
    });
  }

  if (it.kind === "text") {
    const size = Math.max(1, (it.fontSize ?? 0.02) * dh);
    const text = it.text ?? "";
    const lines = text.split("\n");
    // Breite grob aus der Zeichenzahl — Helvetica liegt im Mittel bei ~0,5 em.
    const widthPt = Math.min(dw, Math.max(...lines.map((l) => l.length)) * size * 0.5 + size);
    const heightPt = Math.max(size * 1.25, lines.length * size * 1.25);
    const rect = normRectToUser(page, {
      x: it.x ?? 0,
      y: it.y ?? 0,
      width: widthPt / dw,
      height: heightPt / dh,
    });
    const c = hexToComponents(it.color) ?? [0, 0, 0];
    // /DA ist der Bauplan, aus dem Betrachter das Erscheinungsbild erzeugen.
    const da = `/Helv ${size.toFixed(2)} Tf ${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg`;
    return baseAnnot(doc, "FreeText", rect, it, {
      Contents: PDFString.of(text),
      DA: PDFString.of(da),
      Q: PDFNumber.of(0),
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
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
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
      if (!(raw instanceof PDFArray)) continue;
      const flat: number[] = [];
      for (let j = 0; j < raw.size(); j++) {
        const n = raw.lookup(j);
        if (n instanceof PDFNumber) flat.push(n.asNumber());
      }
      const pts: { x: number; y: number }[] = [];
      for (let j = 0; j + 1 < flat.length; j += 2) pts.push({ x: flat[j], y: flat[j + 1] });
      if (pts.length > 0) strokes.push(userPointsToNorm(page, pts));
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
    // Beim Schreiben ist der Punkt die obere linke Ecke des Markers.
    const [p] = userPointsToNorm(page, [{ x: Math.min(r[0], r[2]), y: Math.max(r[1], r[3]) }]);
    return { kind: "note", ...common, x: p.x, y: p.y, text: contents ?? "" };
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
