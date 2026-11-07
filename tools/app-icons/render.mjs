#!/usr/bin/env node
// Erzeugt das maskierbare App-Icon (wwwroot/icon-512-maskable.png) aus icon-512.png.
//
// Ausführen (Repo-Wurzel):
//   PLAYWRIGHT_MODULE=tests/Pagebound.E2ETests/bin/Release/net10.0/.playwright/package \
//   node tools/app-icons/render.mjs
// Braucht Playwright (Chromium) wie tools/og-image/render.mjs. Keine externen
// Requests: Quelle ist ausschliesslich wwwroot/icon-512.png.
//
// Warum ueberhaupt ein zweites Icon: Android und der Microsoft Store schneiden
// Icons in eine Maske (Kreis, Squircle, abgerundetes Quadrat). Garantiert sichtbar
// bleibt nur der innere Kreis mit 80 % Durchmesser ("safe zone"). Das normale Icon
// traegt den Schriftzug "Pagebound" bis an den Rand — der wuerde angeschnitten.
// Das maskierbare Icon zeigt deshalb nur die Bildmarke, mittig, klein genug fuer
// die safe zone, auf dem gleichen weissen Grund.
//
// Die Bildmarke wird NICHT nach Augenmass zugeschnitten, sondern gemessen: das
// Skript sucht im Quellbild zusammenhaengende Zeilenbaender mit Inhalt und nimmt
// das oberste (die Marke, darunter folgt nach einer Leerzeile der Schriftzug).
// Aendert sich das Logo, stimmt der Ausschnitt weiter — oder das Skript bricht ab.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const www = resolve(root, "src/Pagebound.Web/wwwroot");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require(resolve(root, process.env.PLAYWRIGHT_MODULE || "playwright"))); }

const SIZE = 512;
// Anteil der Kantenlaenge, den die Marke einnehmen darf. Die safe zone ist ein
// Kreis mit 80 % Durchmesser; ein Quadrat darin hat 80 % / sqrt(2) ~ 56,5 %.
const SAFE = 0.56;
const source = `data:image/png;base64,${readFileSync(resolve(www, "icon-512.png")).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });

// Messen: Baender mit Inhalt finden und das oberste zurueckgeben.
const box = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error("Bild nicht ladbar")); img.src = src; });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  // "Inhalt" = sichtbar und nicht nahezu weiss.
  const ink = (x, y) => {
    const i = (y * c.width + x) * 4;
    return data[i + 3] > 24 && (data[i] < 236 || data[i + 1] < 236 || data[i + 2] < 236);
  };
  const rowHasInk = [];
  for (let y = 0; y < c.height; y++) {
    let has = false;
    for (let x = 0; x < c.width && !has; x++) has = ink(x, y);
    rowHasInk.push(has);
  }
  const bands = [];
  for (let y = 0; y < c.height; y++) {
    if (!rowHasInk[y]) continue;
    const start = y;
    while (y < c.height && rowHasInk[y]) y++;
    bands.push({ top: start, bottom: y - 1 });
  }
  if (bands.length < 2) return { error: `erwartet: Marke und Schriftzug als zwei Baender, gefunden: ${bands.length}` };
  const band = bands[0];
  let left = c.width, right = -1;
  for (let y = band.top; y <= band.bottom; y++)
    for (let x = 0; x < c.width; x++)
      if (ink(x, y)) { if (x < left) left = x; if (x > right) right = x; }
  return { x: left, y: band.top, w: right - left + 1, h: band.bottom - band.top + 1, bands: bands.length, src: c.width };
}, source);

if (box.error) { await browser.close(); throw new Error(`icon-512.png: ${box.error}`); }
console.log(`Bildmarke gemessen: ${box.w}x${box.h} bei (${box.x},${box.y}) in ${box.src}px, ${box.bands} Baender`);

// Zeichnen: Marke mittig, laengste Kante auf SAFE skaliert, weisser Grund.
const scale = (SIZE * SAFE) / Math.max(box.w, box.h);
const drawW = box.w * scale, drawH = box.h * scale;
// Der Rahmen hat genau die Groesse des Ausschnitts und schneidet ab (overflow:
// hidden); das Bild liegt darin so weit nach links/oben verschoben, dass die
// Marke im Rahmen steht. Ohne diesen Rahmen bliebe der Schriftzug sichtbar — er
// steht im Quellbild unter der Marke und wurde nur verschoben, nicht entfernt.
await page.setContent(`<!DOCTYPE html><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  body{width:${SIZE}px;height:${SIZE}px;background:#ffffff;overflow:hidden}
  .crop{position:absolute;overflow:hidden;
        left:${(SIZE - drawW) / 2}px; top:${(SIZE - drawH) / 2}px;
        width:${drawW}px; height:${drawH}px}
  .crop img{position:absolute;
      left:${-box.x * scale}px; top:${-box.y * scale}px;
      width:${box.src * scale}px; height:${box.src * scale}px}
</style><div class="crop"><img src="${source}" alt=""></div>`);
writeFileSync(resolve(www, "icon-512-maskable.png"), await page.screenshot({ type: "png" }));
await browser.close();
console.log("ok wwwroot/icon-512-maskable.png");
