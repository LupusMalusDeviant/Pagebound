// =============================================================================
// wwwroot/js/boot.js — der Eintritt für Dateien (docs/contracts/datei-eintritt.md).
//
// boot.js ist die einzige Stelle, die `launchQueue` entgegennimmt und Dateien
// prüft. Genau das lässt sich im Browser kaum gezielt herbeiführen: ein
// Dateihandler-Start, eine Freigabe über das Teilen-Menü und das Wettrennen
// zwischen der Abholung und dem Mount der Blazor-Seite. Hier läuft boot.js
// deshalb in einem vm-Kontext mit nachgebauten Browser-Teilen.
//
// Der Kern dieser Prüfungen: offer() bleibt der einzige Prüfpunkt, und eine
// Datei geht nicht verloren, wenn die Seite vor der Abholung fragt.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const jsDir = join(webRoot, "wwwroot", "js");
const source = readFileSync(join(jsDir, "boot.js"), "utf8");

const PDF = "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n";

/** Nur die Browser-Teile, die boot.js wirklich anfasst. */
function loadBoot({ shared = null, lang = "de" } = {}) {
  const stores = new Map();
  if (shared) {
    const headers = new Headers();
    if (shared.name !== undefined) headers.set("X-Pagebound-Filename", encodeURIComponent(shared.name));
    stores.set("pb-share", new Map([["/__pb-share", new Response(shared.body, { headers })]]));
  }
  const status = []; // was die Drop-Zone gemeldet hätte
  let consumer = null;

  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    URL, Response, Headers, Blob, File, Promise, Uint8Array, JSON, parseFloat, String, Math,
    caches: {
      async has(name) { return stores.has(name); },
      async open(name) {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name);
        return {
          async match(k) { return store.get(String(k)); },
          async delete(k) { return store.delete(String(k)); },
          async put(k, v) { store.set(String(k), v); },
        };
      },
    },
    navigator: { language: lang },
    location: { pathname: "/" },
    history: { replaceState() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "0" }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  // Kein Boot-Markup: getElementById liefert null, boot.js wartet dann auf
  // DOMContentLoaded — die Drop-Zone ist für diese Prüfungen nicht nötig.
  ctx.document = {
    documentElement: { getAttribute: (a) => (a === "lang" ? lang : null) },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  ctx.addEventListener = () => {};
  ctx.launchQueue = { setConsumer: (fn) => { consumer = fn; } };

  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "boot.js" });

  return {
    boot: ctx.window.pageboundBoot,
    status,
    /** Feuert den launchQueue-Empfänger, wie der Browser es beim Start tut. */
    launch(file) {
      assert.ok(consumer, "boot.js hat keinen launchQueue-Empfänger gesetzt");
      consumer({ files: [{ getFile: async () => file }] });
    },
  };
}

const pdfFile = (name = "echt.pdf") => new File([PDF], name, { type: "application/pdf" });

test("offer nimmt eine echte PDF an", async () => {
  const { boot } = loadBoot();
  assert.equal(await boot.offer(pdfFile("bericht.pdf")), true);
  assert.equal(await boot.pendingFileName(), "bericht.pdf");
  const bytes = await boot.takePendingFile();
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
  assert.equal(await boot.pendingFileName(), null, "die Datei war nicht einmalig");
});

test("offer lehnt eine Datei ab, die nur .pdf heißt", async () => {
  // Der eigentliche Prüfpunkt: Endung und MIME-Typ sagen PDF, der Inhalt nicht.
  const { boot } = loadBoot();
  const getarnt = new File(["das ist in Wahrheit Text"], "rechnung.pdf", { type: "application/pdf" });
  assert.equal(await boot.offer(getarnt), false);
  assert.equal(await boot.pendingFileName(), null);
});

test("offer lehnt einen fremden MIME-Typ ab", async () => {
  const { boot } = loadBoot();
  const bild = new File([PDF], "bild.png", { type: "image/png" });
  assert.equal(await boot.offer(bild), false);
});

test("offer lehnt über 100 MB ab", async () => {
  const { boot } = loadBoot();
  // Nicht wirklich 100 MB belegen: boot.js liest file.size.
  const dick = { name: "dick.pdf", type: "application/pdf", size: 100 * 1024 * 1024 + 1 };
  assert.equal(await boot.offer(dick), false);
});

test("Freigabe: die geparkte Datei ist da, auch wenn sofort gefragt wird", async () => {
  // Das Wettrennen aus Nachtrag 1: ReaderPage fragt zuerst pendingFileName()
  // und bricht bei leerem Namen ab. Die Abholung aus pb-share ist asynchron —
  // ein synchroner Getter hätte hier null geliefert und die Datei verworfen.
  const { boot } = loadBoot({ shared: { name: "Prüfung, geteilt.pdf", body: PDF } });
  const name = await boot.pendingFileName();
  assert.equal(name, "Prüfung, geteilt.pdf", "die geteilte Datei wurde zu früh abgefragt");
  assert.ok((await boot.takePendingFile()).length > 0);
});

test("Freigabe: der Parkplatz ist danach leer", async () => {
  const { boot } = loadBoot({ shared: { name: "einmal.pdf", body: PDF } });
  await boot.pendingFileName();
  // Zweites Laden mit demselben (jetzt geleerten) Speicher ist hier nicht
  // nachstellbar; geprüft wird, dass boot.js den Eintrag löscht, bevor es ihn
  // verarbeitet — sonst käme eine abgelehnte Datei bei jedem Start wieder.
  assert.match(source, /cache\.delete\(SHARE_ENTRY\)\.then/);
});

test("Freigabe ohne Dateinamen-Header: Ersatzname statt Absturz", async () => {
  const { boot } = loadBoot({ shared: { name: undefined, body: PDF } });
  assert.equal(await boot.pendingFileName(), "geteilt.pdf");
});

test("Dateihandler: eine PDF landet im PDF-Parkplatz", async () => {
  const { boot, launch } = loadBoot();
  launch(pdfFile("gestartet.pdf"));
  assert.equal(await boot.pendingFileName(), "gestartet.pdf");
  assert.equal(await boot.takePendingDesign(), null, "eine PDF landete im Design-Parkplatz");
});

test("Dateihandler: ein Entwurf landet im Design-Parkplatz", async () => {
  const { boot, launch } = loadBoot();
  const design = JSON.stringify({ version: 1, elements: [] });
  launch(new File([design], "karte.pbdesign.json", { type: "application/json" }));
  assert.equal(await boot.takePendingDesign(), design);
  assert.equal(await boot.pendingFileName(), null, "ein Entwurf landete im PDF-Parkplatz");
  assert.equal(await boot.takePendingDesign(), null, "der Entwurf war nicht einmalig");
});

test("Dateihandler: sortiert nach Inhalt, nicht nach Endung", async () => {
  // Eine Design-Datei, die .pdf heißt, darf nicht in den Reader; und eine PDF
  // mit .json nicht in den Designer. Sonst entscheidet die Endung über das
  // Werkzeug, und ein falsch benannter Anhang landet am falschen Ort.
  const { boot, launch } = loadBoot();
  const design = JSON.stringify({ version: 1 });
  launch(new File([design], "verwechselt.pdf", { type: "application/pdf" }));
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(await boot.takePendingDesign(), design);

  const zweite = loadBoot();
  zweite.launch(new File([PDF], "verwechselt.pbdesign.json", { type: "application/json" }));
  assert.equal(await zweite.boot.pendingFileName(), "verwechselt.pbdesign.json");
  assert.equal(await zweite.boot.takePendingDesign(), null);
});

test("Dateihandler: unbrauchbarer Inhalt wird verworfen", async () => {
  const { boot, launch } = loadBoot();
  launch(new File(["weder PDF noch JSON"], "muell.bin", { type: "" }));
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(await boot.takePendingDesign(), null);
});

test("es gibt genau einen launchQueue-Empfänger, und zwar in boot.js", () => {
  // launchQueue.setConsumer ersetzt den vorherigen Empfänger. Zwei Aufrufe
  // irgendwo im ausgelieferten JS heißt: welcher gewinnt, entscheidet die
  // Ladereihenfolge. Gezählt wird im GEBAUTEN js-Verzeichnis, nicht in den
  // .ts-Quellen — ausgeliefert wird das Gebaute.
  const treffer = [];
  for (const name of readdirSync(jsDir)) {
    if (!name.endsWith(".js") && !name.endsWith(".mjs")) continue; // keine .map, keine .ts
    const text = readFileSync(join(jsDir, name), "utf8");
    for (const _ of text.matchAll(/\.setConsumer\s*\(/g)) treffer.push(name);
  }
  assert.deepEqual(treffer, ["boot.js"], `setConsumer-Aufrufe: ${treffer.join(", ") || "keiner"}`);
});
