// =============================================================================
// /Annots — schreiben und lesen (Vertrag: docs/contracts/annotationen-als-pdf-annots.md)
//
// Das Prüfsignal ist bewusst NICHT der eigene Kodierer. Gegengelesen wird mit
// PDF.js (`page.getAnnotations()`), einem fremden Parser: er sieht die
// Annotation als Objekt, mit Subtyp und /Rect — nicht als Pixel. Genau das ist
// der Unterschied, um den es geht. Eine eingebrannte Markierung sieht richtig
// aus und würde hier nicht einmal auftauchen.
//
// Alle Fälle laufen zusätzlich über gedrehte und beschnittene Seiten. Auf einer
// geraden A4-Seite ab (0,0) bestünde auch eine falsche Geometrie.
//
// Ausführen: npm test (in src/Pagebound.Web).
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const require = createRequire(join(webRoot, "package.json"));

const outDir = mkdtempSync(join(tmpdir(), "pb-annots-"));
process.on("exit", () => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, name) {
  const outfile = join(outDir, `${name}.mjs`);
  await build({
    entryPoints: [resolve(webRoot, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    alias: { "pdfjs-dist": resolve(here, "pdfjs-stub.mjs") },
  });
  return import(pathToFileURL(outfile).href);
}

globalThis.DOMMatrix ??= class DOMMatrix {
  constructor() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); }
};
globalThis.Path2D ??= class Path2D {};

const annots = await bundle("wwwroot/js/pdf-annots.ts", "annots");
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
const { PDFDocument, PDFName, PDFArray, PDFNumber } =
  await import(pathToFileURL(require.resolve("pdf-lib")).href);

/** Testseite: MediaBox 600×800 ab (0,0), CropBox optional versetzt, /Rotate. */
async function makePdf({ rotate = 0, crop = null }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  if (crop) page.setCropBox(crop.x, crop.y, crop.w, crop.h);
  if (rotate) page.setRotation({ type: "degrees", angle: rotate });
  return doc.save({ useObjectStreams: false });
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Annotationen über PDF.js lesen und ihr /Rect in Anzeigekoordinaten
 * (0..1, Ursprung oben links) umrechnen — über DENSELBEN Viewport, den der
 * Reader benutzt.
 */
async function annotationsInDisplay(bytes) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl:
      join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/",
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const list = await page.getAnnotations({ intent: "display" });
    return list.map((a) => {
      const [x0, y0] = apply(vp.transform, a.rect[0], a.rect[1]);
      const [x1, y1] = apply(vp.transform, a.rect[2], a.rect[3]);
      return {
        subtype: a.subtype,
        contents: a.contentsObj?.str ?? a.contents ?? "",
        id: a.id,
        x: Math.min(x0, x1) / vp.width,
        y: Math.min(y0, y1) / vp.height,
        w: Math.abs(x1 - x0) / vp.width,
        h: Math.abs(y1 - y0) / vp.height,
        raw: a,
      };
    });
  } finally {
    await task.destroy();
  }
}

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: erwartet ≈${b.toFixed(4)}, ist ${a.toFixed(4)}`);

const CASES = [
  { name: "Rotate 0", rotate: 0 },
  { name: "Rotate 90", rotate: 90 },
  { name: "Rotate 180", rotate: 180 },
  { name: "Rotate 270", rotate: 270 },
  { name: "CropBox versetzt", rotate: 0, crop: { x: 50, y: 100, w: 400, h: 500 } },
  { name: "Rotate 90 + CropBox versetzt", rotate: 90, crop: { x: 50, y: 100, w: 400, h: 500 } },
  { name: "Rotate -90 (= 270) + CropBox", rotate: -90, crop: { x: 30, y: 40, w: 500, h: 600 } },
];

// --- Das eigentliche Versprechen: PDF.js sieht ein ANNOTATIONSOBJEKT ---------

for (const c of CASES) {
  test(`Highlight landet als /Highlight an der angezeigten Stelle (${c.name})`, async () => {
    const input = await makePdf(c);
    const r = await annots.writeAnnotations(input, [{
      kind: "highlight", pageNumber: 1, color: "#fef08a",
      rects: [{ x: 0.2, y: 0.3, w: 0.25, h: 0.05 }],
      text: "Belegstelle", id: "ann-abc12345", modified: "2026-11-12T10:00:00.000Z",
    }]);
    assert.equal(r.written, 1);
    assert.equal(r.skipped, 0);

    const found = await annotationsInDisplay(r.bytes);
    assert.equal(found.length, 1, "PDF.js findet keine Annotation");
    const a = found[0];
    assert.equal(a.subtype, "Highlight");
    // Toleranz 0,002 der Seite ≈ 1,2 pt bei 600 pt Breite.
    near(a.x, 0.2, 0.002, "x");
    near(a.y, 0.3, 0.002, "y");
    near(a.w, 0.25, 0.002, "Breite");
    near(a.h, 0.05, 0.002, "Höhe");
    // PDF.js übernimmt /QuadPoints nur, wenn sie brauchbar sind — es gibt sie
    // als Float32Array zurück (nicht als Array). Acht Werte in der Reihenfolge
    // oben-links, oben-rechts, unten-links, unten-rechts, und sie müssen
    // dasselbe Rechteck aufspannen wie /Rect.
    const qp = Array.from(a.raw.quadPoints ?? []);
    assert.equal(qp.length, 8, "PDF.js hat die /QuadPoints verworfen");
    const qx = [qp[0], qp[2], qp[4], qp[6]], qy = [qp[1], qp[3], qp[5], qp[7]];
    near(Math.min(...qx), Math.min(a.raw.rect[0], a.raw.rect[2]), 0.01, "QuadPoints links");
    near(Math.max(...qy), Math.max(a.raw.rect[1], a.raw.rect[3]), 0.01, "QuadPoints oben");
    assert.ok(qy[0] > qy[2], "erste zwei Punkte müssen die OBERE Kante sein");
  });

  test(`Rechteck landet als /Square an der angezeigten Stelle (${c.name})`, async () => {
    const input = await makePdf(c);
    const r = await annots.writeAnnotations(input, [{
      kind: "shape", pageNumber: 1, shape: "rectangle", color: "#ff0000", strokeWidth: 0.004,
      startX: 0.1, startY: 0.15, endX: 0.6, endY: 0.45,
    }]);
    const [a] = await annotationsInDisplay(r.bytes);
    assert.equal(a.subtype, "Square");
    near(a.x, 0.1, 0.002, "x");
    near(a.y, 0.15, 0.002, "y");
    near(a.w, 0.5, 0.002, "Breite");
    near(a.h, 0.3, 0.002, "Höhe");
  });
}

test("Ink, Linie, Pfeil, Notiz und Freitext bekommen ihre Subtypen", async () => {
  const input = await makePdf({ rotate: 90, crop: { x: 20, y: 30, w: 450, h: 550 } });
  const r = await annots.writeAnnotations(input, [
    { kind: "ink", pageNumber: 1, color: "#000000", strokes: [[{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.4 }]] },
    { kind: "shape", pageNumber: 1, shape: "line", startX: 0.1, startY: 0.5, endX: 0.5, endY: 0.5 },
    { kind: "shape", pageNumber: 1, shape: "arrow", startX: 0.1, startY: 0.6, endX: 0.5, endY: 0.6 },
    { kind: "note", pageNumber: 1, x: 0.7, y: 0.2, text: "**fett** und `code`" },
    { kind: "text", pageNumber: 1, x: 0.2, y: 0.8, text: "Hallo", fontSize: 0.03, color: "#0000ff" },
  ]);
  assert.equal(r.written, 5);
  const found = await annotationsInDisplay(r.bytes);
  assert.deepEqual(found.map((a) => a.subtype).sort(),
    ["FreeText", "Ink", "Line", "Line", "Text"]);

  // Vertrag, Festlegung 1: /Contents ist Klartext, kein Markdown.
  const note = found.find((a) => a.subtype === "Text");
  assert.equal(note.contents, "fett und code");
});

test("Signaturen gehen den Weg /Annots nicht mit und werden GEZÄHLT", async () => {
  const input = await makePdf({});
  const r = await annots.writeAnnotations(input, [
    { kind: "highlight", pageNumber: 1, rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.03 }] },
    { kind: "signature", pageNumber: 1, x: 0.1, y: 0.5, width: 0.2, height: 0.1, imageBase64: "AAAA" },
  ]);
  assert.equal(r.written, 1);
  assert.equal(r.skipped, 1, "die Signatur muss als übersprungen gemeldet werden, nicht verschwinden");
  const found = await annotationsInDisplay(r.bytes);
  assert.equal(found.length, 1);
});

// --- Round-Trip --------------------------------------------------------------

for (const c of CASES) {
  test(`Round-Trip: schreiben → lesen trifft dieselben Koordinaten (${c.name})`, async () => {
    const original = [
      { kind: "highlight", pageNumber: 1, color: "#fef08a", rects: [{ x: 0.2, y: 0.3, w: 0.25, h: 0.05 }], text: "x" },
      { kind: "ink", pageNumber: 1, color: "#112233", strokeWidth: 0.005,
        strokes: [[{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.4 }, { x: 0.5, y: 0.2 }]] },
      { kind: "shape", pageNumber: 1, shape: "arrow", color: "#ff0000", startX: 0.1, startY: 0.6, endX: 0.5, endY: 0.7 },
      { kind: "text", pageNumber: 1, x: 0.2, y: 0.8, text: "Hallo", fontSize: 0.03, color: "#0000ff" },
    ];
    const w = await annots.writeAnnotations(await makePdf(c), original);
    const back = await annots.readAnnotations(w.bytes);
    assert.equal(back.unsupported, 0);
    assert.equal(back.items.length, original.length);

    const hl = back.items.find((i) => i.kind === "highlight");
    near(hl.rects[0].x, 0.2, 0.002, "Highlight x");
    near(hl.rects[0].y, 0.3, 0.002, "Highlight y");
    near(hl.rects[0].w, 0.25, 0.002, "Highlight Breite");
    assert.equal(hl.color, "#fef08a");

    const ink = back.items.find((i) => i.kind === "ink");
    assert.equal(ink.strokes[0].length, 3);
    near(ink.strokes[0][1].x, 0.3, 0.002, "Ink Punkt x");
    near(ink.strokes[0][1].y, 0.4, 0.002, "Ink Punkt y");
    near(ink.strokeWidth, 0.005, 0.0005, "Strichbreite");

    const arrow = back.items.find((i) => i.kind === "shape");
    assert.equal(arrow.shape, "arrow");
    near(arrow.startX, 0.1, 0.002, "Pfeil startX");
    near(arrow.endY, 0.7, 0.002, "Pfeil endY");

    const free = back.items.find((i) => i.kind === "text");
    assert.equal(free.text, "Hallo");
    near(free.fontSize, 0.03, 0.001, "Schriftgröße");
  });
}

// --- Reproduzierbarkeit (Zusage seit MCP 2.0.0) ------------------------------

test("zweimal schreiben ergibt byte-gleiche Ausgaben", async () => {
  const items = [{
    kind: "highlight", pageNumber: 1, rects: [{ x: 0.2, y: 0.3, w: 0.25, h: 0.05 }],
    id: "ann-stable01", modified: "2026-11-12T10:00:00.000Z",
  }];
  const input = await makePdf({});
  const a = await annots.writeAnnotations(input, items);
  const b = await annots.writeAnnotations(input, items);
  assert.deepEqual(Buffer.from(a.bytes), Buffer.from(b.bytes),
    "gleiche Eingabe muss byte-gleich sein — keine Uhr, keine Zufalls-Id");
});

test("ohne 'modified' entsteht KEIN /M aus der Systemuhr", () => {
  assert.equal(annots.toPdfDate(undefined), null);
  assert.equal(annots.toPdfDate("kein Datum"), null);
  assert.equal(annots.toPdfDate("2026-11-12T10:00:00.000Z"), "D:20261112100000Z");
});

// --- Der Leser muss an einem bekannt schlechten Eingang scheitern -------------

test("kaputte /QuadPoints werden als 'unsupported' gezählt, nicht geraten", async () => {
  // Erst eine gültige Annotation schreiben, dann ihre QuadPoints zerstören.
  const w = await annots.writeAnnotations(await makePdf({}), [
    { kind: "highlight", pageNumber: 1, rects: [{ x: 0.2, y: 0.3, w: 0.25, h: 0.05 }] },
  ]);
  const doc = await PDFDocument.load(w.bytes);
  const arr = doc.getPage(0).node.lookup(PDFName.of("Annots"));
  const dict = arr.lookup(0);
  const broken = PDFArray.withContext(doc.context);
  broken.push(PDFNumber.of(1));
  broken.push(PDFNumber.of(2));
  broken.push(PDFNumber.of(3)); // drei statt acht → unbrauchbar
  dict.set(PDFName.of("QuadPoints"), broken);

  const back = await annots.readAnnotations(await doc.save({ useObjectStreams: false }));
  assert.equal(back.items.length, 0, "aus kaputten Daten darf nichts geraten werden");
  assert.equal(back.unsupported, 1, "der Verlust muss gemeldet werden");
});

test("fremde Subtypen werden gezählt statt still verworfen", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.node.set(PDFName.of("Annots"), PDFArray.withContext(doc.context));
  const form = doc.getForm();
  form.createTextField("feld.eins").addToPage(page, { x: 10, y: 10, width: 100, height: 20 });

  const back = await annots.readAnnotations(await doc.save({ useObjectStreams: false }));
  assert.equal(back.items.length, 0);
  assert.ok(back.unsupported >= 1, "das Widget muss in 'unsupported' auftauchen");
});

test("leere Eingabe lässt die PDF unangetastet", async () => {
  const input = await makePdf({});
  const r = await annots.writeAnnotations(input, []);
  assert.equal(r.written, 0);
  assert.deepEqual(Buffer.from(r.bytes), Buffer.from(input));
});
