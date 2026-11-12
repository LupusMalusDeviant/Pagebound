// =============================================================================
// Herunterladen ohne base64 — Codex-Review 2026-11-12, Befund 3
//
// Was hier geprüft wird: dass `downloadStream` die Bytes aus einer
// DotNetStreamReference nimmt und als Blob weiterreicht — ohne irgendwo eine
// base64-Zeichenkette zu bilden. Der Befund war, dass der neue
// /Annots-Export mit `Convert.ToBase64String` lief: bei 100 MB Ausgabe rund
// 267 MB zusätzlicher Speicher (ein Drittel Aufschlag durch base64, dann als
// .NET-string in UTF-16 nochmal doppelt) neben Original, Ergebnis und
// JS-Kopie. Genau der base64-Round-Trip, den die Leitplanken dieses Projekts
// für grosse PDFs verbieten.
//
// Das Prüfsignal gegen den Fehler: die Bytes, die am Blob ankommen, müssen
// die ORIGINALBYTES sein, und `atob` darf gar nicht erst gerufen werden. Eine
// Prüfung, die nur „Download ausgelöst" fragt, hätte den alten Weg genauso
// bestanden.
//
// Was hier NICHT geprüft wird: der tatsächliche Speicherverbrauch im Browser.
// Dafür bräuchte es eine Messung in einem echten WASM-Lauf; die bleibt offen.
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
const outDir = mkdtempSync(join(tmpdir(), "pb-dlstream-"));
process.on("exit", () => rmSync(outDir, { recursive: true, force: true }));

// --- die Browser-Teile, die die Brücke anfasst -------------------------------

let atobCalls = 0;
globalThis.atob = () => { atobCalls++; return ""; };

const blobs = [];
globalThis.Blob = class {
  constructor(parts, opts) {
    this.parts = parts;
    this.type = opts?.type;
    blobs.push(this);
  }
};

let created = 0;
const live = new Set();
let revoked = 0;
globalThis.URL = {
  createObjectURL: () => { const u = `blob:pb/${++created}`; live.add(u); return u; },
  revokeObjectURL: (u) => { if (live.delete(u)) revoked++; },
};

const clicked = [];
const appended = [];
globalThis.document = {
  createElement: () => {
    const el = { href: "", download: "", click() { clicked.push({ href: el.href, download: el.download }); } };
    return el;
  },
  body: {
    appendChild: (el) => appended.push(el),
    removeChild: (el) => { const i = appended.indexOf(el); if (i >= 0) appended.splice(i, 1); },
  },
};

const outfile = join(outDir, "shortcuts.mjs");
await build({
  entryPoints: [resolve(webRoot, "wwwroot/js/shortcuts-bridge.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
});
const bridge = await import(pathToFileURL(outfile).href);

/** Was Blazor einer JS-Funktion für eine DotNetStreamReference übergibt. */
function streamRefOf(bytes) {
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

// --- die Prüfungen -----------------------------------------------------------

test("downloadStream reicht die Originalbytes durch, ohne base64", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0xff, 0x00]);
  const atobBefore = atobCalls;
  const blobsBefore = blobs.length;

  await bridge.downloadStream("test.annotiert.pdf", streamRefOf(bytes), "application/pdf");

  assert.equal(atobCalls, atobBefore, "atob wurde gerufen — da ist wieder base64 im Weg");
  assert.equal(blobs.length, blobsBefore + 1, "kein Blob erzeugt");

  const blob = blobs[blobs.length - 1];
  assert.equal(blob.type, "application/pdf");
  const got = new Uint8Array(blob.parts[0]);
  assert.deepEqual([...got], [...bytes], "die Bytes am Blob sind nicht die Originalbytes");
});

test("downloadStream löst den Download mit dem gewünschten Namen aus", async () => {
  const before = clicked.length;
  await bridge.downloadStream("Bericht Q4.annotiert.pdf", streamRefOf(new Uint8Array([1, 2, 3])), "application/pdf");

  assert.equal(clicked.length, before + 1);
  assert.equal(clicked[clicked.length - 1].download, "Bericht Q4.annotiert.pdf");
  assert.ok(clicked[clicked.length - 1].href.startsWith("blob:"));
});

test("downloadStream hängt das Element wieder ab und widerruft die URL", async () => {
  await bridge.downloadStream("x.pdf", streamRefOf(new Uint8Array([9])), "application/pdf");

  assert.equal(appended.length, 0, "das <a> blieb im Dokument stehen");

  const url = clicked[clicked.length - 1].href;
  assert.ok(live.has(url), "die URL war schon vor dem Klick widerrufen");

  // Der Widerruf läuft bewusst verzögert: manche Browser brauchen die URL
  // noch, während der Download anläuft. Eine Blob-URL ist eine Ressource —
  // nicht widerrufen heisst geleckt. Geprüft wird GENAU DIESE URL, nicht der
  // Gesamtzähler: die Zeitgeber der anderen Prüfungen laufen mit.
  await new Promise((r) => setTimeout(r, 1100));
  assert.ok(!live.has(url), "die Blob-URL wurde nicht widerrufen");
});
