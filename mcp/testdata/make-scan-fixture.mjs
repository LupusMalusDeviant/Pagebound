#!/usr/bin/env node
// =============================================================================
// Erzeugt das Test-Material für pdf_ocr: eine "gescannte" Rechnung und ein
// leeres Blatt. Beides wird als PDF neben dieses Skript gelegt und ist im Repo
// eingecheckt — der Generator dient der Nachvollziehbarkeit, nicht dem Build.
//
// EHRLICH: das ist ein SYNTHETISCHER Scan, kein echter. Er entsteht, indem die
// Umrisse echter Glyphen (Liberation Sans über fontkit) mit einem kleinen
// Scanline-Rasterizer zu einem Graustufenbild gefüllt und als bildschirm-
// füllendes Bild in eine PDF gelegt werden — also eine Seite ohne Textebene,
// genau wie ein Scan. Was fehlt: Sensorrauschen, Schräglage, JPEG-Artefakte.
// Wer einen echten Scan hat, kann ihn hier ablegen und die Erwartungen im
// Smoke-Test anpassen.
//
// Aufruf:  node testdata/make-scan-fixture.mjs
// =============================================================================
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { readFileSync, writeFileSync } from "node:fs";
import { grayscaleToPng } from "../dist/ocr.js";

const HERE = new URL(".", import.meta.url);
const FONT = new URL("../fonts/LiberationSans-Regular.ttf", import.meta.url);

/** 3x überabtasten und mitteln — weiche Kanten, die Tesseract mag. */
const SS = 3;

function glyphPolygons(path, scale, originX, originY) {
  const polys = [];
  let cur = [];
  let cx = 0, cy = 0;
  const pt = (x, y) => [originX + x * scale, originY - y * scale]; // Font: y nach oben
  const flatten = (p0, ctrl, p1, steps = 12) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      if (ctrl.length === 1) {
        const [q] = ctrl;
        cur.push([
          mt * mt * p0[0] + 2 * mt * t * q[0] + t * t * p1[0],
          mt * mt * p0[1] + 2 * mt * t * q[1] + t * t * p1[1],
        ]);
      } else {
        const [a, b] = ctrl;
        cur.push([
          mt ** 3 * p0[0] + 3 * mt * mt * t * a[0] + 3 * mt * t * t * b[0] + t ** 3 * p1[0],
          mt ** 3 * p0[1] + 3 * mt * mt * t * a[1] + 3 * mt * t * t * b[1] + t ** 3 * p1[1],
        ]);
      }
    }
  };
  for (const c of path.commands) {
    const a = c.args;
    if (c.command === "moveTo") {
      if (cur.length > 2) polys.push(cur);
      cur = [pt(a[0], a[1])]; cx = a[0]; cy = a[1];
    } else if (c.command === "lineTo") {
      cur.push(pt(a[0], a[1])); cx = a[0]; cy = a[1];
    } else if (c.command === "quadraticCurveTo") {
      flatten(pt(cx, cy), [pt(a[0], a[1])], pt(a[2], a[3])); cx = a[2]; cy = a[3];
    } else if (c.command === "bezierCurveTo") {
      flatten(pt(cx, cy), [pt(a[0], a[1]), pt(a[2], a[3])], pt(a[4], a[5])); cx = a[4]; cy = a[5];
    } else if (c.command === "closePath") {
      if (cur.length > 2) polys.push(cur);
      cur = [];
    }
  }
  if (cur.length > 2) polys.push(cur);
  return polys;
}

/** Scanline-Füllung, Nonzero-Winding. */
function fillPolygons(mask, w, h, polys) {
  const edges = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      if (y0 !== y1) edges.push({ x0, y0, x1, y1 });
    }
  }
  for (let y = 0; y < h; y++) {
    const sy = y + 0.5;
    const hits = [];
    for (const { x0, y0, x1, y1 } of edges) {
      if ((sy >= y0 && sy < y1) || (sy >= y1 && sy < y0)) {
        hits.push({ x: x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0), dir: y1 > y0 ? 1 : -1 });
      }
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let i = 0; i < hits.length - 1; i++) {
      winding += hits[i].dir;
      if (winding === 0) continue;
      const from = Math.max(0, Math.ceil(hits[i].x - 0.5));
      const to = Math.min(w - 1, Math.floor(hits[i + 1].x - 0.5));
      for (let x = from; x <= to; x++) mask[y * w + x] = 1;
    }
  }
}

function renderLines(lines, { fontSize = 34, pad = 30, lineGap = 12 } = {}) {
  const font = fontkit.create(readFileSync(FONT));
  const scale = fontSize / font.unitsPerEm;
  const runs = lines.map((t) => font.layout(t));
  const widths = runs.map((r) => r.glyphs.reduce((s, g) => s + g.advanceWidth, 0) * scale);
  const lineH = fontSize * 1.35;
  const w = Math.ceil(pad * 2 + Math.max(...widths));
  const h = Math.ceil(pad * 2 + lines.length * lineH + (lines.length - 1) * lineGap);

  const W = w * SS, H = h * SS;
  const mask = new Uint8Array(W * H);
  runs.forEach((run, li) => {
    let penX = pad * SS;
    const baseline = (pad + li * (lineH + lineGap) + fontSize) * SS;
    for (const g of run.glyphs) {
      const polys = glyphPolygons(g.path, scale * SS, penX, baseline);
      if (polys.length) fillPolygons(mask, W, H, polys);
      penX += g.advanceWidth * scale * SS;
    }
  });

  const px = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) on += mask[(y * SS + dy) * W + (x * SS + dx)];
      px[y * w + x] = 255 - Math.round((on / (SS * SS)) * 255);
    }
  }
  return { px, w, h };
}

/** Legt ein Graustufenbild als seitenfüllendes Bild in eine PDF — wie ein Scan. */
async function imageToPdf(px, w, h) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const img = await doc.embedPng(grayscaleToPng(px, w, h));
  const page = doc.addPage([595.28, 841.89]);
  const scale = Math.min(515 / w, 700 / h);
  page.drawImage(img, { x: 40, y: 841.89 - 60 - h * scale, width: w * scale, height: h * scale });
  return doc.save();
}

// --- 1) "Gescannte" Rechnung -------------------------------------------------
const LINES = [
  "Rechnung LMD-2026-0042",
  "Beratung 3 Std. 285,00 EUR",
  "Gesamtbetrag 448,29 EUR",
];
const scan = renderLines(LINES);
writeFileSync(new URL("scan-rechnung.pdf", HERE), await imageToPdf(scan.px, scan.w, scan.h));

// --- 2) Leeres Blatt — die Gegenprobe ----------------------------------------
// Ein Scan ohne Inhalt. Findet OCR hier Text, erfindet es welchen.
const blank = { px: new Uint8Array(600 * 260).fill(255), w: 600, h: 260 };
writeFileSync(new URL("scan-leer.pdf", HERE), await imageToPdf(blank.px, blank.w, blank.h));

console.log("geschrieben:");
console.log("  scan-rechnung.pdf  — Text:", JSON.stringify(LINES));
console.log("  scan-leer.pdf      — weißes Blatt (Gegenprobe)");
