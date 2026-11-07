// =============================================================================
// wwwroot/js/boot.js — der Eintritt für Dateien (docs/contracts/datei-eintritt.md).
//
// boot.js ist die einzige Stelle, die `launchQueue` entgegennimmt und Dateien
// prüft. Genau das lässt sich im Browser kaum gezielt herbeiführen: ein
// Dateihandler-Start, eine Freigabe über das Teilen-Menü und das Wettrennen
// zwischen der Abholung und dem Mount der Blazor-Seite. Hier läuft boot.js
// deshalb in einem vm-Kontext mit nachgebauten Browser-Teilen.
//
// Der Kern dieser Prüfungen: offer() bleibt der einzige Prüfpunkt, eine Datei
// geht nicht verloren, wenn die Seite vor der Abholung fragt, und nichts landet
// in einem Parkplatz, aus dem es niemand abholt.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const wwwroot = join(webRoot, "wwwroot");
const jsDir = join(wwwroot, "js");
const source = readFileSync(join(jsDir, "boot.js"), "utf8");

const PDF = "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n";
const DESIGN = JSON.stringify({ version: 1, elements: [] });

/**
 * Lädt boot.js mit nur den Browser-Teilen, die es anfasst.
 * `shared`: Einträge, die der Service Worker im Parkplatz hinterlassen hat.
 * `path` / `search`: die Route, unter der die App startet.
 */
function loadBoot({ shared = [], path = "/", search = "", lang = "de" } = {}) {
  const stores = new Map();
  if (shared.length) {
    const store = new Map();
    shared.forEach((s, i) => {
      const headers = new Headers();
      if (s.name !== undefined) headers.set("X-Pagebound-Filename", encodeURIComponent(s.name));
      store.set(`/__pb-share/${s.key ?? i + 1}`, new Response(s.body, { headers }));
    });
    stores.set("pb-share", store);
  }
  const status = []; // was die Drop-Zone gemeldet hat
  const routed = []; // Aufrufe von history.replaceState
  let consumer = null;

  const sub = {
    textContent: "",
    classList: { toggle: () => {} },
  };

  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    URL, Response, Headers, Blob, File, Promise, Uint8Array, JSON,
    parseFloat, parseInt, String, Math, Array, Number,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    caches: {
      async has(name) { return stores.has(name); },
      async open(name) {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name);
        return {
          async match(k) { return store.get(String(k)); },
          async delete(k) { return store.delete(String(k)); },
          async put(k, v) { store.set(String(k), v); },
          async keys() { return [...store.keys()].map((k) => ({ url: new URL(k, "https://example.test").href })); },
        };
      },
    },
    navigator: { language: lang },
    location: { pathname: path, search },
    history: { replaceState: (_s, _t, url) => routed.push(url) },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "0" }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  // Nur das Statusfeld existiert. Damit bleibt die Drop-Zone (pb-boot-drop)
  // null, boot.js ruft wire() nicht auf — und die Meldungen sind trotzdem
  // lesbar, statt im Nichts zu verschwinden.
  ctx.document = {
    documentElement: { getAttribute: (a) => (a === "lang" ? lang : null) },
    getElementById: (id) => (id === "pb-boot-drop-sub" ? sub : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  ctx.addEventListener = () => {};
  ctx.launchQueue = { setConsumer: (fn) => { consumer = fn; } };
  Object.defineProperty(sub, "textContent", {
    get: () => status[status.length - 1] ?? "",
    set: (v) => { status.push(v); },
  });

  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "boot.js" });

  return {
    boot: ctx.window.pageboundBoot,
    status,
    routed,
    shareStore: () => stores.get("pb-share"),
    /** Feuert den launchQueue-Empfänger, wie der Browser es beim Start tut. */
    launch(...files) {
      assert.ok(consumer, "boot.js hat keinen launchQueue-Empfänger gesetzt");
      consumer({ files: files.map((f) => ({ getFile: async () => f })) });
    },
  };
}

const pdfFile = (name = "echt.pdf") => new File([PDF], name, { type: "application/pdf" });

// --- offer(): der einzige Prüfpunkt -----------------------------------------

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
  assert.equal(await boot.offer(new File([PDF], "bild.png", { type: "image/png" })), false);
});

test("offer lehnt über 100 MB ab", async () => {
  const { boot } = loadBoot();
  // Nicht wirklich 100 MB belegen: boot.js liest file.size.
  assert.equal(await boot.offer({ name: "dick.pdf", type: "application/pdf", size: 100 * 1024 * 1024 + 1 }), false);
});

// --- Freigabe (share_target) ------------------------------------------------

test("Freigabe: die geparkte Datei ist da, auch wenn sofort gefragt wird", async () => {
  // Das Wettrennen aus Nachtrag 1: ReaderPage fragt zuerst pendingFileName()
  // und bricht bei leerem Namen ab. Die Abholung aus pb-share ist asynchron —
  // ein synchroner Getter hätte hier null geliefert und die Datei verworfen.
  const { boot } = loadBoot({ shared: [{ name: "Prüfung, geteilt.pdf", body: PDF }], path: "/reader" });
  assert.equal(await boot.pendingFileName(), "Prüfung, geteilt.pdf", "die geteilte Datei wurde zu früh abgefragt");
  assert.ok((await boot.takePendingFile()).length > 0);
});

test("Freigabe: der Parkplatz ist danach wirklich leer", async () => {
  // Am Speicher geprüft, nicht am Quelltext: eine abgelehnte Datei darf nicht
  // bei jedem Start erneut auftauchen.
  const { boot, shareStore } = loadBoot({ shared: [{ name: "einmal.pdf", body: PDF }], path: "/reader" });
  await boot.pendingFileName();
  assert.equal(shareStore().size, 0, "der Eintrag liegt noch im Parkplatz");
});

test("Freigabe: auch eine abgelehnte Datei wird aus dem Parkplatz entfernt", async () => {
  const { boot, shareStore } = loadBoot({ shared: [{ name: "kaputt.pdf", body: "kein PDF" }], path: "/reader" });
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(shareStore().size, 0, "die abgelehnte Datei käme beim nächsten Start wieder");
});

test("Freigabe: zwei Einträge werden beide abgearbeitet, der erste gewinnt", async () => {
  const { boot, shareStore, status } = loadBoot({
    shared: [{ name: "eins.pdf", body: PDF }, { name: "zwei.pdf", body: PDF }],
    path: "/reader",
  });
  assert.equal(await boot.pendingFileName(), "eins.pdf");
  assert.equal(shareStore().size, 0, "ein Eintrag blieb liegen");
  assert.ok(status.some((s) => /erste|first/i.test(s)), "die zweite Datei wurde stillschweigend verworfen");
});

test("Freigabe ohne Dateinamen-Header: Ersatzname statt Absturz", async () => {
  const { boot } = loadBoot({ shared: [{ name: undefined, body: PDF }], path: "/reader" });
  assert.equal(await boot.pendingFileName(), "geteilt.pdf");
});

test("Freigabe: ein JSON wird NICHT als Entwurf geparkt", async () => {
  // Sonst liegt es im Design-Parkplatz, der Reader fragt nur nach einer PDF und
  // bekommt nichts — und beim nächsten Wechsel in den Designer ersetzt es
  // dessen Dokument, ohne dass der Nutzer in diesem Moment etwas gewählt hat.
  const { boot } = loadBoot({ shared: [{ name: "daten.pdf", body: DESIGN }], path: "/reader" });
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(await boot.takePendingDesign(), null, "ein geteiltes JSON landete im Design-Parkplatz");
});

test("Freigabe: ?share=failed wird gemeldet", async () => {
  // Ohne Meldung käme der Reader leer hoch und die Freigabe sähe auf Android
  // einfach kaputt aus.
  const { status } = loadBoot({ path: "/reader", search: "?share=failed" });
  assert.ok(status.some((s) => /nicht übernommen|could not be taken/i.test(s)), `Meldungen: ${status.join(" | ")}`);
});

// --- Dateihandler (file_handlers) -------------------------------------------

test("Dateihandler: eine PDF landet im PDF-Parkplatz", async () => {
  const { boot } = loadBoot({ path: "/reader" });
  await boot.offer(pdfFile("vorher.pdf")); // belegt den Parkplatz nicht doppelt
  assert.equal(await boot.pendingFileName(), "vorher.pdf");
});

test("Dateihandler: eine gestartete PDF wird angenommen", async () => {
  const { boot, launch } = loadBoot({ path: "/reader" });
  launch(pdfFile("gestartet.pdf"));
  assert.equal(await boot.pendingFileName(), "gestartet.pdf");
  assert.equal(await boot.takePendingDesign(), null, "eine PDF landete im Design-Parkplatz");
});

test("Dateihandler: ein Entwurf landet im Design-Parkplatz — auf /editor", async () => {
  const { boot, launch } = loadBoot({ path: "/editor" });
  launch(new File([DESIGN], "karte.pbdesign.json", { type: "application/json" }));
  assert.equal(await boot.takePendingDesign(), DESIGN);
  assert.equal(await boot.pendingFileName(), null, "ein Entwurf landete im PDF-Parkplatz");
  assert.equal(await boot.takePendingDesign(), null, "der Entwurf war nicht einmalig");
});

test("Dateihandler: ein Entwurf auf /reader wird abgewiesen", async () => {
  const { boot, launch } = loadBoot({ path: "/reader" });
  launch(new File([DESIGN], "verwechselt.pdf", { type: "application/pdf" }));
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(await boot.takePendingDesign(), null, "geparkt, obwohl niemand ihn abholt");
});

test("Dateihandler: eine PDF mit .json-Endung wird nach Inhalt erkannt", async () => {
  const { boot, launch } = loadBoot({ path: "/editor" });
  launch(new File([PDF], "verwechselt.pbdesign.json", { type: "application/json" }));
  assert.equal(await boot.pendingFileName(), "verwechselt.pbdesign.json");
  assert.equal(await boot.takePendingDesign(), null);
});

test("Dateihandler: eine gestartete PDF stellt die Route auf /reader", async () => {
  // accept() schreibt die Route um, damit Blazor im Reader startet. Ohne das
  // öffnet sich die Datei nicht, obwohl sie geparkt ist.
  const { boot, launch, routed } = loadBoot({ path: "/editor" });
  launch(pdfFile("von-woanders.pdf"));
  assert.equal(await boot.pendingFileName(), "von-woanders.pdf");
  assert.deepEqual(routed, ["/reader"], `Routenwechsel: ${JSON.stringify(routed)}`);
});

test("Dateihandler: unbrauchbarer Inhalt wird verworfen", async () => {
  const { boot, launch } = loadBoot({ path: "/editor" });
  launch(new File(["weder PDF noch JSON"], "muell.bin", { type: "" }));
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(await boot.takePendingDesign(), null);
});

test("Dateihandler: JSON, das kein Objekt ist, wird verworfen", async () => {
  // `1`, `[]` und `null` sind gültiges JSON, aber keine Entwürfe. Ohne diese
  // Prüfung wandern sie als zweite Kopie nach .NET, nur um dort zu scheitern.
  for (const roh of ["1", "[]", "null", '"text"']) {
    const { boot, launch } = loadBoot({ path: "/editor" });
    launch(new File([roh], "komisch.pbdesign.json", { type: "application/json" }));
    assert.equal(await boot.takePendingDesign(), null, `${roh} wurde als Entwurf geparkt`);
  }
});

test("Dateihandler: ein zu großer Entwurf wird vor dem Lesen abgewiesen", async () => {
  // Der Inhalt wird als String gelesen und als zweite Kopie nach .NET gereicht.
  // Die 100-MB-Grenze der PDFs ist dafür der kürzeste Weg in einen
  // WASM-Speicherfehler.
  const { boot, launch } = loadBoot({ path: "/editor" });
  let gelesen = false;
  launch({
    name: "riesig.pbdesign.json",
    type: "application/json",
    size: 6 * 1024 * 1024,
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
    text: async () => { gelesen = true; return "{}"; },
  });
  assert.equal(await boot.takePendingDesign(), null);
  assert.equal(gelesen, false, "die Datei wurde trotz Übergröße gelesen");
});

test("Dateihandler: mehrere Dateien werden gemeldet, nicht verschwiegen", async () => {
  const { boot, launch, status } = loadBoot({ path: "/reader" });
  launch(pdfFile("eins.pdf"), pdfFile("zwei.pdf"));
  assert.equal(await boot.pendingFileName(), "eins.pdf");
  assert.ok(status.some((s) => /erste|first/i.test(s)), `Meldungen: ${status.join(" | ")}`);
});

// --- Die Zuständigkeit selbst ----------------------------------------------

test("es gibt genau einen launchQueue-Empfänger, und zwar in boot.js", () => {
  // launchQueue.setConsumer ersetzt den vorherigen Empfänger. Zwei Aufrufe
  // irgendwo im ausgelieferten JS heißt: welcher gewinnt, entscheidet die
  // Ladereihenfolge. Gezählt wird im GEBAUTEN Baum, nicht in den .ts-Quellen —
  // ausgeliefert wird das Gebaute.
  const gebaut = join(jsDir, "wysiwyg-editor.js");
  assert.ok(
    existsSync(gebaut),
    "wysiwyg-editor.js fehlt — ohne `npm run build:js` prüft dieser Test nichts (CI baut vorher)",
  );

  const treffer = [];
  // Rekursiv: esbuild kann Teile in Unterordner legen, und ein Empfänger
  // irgendwo sonst unter wwwroot zählt genauso.
  (function scan(dir) {
    for (const name of readdirSync(dir)) {
      if (["_framework", "_content", "tessdata", "tesseract"].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { scan(full); continue; }
      if (!/\.m?js$/.test(name)) continue; // keine .map, keine .ts
      const text = readFileSync(full, "utf8");
      for (const _ of text.matchAll(/\.setConsumer\s*\(/g)) treffer.push(name);
    }
  })(wwwroot);

  assert.deepEqual(treffer, ["boot.js"], `setConsumer-Aufrufe: ${treffer.join(", ") || "keiner"}`);
});
