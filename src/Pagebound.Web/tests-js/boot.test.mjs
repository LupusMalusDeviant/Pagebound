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
 * Eine Freigabe-Kennung in der Form, die der Service Worker vergibt
 * (`crypto.randomUUID()`, Nachtrag 4.1). Feste Werte, damit ein Test dieselbe
 * Kennung in den Parkplatz und in die Adresse schreiben kann.
 *
 * Sie sind BEWUSST nicht fortlaufend lesbar gedacht: dass eine höhere Kennung
 * neuer wäre, war genau die Annahme, an der zwei Datenverlust-Pfade hingen.
 */
const KENN = (n) => `0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
/** Fünf Minuten plus eine Sekunde — damit gilt ein Eintrag als Waise. */
const ZU_ALT = 5 * 60 * 1000 + 1000;

/**
 * Lädt boot.js mit nur den Browser-Teilen, die es anfasst.
 * `shared`: Einträge, die der Service Worker im Parkplatz hinterlassen hat.
 * `path` / `search`: die Route, unter der die App startet.
 */
/**
 * Ein Element mit genau dem, was boot.js daran anfasst.
 *
 * `addEventListener` MERKT sich den Zuhörer, statt ihn wegzuwerfen. Ein Stub,
 * der nichts behält, macht jeden Ereignis-Pfad unprüfbar: der Test kann dann
 * nur noch die öffentliche Schnittstelle fahren (offer()), und eine Änderung am
 * Drop-Handler bleibt grün. Genau das ist hier passiert.
 */
function fakeEl(onText) {
  const klassen = new Set();
  const zuhoerer = new Map();
  const e = {
    hidden: true,
    classList: {
      add: (c) => klassen.add(c),
      remove: (c) => klassen.delete(c),
      contains: (c) => klassen.has(c),
      toggle: (c, on) => (on ? klassen.add(c) : klassen.delete(c)),
    },
    setAttribute: () => {},
    addEventListener: (art, fn) => { (zuhoerer.get(art) ?? zuhoerer.set(art, []).get(art)).push(fn); },
    files: null,
    _klassen: klassen,
    _feuern: (art, ev) => (zuhoerer.get(art) ?? []).forEach((fn) => fn(ev ?? {})),
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
function loadBoot({
  shared = [],
  path = "/",
  search = "",
  hash = "",
  lang = "de",
  withZone = true,
  cacheFehler = false,
} = {}) {
  const stores = new Map();
  if (shared.length) {
    const store = new Map();
    shared.forEach((s, i) => {
      const headers = new Headers();
      if (s.name !== undefined) headers.set("X-Pagebound-Filename", encodeURIComponent(s.name));
      // Der Zeitstempel, den der Worker setzt (Nachtrag 4.2). `alterMs` macht
      // einen Eintrag künstlich alt, `ohneStempel` stellt einen Eintrag aus
      // einem Stand VOR diesem Nachtrag nach — der gilt als alt.
      //
      // Die Vorgabe ist 1000 ms, nicht 0: ein Eintrag „0 ms alt" würde auch eine
      // Frist von 0 überleben (`0 > 0` ist falsch), und eine Gegenprobe, die
      // die Frist auf 0 setzt, bliebe dann grün. Eine Sekunde ist eindeutig
      // jung und eindeutig messbar.
      if (!s.ohneStempel) {
        headers.set("X-Pagebound-Shared-At", String(Date.now() - (s.alterMs ?? 1000)));
      }
      // rawKey: ein Schlüssel ohne Kennung — der feste `/__pb-share` aus dem
      // Ursprungsstand. Er muss aufgeräumt werden, nicht geöffnet.
      store.set(s.rawKey ?? `/__pb-share/${s.key ?? KENN(i + 1)}`, new Response(s.body, { headers }));
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
        // cacheFehler: der Cache Storage scheitert mitten in der Abholung
        // (Kontingent erschöpft, Speicher weggeräumt). Vorher schluckte also()
        // den Fehler: keine Meldung, und die Nummer blieb in der Adresse.
        if (cacheFehler) throw new Error("Cache Storage kaputt (Prüfstand)");
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
  // Die Zuhörer am window merken, nicht wegwerfen: der Drop-Pfad hängt daran.
  const fensterZuhoerer = new Map();
  ctx.addEventListener = (art, fn) => {
    if (!fensterZuhoerer.has(art)) fensterZuhoerer.set(art, []);
    fensterZuhoerer.get(art).push(fn);
  };
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
    /**
     * Legt eine Datei auf der Seite ab — über den ECHTEN drop-Zuhörer, den
     * wire() am window angemeldet hat. Nur so liegt der Pfad im Test, den der
     * Nutzer benutzt; `offer()` ist ein anderer Eintritt.
     */
    drop(file) {
      const fns = fensterZuhoerer.get("drop") ?? [];
      assert.ok(fns.length > 0, "boot.js hat keinen drop-Zuhörer angemeldet");
      fns.forEach((fn) => fn({ preventDefault() {}, dataTransfer: { files: [file] } }));
    },
    /** Wählt eine Datei über das versteckte <input type="file"> aus. */
    choose(file) {
      const input = elemente["pb-boot-file"];
      assert.ok(input, "kein pb-boot-file im Prüfstand (withZone: false?)");
      input.files = [file];
      input._feuern("change");
    },
    /**
     * Wartet, bis alles abgearbeitet ist, was durch die Reihung läuft.
     *
     * Nötig, weil ein Drop oder eine Dateiauswahl NICHT im ready-Gatter liegt
     * (das gilt nur für den Start) — `pendingFileName()` kann also auflösen,
     * bevor die abgelegte Datei durch ist. `offer(null)` stellt sich hinter die
     * Reihung und löst erst auf, wenn alles davor fertig ist.
     */
    settle() {
      return ctx.window.pageboundBoot.offer(null);
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
 * Eine Datei, deren Kopf-Lesen erst auf Zuruf auflöst (`.freigeben()`).
 *
 * Nötig für jede Prüfung an der Reihung: nur wenn ein Eintritt mitten im Lesen
 * HÄLT, kann ein zweiter ihn überholen. Mit Dateien, die sofort auflösen, ist
 * eine Wettlauf-Prüfung gegenstandslos — sie wird auch ohne Sperre grün.
 */
function haltendeDatei(body, name, { type = "application/pdf" } = {}) {
  const bytes = new TextEncoder().encode(body);
  let los;
  const tor = new Promise((r) => { los = r; });
  return {
    name,
    type,
    size: bytes.length,
    slice: () => ({ arrayBuffer: () => tor.then(() => bytes.buffer.slice(0, Math.min(1024, bytes.length))) }),
    text: () => tor.then(() => body),
    freigeben: () => { los(); },
  };
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
    search: "?share=" + KENN(1),
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
    search: "?share=" + KENN(1),
  });
  await boot.pendingFileName();
  assert.equal(shareStore().size, 0, "der Eintrag liegt noch im Parkplatz");
});

test("Freigabe: auch eine abgelehnte Datei wird aus dem Parkplatz entfernt", async () => {
  const { boot, shareStore } = loadBoot({
    shared: [{ name: "kaputt.pdf", body: "kein PDF" }],
    path: "/reader",
    search: "?share=" + KENN(1),
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
      { key: KENN(1), name: "liegengeblieben.pdf", body: PDF, alterMs: ZU_ALT },
      { key: KENN(2), name: "gerade-geteilt.pdf", body: PDF },
    ],
    path: "/reader",
    search: "?share=" + KENN(2),
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
    shared: [{ key: KENN(1), name: "liegengeblieben.pdf", body: PDF, alterMs: ZU_ALT }],
    path: "/",
  });
  assert.equal(await boot.pendingFileName(), null, "eine Waise wurde geöffnet");
  assert.equal(shareStore().size, 0, "die Waise wurde nicht aufgeräumt");
  assert.deepEqual(routed, [], `die Route wurde umgestellt: ${JSON.stringify(routed)}`);
});

// --- Nachtrag 4.2: aufgeräumt wird nach ALTER, nicht nach Kennung -----------

test("Freigabe: ein FRISCHER fremder Eintrag bleibt liegen, seine Navigation kommt noch", async () => {
  // Teilt der Nutzer B, während die Seite aus Freigabe A noch lebt, parkt der
  // Worker B und antwortet mit einer Umleitung — die Navigation dorthin kommt
  // erst. Ein Aufräumen „alles außer meiner" würde B in diesem Fenster
  // wegräumen, und das neue Dokument fände nichts.
  const { boot, shareStore } = loadBoot({
    shared: [
      { key: KENN(1), name: "meine.pdf", body: PDF },
      { key: KENN(2), name: "kommt-noch.pdf", body: PDF },
    ],
    path: "/reader",
    search: "?share=" + KENN(1),
  });
  assert.equal(await boot.pendingFileName(), "meine.pdf");
  assert.deepEqual(
    [...shareStore().keys()],
    [`/__pb-share/${KENN(2)}`],
    "die frische fremde Freigabe wurde weggeräumt",
  );
});

test("Freigabe: ein Start OHNE Kennung lässt einen frischen fremden Eintrag liegen", async () => {
  // DER Datenverlust-Pfad aus dem Review von b727c01, und der Grund für
  // Nachtrag 4.2. Das Manifest hat kein `launch_handler`, jede Freigabe öffnet
  // also ihren eigenen Client. Während Fenster A auf seine Freigabe wartet,
  // startet ein zweiter Client ohne Kennung — ein Neuladen, ein Dateistart,
  // oder ein `?share=rejected`, das eine FREMDE Seite auslösen kann. Vorher
  // löschte dieser Start „alles, was er vorfand", also auch die Freigabe von
  // Fenster A. Fenster A meldete dann „konnte nicht übernommen werden", und die
  // Datei des Nutzers war weg.
  const { boot, shareStore } = loadBoot({
    shared: [{ key: KENN(1), name: "wartet-auf-fenster-a.pdf", body: PDF }],
    path: "/reader",
    search: "?share=rejected",
  });
  assert.equal(await boot.pendingFileName(), null, "der fremde Eintrag wurde geöffnet");
  assert.deepEqual(
    [...shareStore().keys()],
    [`/__pb-share/${KENN(1)}`],
    "die Freigabe eines anderen Fensters wurde gelöscht",
  );
});

test("Freigabe: eine erfundene Kennung in der Adresse löscht nichts", async () => {
  // Vorher war die Kennung eine Nummer, und Nummern sind vergleichbar: ein Link
  // auf `/reader?share=999` löschte jeden Eintrag mit kleinerer Nummer. Eine
  // fremde Seite konnte so die Freigabe des Nutzers wegräumen. Jetzt gibt es
  // kein „kleiner" — und eine Kennung zu erraten ist der Punkt, an dem das
  // scheitert.
  const { boot, shareStore, sub } = loadBoot({
    shared: [{ key: KENN(1), name: "meine.pdf", body: PDF }],
    path: "/reader",
    search: "?share=ffffffff-ffff-4fff-8fff-ffffffffffff",
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.match(sub.textContent, /nicht übernommen|could not be taken/i, `gemeldet: „${sub.textContent}"`);
  assert.deepEqual(
    [...shareStore().keys()],
    [`/__pb-share/${KENN(1)}`],
    "eine erfundene Kennung hat einen fremden Eintrag gelöscht",
  );
});

test("Freigabe: der EIGENE Eintrag wird geholt, auch wenn er alt ist", async () => {
  // Die Altersregel gilt nur für fremde Einträge. Wer seine eigene Kennung
  // mitbringt, bekommt seine Datei — auch wenn der Start lange gedauert hat
  // (Nachtrag 4.2, Punkt 4). Sonst wäre ein langsames Telefon ein Datenverlust.
  const { boot } = loadBoot({
    shared: [{ key: KENN(1), name: "lange-unterwegs.pdf", body: PDF, alterMs: ZU_ALT * 10 }],
    path: "/reader",
    search: "?share=" + KENN(1),
  });
  assert.equal(await boot.pendingFileName(), "lange-unterwegs.pdf");
});

test("Freigabe: ein Eintrag OHNE Zeitstempel gilt als alt und wird aufgeräumt", async () => {
  // Einträge aus einem Stand vor Nachtrag 4.2 tragen keinen Zeitstempel. Sie
  // dürfen nicht für immer liegen bleiben — sonst wäre die Zusage der
  // Datenschutzseite („wird gelöscht") unwahr.
  const { boot, shareStore } = loadBoot({
    shared: [{ key: KENN(1), name: "aus-altem-stand.pdf", body: PDF, ohneStempel: true }],
    path: "/",
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(shareStore().size, 0, "ein Eintrag ohne Zeitstempel blieb liegen");
});

test("Freigabe: ein Schlüssel ohne Kennung wird aufgeräumt", async () => {
  // Der feste `/__pb-share` aus dem Ursprungsstand. Nie ausgeliefert, aber er
  // würde sonst für immer im Cache Storage liegen. Er trägt keinen Zeitstempel
  // und fällt damit unter dieselbe Regel.
  const { boot, shareStore } = loadBoot({
    shared: [{ rawKey: "/__pb-share", name: "alt.pdf", body: PDF, ohneStempel: true }],
    path: "/",
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(shareStore().size, 0, "der alte Schlüssel blieb liegen");
});

test("Freigabe: eine NUMMER in der Adresse ist keine Kennung und öffnet nichts", async () => {
  // Der gefährliche Fall beim Fassungswechsel: ein Tab steht noch auf
  // `/reader?share=3` aus dem alten Stand, und im Cache liegt `/__pb-share/3`
  // aus demselben Stand. Würde boot.js eine Nummer als Kennung nehmen, öffnete
  // dieser Tab eine Datei, die der Nutzer vor Tagen geteilt hat — genau das
  // Verhalten, das Nachtrag 3.1 abgeschafft hat. Die Form der Kennung ist die
  // Prüfung, die das verhindert.
  const { boot, shareStore } = loadBoot({
    shared: [{ rawKey: "/__pb-share/3", name: "von-vorgestern.pdf", body: PDF, ohneStempel: true }],
    path: "/reader",
    search: "?share=3",
  });
  assert.equal(await boot.pendingFileName(), null, "eine Nummer wurde als Kennung genommen");
  assert.equal(shareStore().size, 0, "der alte Eintrag blieb liegen");
});

test("Freigabe: ein Schlüssel mit einer NUMMER aus altem Stand wird aufgeräumt", async () => {
  // Ein Stand vor Nachtrag 4.1 hat Nummern vergeben. Diese Einträge erkennt
  // niemand mehr als eigene Freigabe; sie tragen keinen Zeitstempel und müssen
  // deshalb beim ersten Start verschwinden.
  const { boot, shareStore } = loadBoot({
    shared: [{ rawKey: "/__pb-share/3", name: "nummer-drei.pdf", body: PDF, ohneStempel: true }],
    path: "/",
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(shareStore().size, 0, "der Nummern-Schlüssel blieb liegen");
});

test("Freigabe: scheitert der Cache Storage, wird es gemeldet und die Kennung entfernt", async () => {
  // Vorher ein stiller Fehlschlag: also() schluckt die abgelehnte Kette, es gab
  // keine Meldung, und die Kennung blieb in der Adresse stehen.
  const { boot, sub, routed } = loadBoot({
    shared: [{ key: KENN(3), name: "geteilt.pdf", body: PDF }],
    path: "/reader",
    search: "?share=" + KENN(3),
    cacheFehler: true,
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.match(sub.textContent, /nicht übernommen|could not be taken/i, `gemeldet: „${sub.textContent}"`);
  assert.ok(sub.classList.contains("is-error"), "nicht als Fehler markiert");
  assert.deepEqual(routed, ["/reader"], `die Kennung blieb in der Adresse: ${JSON.stringify(routed)}`);
});

test("Freigabe: fehlt der Eintrag zur Kennung, wird das gemeldet", async () => {
  // Sonst käme die App leer hoch und der Nutzer erfährt nicht, dass seine
  // Datei nicht ankam — ein stilles Nichts (Nachtrag 3.1 b).
  const { boot, sub } = loadBoot({
    shared: [{ key: KENN(1), name: "fremde-waise.pdf", body: PDF, alterMs: ZU_ALT }],
    path: "/reader",
    search: "?share=" + KENN(7),
  });
  assert.equal(await boot.pendingFileName(), null);
  assert.match(sub.textContent, /nicht übernommen|could not be taken/i, `gemeldet: „${sub.textContent}"`);
  assert.ok(sub.classList.contains("is-error"), "nicht als Fehler markiert");
});

test("Freigabe: die Kennung verschwindet nach der Abholung aus der Adresse", async () => {
  // Der Eintrag ist danach gelöscht; ein Neuladen oder Lesezeichen mit der
  // Kennung bekäme nur noch eine Fehlermeldung.
  const { boot, routed } = loadBoot({
    shared: [{ key: KENN(4), name: "geteilt.pdf", body: PDF }],
    path: "/reader",
    search: "?share=" + KENN(4),
  });
  await boot.pendingFileName();
  assert.deepEqual(routed, ["/reader"], `Adressänderungen: ${JSON.stringify(routed)}`);
});

test("genau an der Grenze nimmt boot.js die Datei an, ein Byte darüber nicht", async () => {
  // Am Verhalten geprüft, nicht an einem Regex auf den Quelltext: der Worker
  // und boot.js müssen bei derselben Zahl dieselbe Entscheidung treffen, sonst
  // lehnt eine Schicht ab, was die andere durchlässt — und der Fehler erscheint
  // erst beim Nutzer. 100 MiB − 1 läuft mit `>` und mit `>=` durch und
  // unterscheidet die beiden nicht; genau 100 MiB tut es.
  const { boot, sub } = loadBoot({ path: "/reader" });

  const genau = fakeFile(PDF, "genau.pdf");
  Object.defineProperty(genau, "size", { value: 100 * 1024 * 1024, configurable: true });
  assert.equal(await boot.offer(genau), true, `genau die Grenze wurde abgewiesen: „${sub.textContent}"`);

  const { boot: boot2, sub: sub2 } = loadBoot({ path: "/reader" });
  const drueber = fakeFile(PDF, "drueber.pdf");
  Object.defineProperty(drueber, "size", { value: 100 * 1024 * 1024 + 1, configurable: true });
  assert.equal(await boot2.offer(drueber), false, "ein Byte über der Grenze wurde angenommen");
  assert.match(sub2.textContent, /größer als|larger than/i);
});

test("Drop-Zone und gestartete Datei gleichzeitig: eine gewinnt, und das wird gemeldet", async () => {
  // offer() ging vorher DIREKT in accept(), nicht über die Reihung. Damit galt
  // „die erste gewinnt" zwischen Drop-Zone und Start/Freigabe nicht: eine
  // gestartete Datei, die noch auf looksLikePdf wartet, hat `if (pending)`
  // schon passiert, und die abgelegte Datei setzt `pending` ebenfalls. Es
  // gewann, wer zuletzt auflöste, und keine Seite meldete es.
  // Über den ECHTEN drop-Zuhörer, nicht über offer(): das ist der Pfad des
  // Nutzers. Ein Test mit offer() blieb grün, als ich den Drop-Handler wieder
  // direkt in accept() legte — er prüfte den falschen Eintritt.
  // Über den ECHTEN drop-Zuhörer bzw. das echte <input>, nicht über offer():
  // das sind die Pfade des Nutzers.
  for (const weg of ["drop", "choose"]) {
    const h = loadBoot({ path: "/reader" });
    h.launch(fakeFile(PDF, "gestartet.pdf"));
    h[weg](fakeFile(PDF, "vom-nutzer.pdf"));

    const name = await h.boot.pendingFileName();
    assert.ok(
      name === "gestartet.pdf" || name === "vom-nutzer.pdf",
      `${weg}: keine der beiden geparkt: ${name}`,
    );
    // Der Kern: die Verliererin darf nicht stillschweigend verschwinden. Je
    // nachdem, wer zuerst dran war, ist das „geöffnet wird die erste" (der
    // automatische Weg gibt nach) oder „ersetzt die vorige Datei" (die
    // Handlung des Nutzers schlägt den automatischen Eintritt).
    assert.ok(
      h.status.some((s) => /erste|first|ersetzt|replaces/i.test(s)),
      `${weg}: eine Datei verschwand ohne Meldung; Meldungen: ${h.status.join(" | ")}`,
    );
    assert.equal(await h.boot.pendingFileName(), name, `${weg}: der Parkplatz änderte sich hinterher noch`);
  }
});

test("die Drop-Zone ersetzt eine wartende Datei und sagt es", async () => {
  // Die Regel ausdrücklich: eine Handlung des Nutzers schlägt eine wartende
  // Datei — aber sie verdrängt sie nicht stumm. Vorher stand in accept() nur
  // `pending = file`, und die vorige Datei war weg, ohne ein Wort.
  const { boot, drop, sub, settle } = loadBoot({ path: "/reader" });
  assert.equal(await boot.offer(fakeFile(PDF, "erste.pdf")), true);
  assert.equal(await boot.pendingFileName(), "erste.pdf");

  drop(fakeFile(PDF, "zweite.pdf"));
  await settle(); // der Drop liegt NICHT im ready-Gatter — abwarten, sonst prüft der Test nichts
  assert.equal(await boot.pendingFileName(), "zweite.pdf", "die abgelegte Datei hat nicht gewonnen");
  assert.match(sub.textContent, /ersetzt|replaces/i, `gemeldet: „${sub.textContent}"`);
});

test("zwei Drops gleichzeitig: der SPÄTERE gewinnt, nicht der schnellere", async () => {
  // Das ist die Prüfung, die den Verlust der Reihung sehen kann. Ohne
  // withSortLock laufen beide Eintritte gleichzeitig in looksLikePdf: die
  // zweite Datei liest sofort fertig und setzt `pending`, die erste löst
  // danach auf und setzt es WIEDER — die früher abgelegte Datei gewinnt, und
  // die Meldung auf dem Schirm nennt eine andere Datei als die, die geöffnet
  // wird. Mit der Reihung ist die Ordnung die der Handlungen des Nutzers.
  const { boot, drop, sub, settle } = loadBoot({ path: "/reader" });
  const erste = haltendeDatei(PDF, "erste.pdf");

  drop(erste); // hält mitten im Kopf-Lesen
  drop(fakeFile(PDF, "zweite.pdf")); // liest sofort fertig
  erste.freigeben();
  await settle();

  assert.equal(await boot.pendingFileName(), "zweite.pdf", "die zuerst abgelegte Datei hat überholt");
  assert.match(sub.textContent, /zweite\.pdf/, `gemeldet: „${sub.textContent}"`);
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

test("ein Entwurf, der auf /reader hereinkommt, wird nicht geparkt", async () => {
  // Was hier NICHT mehr geprüft wird, und warum: die zweite Routenprüfung in
  // sortLaunchedNow (nach dem Lesen des Inhalts) ist seit der Reihung ALLER
  // Aufrufer über annehmen() nicht mehr erreichbar — zwischen den beiden
  // Prüfungen kann kein accept() laufen. Der Test, der sie zu beweisen vorgab,
  // ließ sich nur noch als Deadlock bauen (offer() wartet auf die Reihung, in
  // der der angehaltene Entwurf steckt). Er ist deshalb weg, und am Code steht,
  // dass die zweite Prüfung unbelegte zweite Schranke ist.
  //
  // Geprüft bleibt die erste Schranke, und die trägt die Zusage aus Nachtrag 2:
  // ein Entwurf wird nur dort geparkt, wo ihn jemand abholt.
  const { boot, launch, sub } = loadBoot({ path: "/reader" });
  launch(fakeFile(DESIGN, "entwurf.pbdesign.json", { type: "application/json" }));
  assert.equal(await boot.pendingFileName(), null);
  assert.equal(await boot.takePendingDesign(), null, "ein Entwurf wurde auf /reader geparkt");
  assert.match(sub.textContent, /keine PDF|not a PDF/i, `gemeldet: „${sub.textContent}"`);
});

test("Freigabe ohne Dateinamen-Header: Ersatzname statt Absturz", async () => {
  const { boot } = loadBoot({
    shared: [{ name: undefined, body: PDF }],
    path: "/reader",
    search: "?share=" + KENN(1),
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
    search: "?share=" + KENN(1),
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
