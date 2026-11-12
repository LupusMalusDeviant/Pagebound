// =============================================================================
// Seitenbilder als Blob-URLs — Vertrag docs/contracts/seitenbilder-speicher.md
//
// Was hier geprüft wird: dass die Brücke jede erzeugte Blob-URL wiederfindet
// und wieder loswird. Das ist der Preis des neuen Transportwegs — eine
// Blob-URL ist eine Ressource und kein String; nicht widerrufen heisst geleckt,
// dieselbe Leitplanke wie loadingTask.destroy().
//
// Was hier NICHT geprüft wird, und warum: ob das Bild richtig aussieht.
// Echtes Rendern braucht eine echte Leinwand, die es in Node nicht gibt.
// Rendern und Geometrie prüfen geometry.test.mjs und annots.test.mjs gegen das
// echte PDF.js. Diese Datei benutzt bewusst eine Attrappe (pdfjs-fake.mjs) —
// sie sagt über das Bild nichts aus und behauptet es auch nicht.
//
// Das Prüfsignal gegen den eigentlichen Fehler ist der Zähler
// openPageImageCount: der alte Code sammelte Seitenbilder ohne Obergrenze.
// Eine Prüfung, die nur „wird angezeigt" fragt, hätte das nie bemerkt.
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

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const outDir = mkdtempSync(join(tmpdir(), "pb-pageimg-"));
process.on("exit", () => rmSync(outDir, { recursive: true, force: true }));

// --- die Browser-Teile, die die Brücke anfasst -------------------------------

let created = 0;
let revoked = 0;
const live = new Set();

globalThis.URL.createObjectURL = () => {
  const url = `blob:pagebound/${++created}`;
  live.add(url);
  return url;
};
globalThis.URL.revokeObjectURL = (url) => {
  // Wie im Browser: eine URL zu widerrufen, die es nicht gibt, tut nichts.
  // Mitgezählt wird nur, was wirklich freigegeben wurde — sonst verdeckt ein
  // Fehlerfall-Aufruf am Ende ein echtes Leck.
  if (live.delete(url)) revoked++;
};

globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({}),
    toBlob: (cb) => cb({ size: 1, type: "image/png" }),
  }),
};

const outfile = join(outDir, "bridge.mjs");
await build({
  entryPoints: [resolve(webRoot, "wwwroot/js/pdfjs-bridge.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "pdfjs-dist": resolve(here, "pdfjs-fake.mjs") },
});
const bridge = await import(pathToFileURL(outfile).href);

async function freshHandle() {
  const { id } = await bridge.loadPdf(new Uint8Array([1, 2, 3]), null);
  return id;
}

// --- Buchführung -------------------------------------------------------------

test("renderPageToUrl liefert eine URL und zählt sie als offen", async () => {
  const id = await freshHandle();
  const before = bridge.openPageImageCount(id);
  const img = await bridge.renderPageToUrl(id, 1, 1.5);

  assert.ok(img.url.startsWith("blob:"), `keine Blob-URL: ${img.url}`);
  assert.equal(img.pageNumber, 1);
  assert.equal(img.widthPx, 900);   // 600 × 1.5
  assert.equal(img.heightPx, 1200); // 800 × 1.5
  // Die ungezoomten Maße: daraus reserviert der Platzhalter seine Höhe.
  assert.equal(img.pageWidthPt, 600);
  assert.equal(img.pageHeightPt, 800);
  assert.equal(bridge.openPageImageCount(id), before + 1);

  await bridge.unload(id);
});

test("releasePageImage widerruft genau eine URL", async () => {
  const id = await freshHandle();
  const a = await bridge.renderPageToUrl(id, 1, 1);
  const b = await bridge.renderPageToUrl(id, 2, 1);
  assert.equal(bridge.openPageImageCount(id), 2);

  const revokedBefore = revoked;
  bridge.releasePageImage(a.url);
  assert.equal(revoked, revokedBefore + 1);
  assert.equal(bridge.openPageImageCount(id), 1);
  assert.ok(!live.has(a.url), "die freigegebene URL ist noch am Leben");
  assert.ok(live.has(b.url), "die andere URL darf nicht mit freigegeben werden");

  await bridge.unload(id);
});

test("eine unbekannte URL freizugeben ist kein Fehler", () => {
  bridge.releasePageImage("blob:gibt-es-nicht");
  bridge.releasePageImage("");
  bridge.releaseAllPageImages("pdf-gibt-es-nicht");
});

test("unload widerruft ALLE offenen URLs des Handles", async () => {
  const id = await freshHandle();
  for (let p = 1; p <= 7; p++) await bridge.renderPageToUrl(id, p, 1);
  assert.equal(bridge.openPageImageCount(id), 7);

  await bridge.unload(id);
  assert.equal(bridge.openPageImageCount(id), 0, "nach unload darf nichts offen bleiben");
});

test("zwei Dokumente halten ihre URLs auseinander", async () => {
  const a = await freshHandle();
  const b = await freshHandle();
  await bridge.renderPageToUrl(a, 1, 1);
  await bridge.renderPageToUrl(b, 1, 1);
  await bridge.renderPageToUrl(b, 2, 1);

  assert.equal(bridge.openPageImageCount(a), 1);
  assert.equal(bridge.openPageImageCount(b), 2);

  await bridge.unload(a);
  assert.equal(bridge.openPageImageCount(a), 0);
  assert.equal(bridge.openPageImageCount(b), 2, "das andere Dokument darf nichts verlieren");

  await bridge.unload(b);
});

// --- Der eigentliche Fehler, den der alte Code hatte -------------------------

test("ein Fenster über ein grosses Dokument lässt nicht alles stehen", async () => {
  const id = await freshHandle();
  const BUFFER = 2;            // wie in ReaderPane.ContinuousBuffer
  const PAGES = 50;
  const held = new Map();

  // Durchscrollen: Seite für Seite das Fenster verschieben, wie es der
  // IntersectionObserver meldet.
  for (let current = 1; current <= PAGES; current++) {
    const from = Math.max(1, current - BUFFER);
    const to = Math.min(PAGES, current + BUFFER);

    for (const [p, img] of Array.from(held)) {
      if (p < from || p > to) {
        bridge.releasePageImage(img.url);
        held.delete(p);
      }
    }
    for (let p = from; p <= to; p++) {
      if (!held.has(p)) held.set(p, await bridge.renderPageToUrl(id, p, 1.5));
    }

    assert.ok(held.size <= 2 * BUFFER + 1,
      `Fenster zu gross bei Seite ${current}: ${held.size}`);
  }

  // Das ist die Zahl, um die es geht: der alte Code hätte hier 50 Bilder
  // gehalten — alle Seiten, bis zum Dateiwechsel.
  assert.equal(bridge.openPageImageCount(id), held.size);
  assert.ok(bridge.openPageImageCount(id) <= 5,
    `nach dem Durchscrollen sind ${bridge.openPageImageCount(id)} Bilder offen, erlaubt sind 5`);

  await bridge.unload(id);
  assert.equal(bridge.openPageImageCount(id), 0);
});

test("am Ende ist nichts offen geblieben", () => {
  assert.equal(bridge.openPageImageCount(), 0, `offen: ${bridge.openPageImageCount()}`);
  assert.equal(live.size, 0, `nicht widerrufene Blob-URLs: ${Array.from(live).join(", ")}`);
  assert.equal(created, revoked, `${created} erzeugt, ${revoked} widerrufen`);
});
