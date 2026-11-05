// =============================================================================
// Bridge-Geometrietest: landen eingebrannte Annotationen dort, wo der Reader
// sie angezeigt hat — auch auf gedrehten Seiten (/Rotate) und bei CropBox-
// Versatz?
//
// Prüfsignal (bewusst unabhängig vom Code unter Test): PDF.js liest das
// Ergebnis neu ein und rechnet jede Zeichnung über DENSELBEN Viewport in
// Anzeigekoordinaten um, den auch der Reader benutzt (page.getViewport). Wer im
// Bridge-Code Rotation oder CropBox ignoriert, landet hier messbar daneben.
//
// Getestet werden die echten Bridge-Funktionen (pdf-manipulator-bridge.ts),
// per esbuild für Node gebündelt. Ausführen: npm test (in src/Pagebound.Web).
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

const outDir = mkdtempSync(join(tmpdir(), "pb-geom-"));
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
    // Die geprüften Bridge-Funktionen benutzen pdfjs nicht (nur Schwärzen/
    // Komprimieren rendern damit) — ein Stub hält den Bundle in Node ladbar.
    alias: { "pdfjs-dist": resolve(here, "pdfjs-stub.mjs") },
  });
  return import(pathToFileURL(outfile).href);
}

// PDF.js (Legacy-Build) will beim Import DOMMatrix/Path2D sehen. Hier wird nur
// gelesen (Operator-/Textliste), nicht gerendert — ein minimaler Ersatz genügt.
globalThis.DOMMatrix ??= class DOMMatrix {
  constructor() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); }
};
globalThis.Path2D ??= class Path2D {};

const bridge = await bundle("wwwroot/js/pdf-manipulator-bridge.ts", "bridge");
const geom = await bundle("wwwroot/js/page-geometry.ts", "geom");
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
const { PDFDocument } = await import(pathToFileURL(require.resolve("pdf-lib")).href);

// 1×1-PNG (rot) — klein, gültig, von pdf-lib einbettbar.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64"
);

/** Testseite: MediaBox 600×800 ab (0,0), CropBox optional versetzt, /Rotate. */
async function makePdf({ rotate = 0, crop = null }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  if (crop) page.setCropBox(crop.x, crop.y, crop.w, crop.h);
  if (rotate) page.setRotation({ type: "degrees", angle: rotate });
  return doc.save({ useObjectStreams: false });
}

// --- unabhängige Auswertung über PDF.js -------------------------------------

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

async function loadPage(bytes) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/",
  });
  const doc = { destroy: () => task.destroy() };
  const page = await (await task.promise).getPage(1);
  const vp = page.getViewport({ scale: 1 }); // wie der Reader
  return { doc, page, vp };
}

/** Text-Items in Anzeigekoordinaten (Origin oben-links) + Laufrichtung. */
async function textInDisplay(bytes) {
  const { doc, page, vp } = await loadPage(bytes);
  try {
    const tc = await page.getTextContent();
    return tc.items.filter((i) => i.str.trim()).map((i) => {
      const m = mul(vp.transform, i.transform);
      return { str: i.str, x: m[4], y: m[5], dirX: m[0], dirY: m[1], W: vp.width, H: vp.height };
    });
  } finally {
    await doc.destroy();
  }
}

/** Bounding-Boxen gemalter Bilder in Anzeigekoordinaten (CTM-Verfolgung über die Operatorliste). */
async function imagesInDisplay(bytes) {
  const { doc, page, vp } = await loadPage(bytes);
  try {
    const ops = await page.getOperatorList();
    const OPS = pdfjs.OPS;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const boxes = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin && args?.[0]) { stack.push(ctm); ctm = mul(ctm, args[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        const full = mul(vp.transform, ctm);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(full, x, y));
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        // Bild-Oberkante (y=1 im Bildraum) — muss oben liegen, sonst steht es kopf/quer.
        const topMid = apply(full, 0.5, 1), botMid = apply(full, 0.5, 0);
        boxes.push({
          x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
          upright: topMid[1] < botMid[1] && Math.abs(topMid[0] - botMid[0]) < 1e-6,
          W: vp.width, H: vp.height,
        });
      }
    }
    return boxes;
  } finally {
    await doc.destroy();
  }
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: erwartet ≈${b.toFixed(2)}, ist ${a.toFixed(2)}`);

const CASES = [
  { name: "Rotate 0", rotate: 0 },
  { name: "Rotate 90", rotate: 90 },
  { name: "Rotate 180", rotate: 180 },
  { name: "Rotate 270", rotate: 270 },
  { name: "CropBox versetzt", rotate: 0, crop: { x: 50, y: 100, w: 400, h: 500 } },
  { name: "Rotate 90 + CropBox versetzt", rotate: 90, crop: { x: 50, y: 100, w: 400, h: 500 } },
  { name: "Rotate -90 (= 270) + CropBox", rotate: -90, crop: { x: 30, y: 40, w: 500, h: 600 } },
];

// --- reine Geometrie ---------------------------------------------------------

test("normalizeRotation folgt PDF.js (nur Vielfache von 90)", () => {
  assert.equal(geom.normalizeRotation(-90), 270);
  assert.equal(geom.normalizeRotation(450), 90);
  assert.equal(geom.normalizeRotation(45), 0);
  assert.equal(geom.normalizeRotation(NaN), 0);
});

test("Matrix bildet die Anzeige-Ecken auf die richtigen Userspace-Ecken ab", () => {
  const box = { x: 10, y: 20, width: 300, height: 500 };
  // Erwartung je Rotation: angezeigte Ecke oben-links → Userspace-Ecke.
  const expectTopLeft = { 0: [10, 520], 90: [10, 20], 180: [310, 20], 270: [310, 520] };
  for (const r of [0, 90, 180, 270]) {
    const g = geom.computeDisplayGeometry(box, r);
    const [X, Y] = apply(g.matrix, 0, g.height);
    assert.deepEqual([X, Y], expectTopLeft[r], `Rotate ${r}`);
  }
});

// --- echte Bridge-Funktionen -------------------------------------------------

for (const c of CASES) {
  test(`flattenAnnotations Freitext: Position + aufrecht (${c.name})`, async () => {
    const input = await makePdf(c);
    const out = await bridge.flattenAnnotations(input, [
      { kind: "text", pageNumber: 1, x: 0.1, y: 0.2, text: "MARK", fontSize: 0.03, color: "#000000" },
    ]);
    const items = await textInDisplay(out);
    const mark = items.find((i) => i.str.includes("MARK"));
    assert.ok(mark, "eingebrannter Text nicht gefunden");
    const size = 0.03 * mark.H;
    near(mark.x, 0.1 * mark.W, 1, "x");
    near(mark.y, 0.2 * mark.H + size, 1, "Grundlinie y");
    assert.ok(mark.dirX > 0 && Math.abs(mark.dirY) < 1e-6, `Text steht nicht aufrecht (dir=${mark.dirX},${mark.dirY})`);
  });

  test(`embedSignatures: Bild-Box + aufrecht (${c.name})`, async () => {
    const input = await makePdf(c);
    const out = await bridge.embedSignatures(input, [{
      pageNumber: 1, imageBytes: PNG_1PX, x: 0.25, y: 0.6, width: 0.3, height: 0.1,
      signedAtIso: "2026-01-01T00:00:00Z", signerName: "Test", signerEmail: null,
      signerReason: null, signerLocation: null, integrityHash: null,
    }]);
    const [img] = await imagesInDisplay(out);
    assert.ok(img, "Signaturbild nicht gefunden");
    near(img.x, 0.25 * img.W, 0.5, "x");
    near(img.y, 0.6 * img.H, 0.5, "y");
    near(img.w, 0.3 * img.W, 0.5, "Breite");
    near(img.h, 0.1 * img.H, 0.5, "Höhe");
    assert.ok(img.upright, "Signatur steht nicht aufrecht");
  });

  test(`flattenAnnotations Signatur: Bild-Box (${c.name})`, async () => {
    const input = await makePdf(c);
    const out = await bridge.flattenAnnotations(input, [{
      kind: "signature", pageNumber: 1, x: 0.5, y: 0.1, width: 0.2, height: 0.05,
      imageBase64: PNG_1PX.toString("base64"),
    }]);
    const [img] = await imagesInDisplay(out);
    assert.ok(img, "Signaturbild nicht gefunden");
    near(img.x, 0.5 * img.W, 0.5, "x");
    near(img.y, 0.1 * img.H, 0.5, "y");
    near(img.w, 0.2 * img.W, 0.5, "Breite");
    assert.ok(img.upright, "Signatur steht nicht aufrecht");
  });

  test(`applyTextEdits: Position + aufrecht (${c.name})`, async () => {
    const input = await makePdf(c);
    const out = await bridge.applyTextEdits(input, [
      { pageNumber: 1, x: 0.3, y: 0.4, w: 0.2, h: 0.03, text: "EDIT", fontSize: 0.02 },
    ]);
    const items = await textInDisplay(out);
    const t = items.find((i) => i.str.includes("EDIT"));
    assert.ok(t, "Text nicht gefunden");
    near(t.x, 0.3 * t.W, 1, "x");
    near(t.y, 0.4 * t.H + 0.02 * t.H, 1, "Grundlinie y");
    assert.ok(t.dirX > 0 && Math.abs(t.dirY) < 1e-6, "Text steht nicht aufrecht");
  });

  test(`stampPdf Seitenzahl: unten mittig, aufrecht (${c.name})`, async () => {
    const input = await makePdf(c);
    const out = await bridge.stampPdf(input, { pageNumbers: true, pageNumberFormat: "S{n}", pageNumberPosition: "bottom-center", pageNumberFontSize: 10 });
    const items = await textInDisplay(out);
    const t = items.find((i) => i.str.includes("S1"));
    assert.ok(t, "Seitenzahl nicht gefunden");
    near(t.y, t.H - 24, 1, "Grundlinie 24pt über Unterkante");
    assert.ok(Math.abs(t.x - t.W / 2) < 20, `nicht mittig: x=${t.x.toFixed(1)}, W=${t.W}`);
    assert.ok(t.dirX > 0 && Math.abs(t.dirY) < 1e-6, "Seitenzahl steht nicht aufrecht");
  });
}

// --- Formular-Widgets (eigenes /Rect im Userspace) ---------------------------

for (const c of CASES) {
  test(`createFormFields: Widget-Rechteck an angezeigter Stelle (${c.name})`, async () => {
    const input = await makePdf(c);
    const out = await bridge.createFormFields(input, [
      { pageNumber: 1, x: 0.1, y: 0.3, width: 0.4, height: 0.05, name: "feld", fieldType: "text" },
    ]);
    const { doc, page, vp } = await loadPage(out);
    try {
      const annots = await page.getAnnotations();
      const w = annots.find((a) => a.fieldName === "feld");
      assert.ok(w, "Widget nicht gefunden");
      const [x1, y1] = apply(vp.transform, w.rect[0], w.rect[1]);
      const [x2, y2] = apply(vp.transform, w.rect[2], w.rect[3]);
      const x = Math.min(x1, x2), y = Math.min(y1, y2), W = Math.abs(x2 - x1), H = Math.abs(y2 - y1);
      // Toleranz 1pt: pdf-lib vergrößert das Widget-/Rect um die Rahmenbreite (1pt).
      near(x, 0.1 * vp.width, 1, "x");
      near(y, 0.3 * vp.height, 1, "y");
      near(W, 0.4 * vp.width, 1, "Breite");
      near(H, 0.05 * vp.height, 1, "Höhe");
      // Erscheinungsbild muss die Seitendrehung aufheben (/MK /R = /Rotate).
      const pageRot = ((c.rotate % 360) + 360) % 360;
      assert.equal(w.rotation ?? 0, pageRot, "Widget-Drehung hebt die Seitendrehung nicht auf");
    } finally {
      await doc.destroy();
    }
  });
}
