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
/** Ein Element mit genau dem, was boot.js daran anfasst. */
function fakeEl(onText) {
  const klassen = new Set();
  const e = {
    hidden: true,
    classList: {
      add: (c) => klassen.add(c),
      remove: (c) => klassen.delete(c),
      contains: (c) => klassen.has(c),
      toggle: (c, on) => (on ? klassen.add(c) : klassen.delete(c)),
    },
    setAttribute: () => {},
    addEventListener: () => {},
    files: null,
    _klassen: klassen,
  };
  let text = "";
  Object.defineProperty(e, "textContent", {
    get: () => text,
    set: (v) => { text = v; if (onText) onText(v); },
  });
  return e;
}

/**
 * `withZone` (Vorgabe) baut das Boot-Markup nach, sodass boot.js wire()
 * synchron aufruft — wie im Browser, wo das Markup in index.html VOR dem
 * Skript steht. Ohne das meidet der Test genau den Pfad, der eine Meldung
 * überschreiben kann.
 */
function loadBoot({ shared = [], path = "/", search = "", hash = "", lang = "de", withZone = true } = {}) {
  const stores = new Map();
  if (shared.length) {
    const store = new Map();
    shared.forEach((s, i) => {
      const headers = new Headers();
      if (s.name !== undefined) headers.set("X-Pagebound-Filename", encodeURIComponent(s.name));
      // rawKey: ein Schlüssel ohne Nummer — der feste `/__pb-share` aus dem
      // Ursprungsstand. Er muss aufgeräumt werden, nicht geöffnet.
      store.set(s.rawKey ?? `/__pb-share/${s.key ?? i + 1}`, new Response(s.body, { headers }));
    });
    stores.set("pb-share", store);
  }
  const status = []; // was die Drop-Zone gemeldet hat, in der Reihenfolge
  const routed = []; // Aufrufe von history.replaceState
  let consumer = null;

  const sub = fakeEl((v) => status.push(v));
  const elemente = { "pb-boot-drop-sub": sub };
  if (withZone) {
    for (const id of ["pb-boot", "pb-boot-drop", "pb-boot-file", "pb-boot-drop-title", "pb-boot-status", "pb-boot-progress"]) {
      elemente[id] = fakeEl();
    }
  }

  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    URL, URLSearchParams, Response, Headers, Blob, File, Promise, Uint8Array, JSON,
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
    location: { pathname: path, search, hash },
    // replaceState ändert im Browser auch `location` — ohne das sieht eine
    // Prüfung auf location.pathname nach einem Routenwechsel noch die alte
    // Route, und ein Test dazu kann nicht rot werden.
    history: {
      replaceState: (_s, _t, url) => {
        routed.push(url);
        const u = new URL(url, "https://pruefstand.test");
        ctx.location.pathname = u.pathname;
        ctx.location.search = u.search;
        ctx.location.hash = u.hash;
      },
    },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "0" }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.document = {
    documentElement: { getAttribute: (a) => (a === "lang" ? lang : null) },
    getElementById: (id) => elemente[id] ?? null,
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
    routed,
    sub,
    shareStore: () => stores.get("pb-share"),
    /** Feuert den launchQueue-Empfänger, wie der Browser es beim Start tut. */
    launch(...files) {
      assert.ok(consumer, "boot.js hat keinen launchQueue-Empfänger gesetzt");
      consumer({ files: files.map((f) => ({ getFile: async () => f })) });
    },
  };
}

const pdfFile = (name = "echt.pdf") => new File([PDF], name, { type: "application/pdf" });

/**
 * Eine Datei, deren Lesen als MIKROTASK auflöst.
 *
 * Ein echtes `File` taugt für Wettlauf-Tests nicht: `slice().arrayBuffer()`
 * liest einen Stream und wird erst in einem späteren Makrotask fertig. Zwei
 * gleichzeitige Abläufe verschränken sich dadurch gar nicht — der erste ist
 * komplett durch, bevor der zweite seine Bytes hat. Ein Test mit echten Dateien
 * bleibt deshalb grün, auch wenn man die Reihung entfernt. Im Browser, wo die
 * Bytes längst im Speicher liegen, verschränken sie sich.
 */
function fakeFile(body, name, { type = "application/pdf", slowText = false } = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    name,
    type,
    size: bytes.length,
    slice: () => ({ arrayBuffer: async () => bytes.buffer.slice(0, Math.min(1024, bytes.length)) }),
    text: async () => body,
  };
}

/**
 * Wie fakeFile, aber das Lesen des Inhalts hält an, bis der Test es freigibt.
 *
 * Damit ist das Fenster beweisbar statt erhofft: `gelesen` löst auf, sobald
 * boot.js `text()` aufgerufen hat — also NACH dem ersten `designWanted()`. Was
 * der Test dann tut, liegt garantiert zwischen den beiden Routenprüfungen. Ein
 * `setTimeout(0)` würde das nicht leisten: wann welcher Ablauf wie viele Ticks
 * braucht, hängt an Umsetzungsdetails, und der Test wäre entweder zahnlos oder
 * launisch.
 */
function haltendeDatei(body, name, type) {
  let weiter;
  let melden;
  const gelesen = new Promise((r) => { melden = r; });
  const datei = fakeFile(body, name, { type });
  datei.text = () => {
    melden();
    return new Promise((r) => { weiter = () => r(body); });
  };
  return { datei, gelesen, weiter: () => weiter() };
}

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
  const { boot } = loadBoot({
    shared: [{ name: "Prüfung, geteilt.pdf", body: PDF }],
    path: "/reader",
    search: "?share=1",
  });
  assert.equal(await boot.pendingFileName(), "Prüfung, geteilt.pdf", "die geteilte Datei wurde zu früh abgefragt");
  assert.ok((await boot.takePendingFile()).length > 0);
});

test("Freigabe: der Parkplatz ist danach wirklich leer", async () => {
  // Am Speicher geprüft, nicht am Quelltext: eine abgelehnte Datei darf nicht
  // bei jedem Start erneut auftauchen.
  const { boot, shareStore } = loadBoot({
    shared: [{ name: "einmal.pdf", body: PDF }],
    path: "/reader",
    search: "?share=1",
  });
  await boot.pendingFileName();
  assert.equal(shareStore().size, 0, "der Eintrag liegt noch im Parkplatz");
});

test("Freigabe: auch eine abgelehnte Datei wird aus dem Parkplatz entfernt", async () => {
  const { boot, shareStore } = loadBoot({
    shared: [{ name: "kaputt.pdf", body: "kein PDF" }],
    path: "/reader",
    search: "?share=1",
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(shareStore().size, 0, "die abgelehnte Datei käme beim nächsten Start wieder");
});

// --- Nachtrag 3.1: abgeholt wird GENAU der Eintrag aus der Adresse ----------

test("Freigabe: geöffnet wird der Eintrag aus der Adresse, nicht der älteste", async () => {
  // DER Fehler, den Nachtrag 3.1 behebt. Vorher holte boot.js alle Einträge
  // aufsteigend ab: die ÄLTESTE Freigabe gewann, und die gerade geteilte lief
  // in `if (pending)` — nachdem sie schon aus dem Cache gelöscht war. Der
  // Nutzer sah eine Datei, die er nicht gewählt hatte, und seine war weg.
  const { boot, shareStore, status } = loadBoot({
    shared: [
      { key: 1, name: "liegengeblieben.pdf", body: PDF },
      { key: 2, name: "gerade-geteilt.pdf", body: PDF },
    ],
    path: "/reader",
    search: "?share=2",
  });
  assert.equal(
    await boot.pendingFileName(),
    "gerade-geteilt.pdf",
    `geöffnet wurde die falsche Datei; Meldungen: ${status.join(" | ")}`,
  );
  assert.equal(shareStore().size, 0, "die Waise liegt noch da");
  assert.ok(
    !status.some((s) => /erste|first/i.test(s)),
    "gemeldet wurde 'mehrere geteilte Dateien' — der Nutzer hat aber eine geteilt",
  );
});

test("Freigabe: eine Waise wird gelöscht, aber nicht geöffnet", async () => {
  // Auf jeder Route, nicht nur auf /reader: vorher riss accept() bei einem
  // gewöhnlichen Start von / die Route auf /reader, wegen einer Datei, die der
  // Nutzer vor Tagen geteilt hatte.
  const { boot, shareStore, routed } = loadBoot({
    shared: [{ key: 1, name: "liegengeblieben.pdf", body: PDF }],
    path: "/",
  });
  assert.equal(await boot.pendingFileName(), null, "eine Waise wurde geöffnet");
  assert.equal(shareStore().size, 0, "die Waise wurde nicht aufgeräumt");
  assert.deepEqual(routed, [], `die Route wurde umgestellt: ${JSON.stringify(routed)}`);
});

test("Freigabe: eine HÖHERE Nummer bleibt liegen, ihre Navigation kommt noch", async () => {
  // Teilt der Nutzer B, während die Seite aus Freigabe A noch lebt, parkt der
  // Worker B und antwortet mit einer Umleitung — die Navigation dorthin kommt
  // erst. Ein Aufräumen „alles außer meiner" würde B in diesem Fenster
  // wegräumen, und das neue Dokument fände nichts (Nachtrag 3.1 a).
  const { boot, shareStore } = loadBoot({
    shared: [
      { key: 1, name: "meine.pdf", body: PDF },
      { key: 2, name: "kommt-noch.pdf", body: PDF },
    ],
    path: "/reader",
    search: "?share=1",
  });
  assert.equal(await boot.pendingFileName(), "meine.pdf");
  assert.deepEqual([...shareStore().keys()], ["/__pb-share/2"], "die neuere Freigabe wurde weggeräumt");
});

test("Freigabe: ein Schlüssel ohne Nummer wird aufgeräumt", async () => {
  // Der feste `/__pb-share` aus dem Ursprungsstand. Nie ausgeliefert, aber er
  // würde sonst für immer im Cache Storage liegen — und die Zusage der
  // Datenschutzseite („wird gelöscht") wäre unwahr.
  const { boot, shareStore } = loadBoot({
    shared: [{ rawKey: "/__pb-share", name: "alt.pdf", body: PDF }],
    path: "/",
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(shareStore().size, 0, "der alte Schlüssel blieb liegen");
});

test("Freigabe: fehlt der Eintrag zur Nummer, wird das gemeldet", async () => {
  // Sonst käme die App leer hoch und der Nutzer erfährt nicht, dass seine
  // Datei nicht ankam — ein stilles Nichts (Nachtrag 3.1 b).
  const { boot, sub } = loadBoot({
    shared: [{ key: 1, name: "fremde-waise.pdf", body: PDF }],
    path: "/reader",
    search: "?share=7",
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.match(sub.textContent, /nicht übernommen|could not be taken/i, `gemeldet: „${sub.textContent}"`);
  assert.ok(sub.classList.contains("is-error"), "nicht als Fehler markiert");
});

test("Freigabe: die Nummer verschwindet nach der Abholung aus der Adresse", async () => {
  // Der Eintrag ist danach gelöscht; ein Neuladen oder Lesezeichen mit der
  // Nummer bekäme nur noch eine Fehlermeldung.
  const { boot, routed } = loadBoot({
    shared: [{ key: 4, name: "geteilt.pdf", body: PDF }],
    path: "/reader",
    search: "?share=4",
  });
  await boot.pendingFileName();
  assert.deepEqual(routed, ["/reader"], `Adressänderungen: ${JSON.stringify(routed)}`);
});

test("zwei Dateien gleichzeitig gestartet: eine gewinnt, und das wird gemeldet", async () => {
  // Beide Eintrittswege laufen zur selben Zeit los. Ohne Reihung kommen beide
  // an `if (pending)` vorbei, bevor eine von beiden accept() fertig hat — dann
  // gewinnt nicht „die erste", sondern die, die zuletzt auflöst, der Parkplatz
  // wird überschrieben, und die Meldung „geöffnet wird die erste" bleibt aus.
  //
  // Mit Dateien, deren Bytes als Mikrotask kommen (siehe fakeFile): echte
  // File-Objekte serialisieren sich selbst und der Test könnte nicht rot werden.
  const { boot, launch, status } = loadBoot({ path: "/reader" });
  launch(fakeFile(PDF, "eins.pdf"));
  launch(fakeFile(PDF, "zwei.pdf"));

  const name = await boot.pendingFileName();
  assert.ok(name === "eins.pdf" || name === "zwei.pdf", `keine der beiden Dateien geparkt: ${name}`);
  assert.ok(
    status.some((s) => /erste|first/i.test(s)),
    `die zweite Datei verschwand ohne Meldung; Meldungen: ${status.join(" | ")}`,
  );
  assert.equal(await boot.pendingFileName(), name, "der Parkplatz hat sich hinterher noch geändert");
});

test("Entwurf und abgelegte PDF gleichzeitig: der Entwurf wird nicht zur Waise", async () => {
  // Die Route wird NACH dem Lesen der Datei noch einmal angesehen. Der Weg
  // dahin: `offer()` (Drop-Zone, Dateiauswahl) ruft accept() DIREKT auf, nicht
  // über den Sortierer — die Reihung der Eintrittswege greift hier also nicht.
  // Also: designWanted() sagt auf /editor ja, dann stellt accept() für die
  // abgelegte PDF die Route auf /reader und leert pendingDesign — und der
  // Entwurf setzt sich danach wieder, obwohl der Designer in diesem Start nie
  // gemountet wird. Beim späteren Wechsel dorthin ersetzte er dessen Dokument,
  // ohne dass jemand ihn gewählt hat. Genau das verhindert Nachtrag 2.
  const { boot, launch } = loadBoot({ path: "/editor" });
  const entwurf = haltendeDatei(DESIGN, "entwurf.pbdesign.json", "application/json");
  launch(entwurf.datei);

  // Warten, bis boot.js den Inhalt liest: dann ist die erste Routenprüfung
  // durch (Route war /editor) und der Entwurf steht kurz vor pendingDesign.
  await entwurf.gelesen;

  // Jetzt die PDF ablegen. offer() geht DIREKT in accept(), nicht über den
  // Sortierer — die Reihung der Eintrittswege greift hier nicht.
  // Nicht pendingFileName() abfragen, solange der Entwurf hängt: das wartet auf
  // das ready-Gatter, in dem der Entwurf steckt — und wäre ein Deadlock.
  assert.equal(await boot.offer(fakeFile(PDF, "dazwischen.pdf")), true, "die PDF wurde nicht angenommen");

  // Und erst jetzt kommt der Inhalt des Entwurfs an.
  entwurf.weiter();
  assert.equal(await boot.pendingFileName(), "dazwischen.pdf");

  assert.equal(
    await boot.takePendingDesign(),
    null,
    "die PDF hat die Route auf /reader gestellt, der Entwurf blieb als Waise liegen",
  );
});

test("Freigabe ohne Dateinamen-Header: Ersatzname statt Absturz", async () => {
  const { boot } = loadBoot({
    shared: [{ name: undefined, body: PDF }],
    path: "/reader",
    search: "?share=1",
  });
  assert.equal(await boot.pendingFileName(), "geteilt.pdf");
});

test("Freigabe: ein JSON wird NICHT als Entwurf geparkt", async () => {
  // Sonst liegt es im Design-Parkplatz, der Reader fragt nur nach einer PDF und
  // bekommt nichts — und beim nächsten Wechsel in den Designer ersetzt es
  // dessen Dokument, ohne dass der Nutzer in diesem Moment etwas gewählt hat.
  const { boot } = loadBoot({
    shared: [{ name: "daten.pdf", body: DESIGN }],
    path: "/reader",
    search: "?share=1",
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(await boot.takePendingDesign(), null, "ein geteiltes JSON landete im Design-Parkplatz");
});

test("Freigabe: eine Fehlermeldung bleibt stehen und wird nicht von wire() überschrieben", async () => {
  // Der eigentliche Fehler: index.html hat das Boot-Markup VOR dem Skript,
  // also läuft wire() noch im selben Task hinter der Abholung — und setzte
  // seinen Begrüßungstext über die Fehlermeldung. Der Nutzer sah nie, dass
  // seine Freigabe gescheitert ist. Deshalb prüft dieser Test den ENDZUSTAND
  // des Feldes, nicht nur, dass die Meldung einmal gesetzt wurde.
  const { sub, status } = loadBoot({ path: "/reader", search: "?share=failed" });
  assert.match(sub.textContent, /nicht übernommen|could not be taken/i, `Meldungen der Reihe nach: ${status.join(" | ")}`);
  assert.ok(sub.classList.contains("is-error"), "nicht als Fehler markiert");
});

test("Freigabe: jede Kennung hat ihre eigene Meldung", () => {
  const faelle = [
    ["?share=failed", /nicht übernommen/i],
    ["?share=rejected", /nicht von Ihrem Gerät/i],
    ["?share=toobig", /größer als 100 MB/i],
  ];
  for (const [such, muster] of faelle) {
    const { sub } = loadBoot({ path: "/reader", search: such });
    assert.match(sub.textContent, muster, `für ${such}`);
  }
});

test("Freigabe: die Kennung verschwindet aus der Adresse", () => {
  // Sonst erscheint die Meldung bei jedem Neuladen wieder, auch Tage später.
  const { routed } = loadBoot({ path: "/reader", search: "?share=failed" });
  assert.deepEqual(routed, ["/reader"], `Adressänderungen: ${JSON.stringify(routed)}`);
});

test("Freigabe: nur die Kennung geht, andere Parameter und der Hash bleiben", () => {
  // Ein `search.replace(/share=…/)` nahm den Hash gar nicht mit — jeder Anker
  // und jede Lesemarke in der Adresse war nach einer Freigabe-Meldung weg.
  const { routed, sub } = loadBoot({
    path: "/reader",
    search: "?seite=7&share=toobig&zoom=150",
    hash: "#anker",
  });
  assert.match(sub.textContent, /größer als|larger than/i);
  assert.deepEqual(routed, ["/reader?seite=7&zoom=150#anker"], `Adressänderungen: ${JSON.stringify(routed)}`);
});

test("Freigabe: ein Parameter, der nur ÄHNLICH heißt, löst keine Meldung aus", () => {
  // `search.indexOf("share=failed")` traf auch `?xshare=failed` und
  // `?weiter=/x?share=failed` — dann stand die Fehlermeldung ohne jede Freigabe
  // da, und die Adresse wurde dafür auch noch umgeschrieben.
  for (const such of ["?xshare=failed", "?weiter=%2Fx%3Fshare%3Drejected", "?share=sonstwas"]) {
    const { sub, routed } = loadBoot({ path: "/reader", search: such });
    assert.equal(
      sub.classList.contains("is-error"),
      false,
      `${such} hat eine Fehlermeldung ausgelöst: „${sub.textContent}"`,
    );
    assert.deepEqual(routed, [], `${such} hat die Adresse umgeschrieben: ${JSON.stringify(routed)}`);
  }
});

test("ohne Freigabe-Problem steht der Begrüßungstext", () => {
  const { sub } = loadBoot({ path: "/" });
  assert.match(sub.textContent, /Öffnet sich|opens as soon/i);
  assert.equal(sub.classList.contains("is-error"), false);
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

test("Dateihandler: ein Entwurf, in dem %PDF- im Text steht, bleibt ein Entwurf", async () => {
  // looksLikePdf sucht %PDF- IRGENDWO in den ersten 1024 Bytes (so verlangt es
  // die Spezifikation für PDFs mit Vorsatz). Ein Entwurf mit dieser Zeichenfolge
  // in einem Textblock wurde dadurch als PDF geparkt, die Route sprang auf
  // /reader, und PDF.js scheiterte. Jetzt entscheidet das erste Zeichen.
  const heimtueckisch = JSON.stringify({ version: 1, elements: [{ text: "siehe %PDF-1.7 Spezifikation" }] });
  const { boot, launch, routed } = loadBoot({ path: "/editor" });
  launch(new File([heimtueckisch], "zitat.pbdesign.json", { type: "application/json" }));
  assert.equal(await boot.takePendingDesign(), heimtueckisch);
  assert.equal(await boot.pendingFileName(), null, "als PDF geparkt");
  assert.deepEqual(routed, [], "die Route wurde auf /reader gerissen");
});

test("ein geparkter Entwurf wird fallengelassen, wenn accept() auf /reader umstellt", async () => {
  // Sonst bleibt er als Waise liegen: der Designer wird in diesem Start nicht
  // mehr gemountet, und beim späteren Wechsel dorthin ersetzte er dessen
  // Dokument, ohne dass jemand ihn gewählt hat.
  const { boot, launch } = loadBoot({ path: "/editor" });
  launch(new File([DESIGN], "karte.pbdesign.json", { type: "application/json" }));
  await boot.pendingFileName(); // Abholung abwarten, Entwurf ist geparkt
  assert.equal(await boot.offer(pdfFile("dazwischen.pdf")), true);
  assert.equal(await boot.takePendingDesign(), null, "der Entwurf blieb als Waise liegen");
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
