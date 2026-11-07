// =============================================================================
// Bridge-Test: liefert `loadPdf` die Sprache des Dokuments (Nachtrag 4.4)?
//
// Prüfsignal, und der Grund für den Aufwand: ein Stub für pdfjs würde hier
// NICHTS beweisen. Die eigentliche Unsicherheit ist, unter welchem Namen PDF.js
// `/Lang` aus dem Katalog herausgibt — ein selbst gebauter Stub, der
// `info.Language` setzt, prüft nur, dass die Brücke dasselbe Feld liest, das der
// Test hineingeschrieben hat. Deshalb läuft hier das ECHTE PDF.js über ein
// ECHTES PDF, in das `/Lang` eingetragen wurde.
//
// Ausführen: npm test (in src/Pagebound.Web).
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const require = createRequire(join(webRoot, "package.json"));

const outDir = mkdtempSync(join(tmpdir(), "pb-bridge-"));
process.on("exit", () => rmSync(outDir, { recursive: true, force: true }));

// PDF.js (Legacy-Build) will beim Import DOMMatrix/Path2D sehen. Hier wird nur
// gelesen (Metadaten), nicht gerendert — ein minimaler Ersatz genügt.
globalThis.DOMMatrix ??= class DOMMatrix {
  constructor() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); }
};
globalThis.Path2D ??= class Path2D {};

// Die Brücke gegen den Legacy-Build bündeln: derselbe Code, nur die
// Node-taugliche Fassung von pdfjs. `renderPage` braucht ein Canvas und wird
// hier nicht aufgerufen.
//
// Der Umweg über eine Hülle: die Brücke setzt `GlobalWorkerOptions.workerSrc`
// auf den Pfad des Browser-Shims ("/js/…"), den Node als "C:\js\…" auflöst und
// nicht findet. Die Hülle gibt dieselbe pdfjs-Instanz aus dem Bündel heraus,
// sodass der Test den Pfad auf die Node-Fassung umstellen kann — ohne dass der
// Produktionscode etwas für den Test exportieren muss.
const vorwaerts = (p) => resolve(p).replace(/\\/g, "/");
const pdfjsNode = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const huelle = join(outDir, "huelle.mjs");
writeFileSync(
  huelle,
  `export * from "${vorwaerts(resolve(webRoot, "wwwroot/js/pdfjs-bridge.ts"))}";\n` +
    `export { GlobalWorkerOptions } from "${vorwaerts(pdfjsNode)}";\n`,
  "utf8",
);

const outfile = join(outDir, "bridge.mjs");
await build({
  entryPoints: [huelle],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "pdfjs-dist": pdfjsNode },
});
const bridge = await import(pathToFileURL(outfile).href);
// Node-Fassung des Workers statt des Browser-Shims.
bridge.GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
).href;
const { PDFDocument, PDFName, PDFString } = await import(pathToFileURL(require.resolve("pdf-lib")).href);

/** Ein einseitiges PDF; `lang` landet als `/Lang` im Katalog. */
async function pdfMitSprache(lang) {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  if (lang !== null) doc.catalog.set(PDFName.of("Lang"), PDFString.of(lang));
  return new Uint8Array(await doc.save());
}

test("loadPdf liefert /Lang als language", async () => {
  // Der Kern: PDF.js muss die Katalog-Angabe überhaupt herausgeben, und zwar
  // unter dem Namen, den die Brücke liest. Geht PDF.js in einer neuen Fassung
  // dazu über, das Feld anders zu nennen, wird DIESER Test rot — und nicht erst
  // ein Nutzer, dessen englisches PDF deutsch vorgelesen wird.
  const res = await bridge.loadPdf(await pdfMitSprache("en-GB"), null);
  assert.equal(res.language, "en-GB", `Sprache nicht durchgereicht: ${JSON.stringify(res)}`);
  assert.equal(res.pageCount, 1);
});

test("ohne /Lang ist language null, nicht ein leerer String", async () => {
  // null heißt „unbekannt", und nur dann darf das Vorlesen auf die Vorgabe der
  // Plattform zurückfallen. Ein leerer String wäre ein Hinweis, der nichts
  // aussagt, und `u.lang = ""` eine Angabe an die Engine, die nichts bedeutet.
  const res = await bridge.loadPdf(await pdfMitSprache(null), null);
  assert.equal(res.language, null, `erwartet null, bekam ${JSON.stringify(res.language)}`);
});

test("ein leeres /Lang () zählt nicht als Sprache", async () => {
  // `/Lang ()` kommt in echten PDFs vor. Ohne die Prüfung auf Leerstring würde
  // das Vorlesen eine Stimme suchen, die zu "" passt, und die erste lokale
  // nehmen — statt die Vorgabe der Plattform zu lassen.
  const res = await bridge.loadPdf(await pdfMitSprache("   "), null);
  assert.equal(res.language, null, `Leerraum wurde als Sprache genommen: ${JSON.stringify(res.language)}`);
});
