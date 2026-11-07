// =============================================================================
// service-worker.published.js im Prüfstand.
//
// Der Service Worker war bisher ungetestet, obwohl an ihm zwei Dinge hängen, die
// still kaputtgehen: die Umleitungs-Härtung (c4b7bfb — eine `redirected`-Antwort
// darf keine Navigation beantworten) und das Teilen-Ziel. Beides lässt sich im
// Browser nur mit Mühe herbeiführen, hier nicht.
//
// Der Worker läuft dafür in einem vm-Kontext mit nachgebauten Browser-Teilen
// (caches, importScripts, addEventListener). Die Funktionen auf oberster Ebene
// sind `function`-Deklarationen und landen dadurch als Eigenschaften im
// Kontext — so sind onFetch/onActivate direkt aufrufbar, ohne echte Events.
//
// Was dieser Prüfstand NICHT kann, und was deshalb die E2E-Strecke in
// tests/Pagebound.E2ETests/ShareTargetTests.cs prüft: dass ein echter Browser
// die Umleitung auf eine Navigation befolgt, dass der Service Worker die
// POST-Navigation überhaupt kontrolliert, und dass der Reader die Datei öffnet.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const swPath = join(resolve(here, ".."), "wwwroot", "service-worker.published.js");
const source = readFileSync(swPath, "utf8");

const ORIGIN = "https://example.test";

/** Minimaler Cache-Storage: nur das, was der Worker benutzt. */
function makeCaches() {
  const stores = new Map(); // name → Map<urlString, Response>
  const api = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(req, res) { store.set(String(req.url ?? req), res); },
        async match(req) { return store.get(String(req.url ?? req)); },
        async delete(req) { return store.delete(String(req.url ?? req)); },
        // Der Worker liest keys(), um die höchste vergebene Nummer zu finden.
        // Echte Cache-Schlüssel sind Request-Objekte mit absoluter URL.
        async keys() { return [...store.keys()].map((k) => ({ url: new URL(k, ORIGIN).href })); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  api._stores = stores;
  return api;
}

function loadWorker({ version = "v1", fetchImpl, assets = [{ url: "index.html", hash: "sha256-x" }] } = {}) {
  const calls = [];
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    URL, Response, Request, Headers, FormData, Blob, File,
    TypeError, Promise, Number, Math, RegExp,
    fetch: async (req) => {
      calls.push(String(req?.url ?? req));
      return fetchImpl ? fetchImpl(req) : new Response("netz", { status: 200 });
    },
    caches: makeCaches(),
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.self.origin = ORIGIN;
  ctx.self.location = { origin: ORIGIN, href: `${ORIGIN}/service-worker.js` };
  ctx.self.assetsManifest = { version, assets };
  ctx.self.importScripts = () => {};
  ctx.self.addEventListener = () => {};
  ctx.self.skipWaiting = () => {};
  ctx.self.clients = { claim: async () => {} };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "service-worker.published.js" });
  return { ctx, fetchCalls: calls };
}

/**
 * Eine Freigabe, wie das Betriebssystem sie schickt. `referrer` bleibt der
 * Vorgabewert "about:client" — eine echte Freigabe hat keinen Verweis auf eine
 * fremde Seite. `von` setzt einen, um einen fremden Absender nachzustellen.
 */
function shareRequest({ name = "geteilt.pdf", body = "%PDF-1.7\n", feld = "file", von } = {}) {
  const form = new FormData();
  if (name !== null) form.append(feld, new File([body], name, { type: "application/pdf" }));
  const init = { method: "POST", body: form };
  if (von) init.referrer = von;
  return new Request(`${ORIGIN}/share-target`, init);
}

const shareStore = (ctx) => ctx.caches._stores.get("pb-share");

test("Freigabe: die Datei wird geparkt und auf /reader umgeleitet", async () => {
  const { ctx, fetchCalls } = loadWorker();
  const res = await ctx.onFetch({ request: shareRequest() });

  assert.equal(res.status, 303, "keine 303-Umleitung");
  assert.equal(res.headers.get("location"), `${ORIGIN}/reader`);
  // Der Kern: die Freigabe darf NICHT ins Netz gehen. Es gibt keinen Server,
  // der sie annehmen könnte — der GET-Ausstieg in onFetch würde genau das tun.
  assert.deepEqual(fetchCalls, [], "die Freigabe ging ins Netz");

  const store = shareStore(ctx);
  assert.deepEqual([...store.keys()], ["/__pb-share/1"], "falscher Schlüssel im Parkplatz");
  const parked = store.get("/__pb-share/1");
  assert.equal(parked.headers.get("X-Pagebound-Filename"), "geteilt.pdf");
  assert.match(await parked.text(), /^%PDF-/);
});

test("Freigabe: Dateiname mit Sonderzeichen übersteht den Header", async () => {
  // Ein Header darf keine Umlaute tragen; unkodiert wirft das oder liefert Müll.
  const { ctx } = loadWorker();
  await ctx.onFetch({ request: shareRequest({ name: "Prüfung, Entwürfe.pdf" }) });
  const raw = shareStore(ctx).get("/__pb-share/1").headers.get("X-Pagebound-Filename");
  assert.equal(decodeURIComponent(raw), "Prüfung, Entwürfe.pdf");
});

test("zwei Freigaben kurz hintereinander bekommen eigene Schlüssel", async () => {
  // Mit einem festen Schlüssel überschrieb die zweite die erste, und die erste
  // war ohne eine Spur verloren.
  const { ctx } = loadWorker();
  await ctx.onFetch({ request: shareRequest({ name: "eins.pdf" }) });
  await ctx.onFetch({ request: shareRequest({ name: "zwei.pdf" }) });
  const store = shareStore(ctx);
  assert.deepEqual([...store.keys()].sort(), ["/__pb-share/1", "/__pb-share/2"]);
  assert.equal(
    decodeURIComponent(store.get("/__pb-share/1").headers.get("X-Pagebound-Filename")),
    "eins.pdf",
    "die erste Freigabe wurde überschrieben",
  );
});

test("eine Freigabe von fremder Herkunft wird abgewiesen", async () => {
  // Eine beliebige Website kann ein Formular auf /share-target absenden. Das
  // ist keine Freigabe, sondern eine fremde Datei mit einem Namen der Wahl des
  // Angreifers, die sich im Pagebound des Nutzers öffnen würde.
  const { ctx } = loadWorker();
  const res = await ctx.onFetch({ request: shareRequest({ von: "https://boese.example/seite" }) });
  assert.equal(res.status, 303, "soll weiterleiten, nicht scheitern");
  assert.equal(shareStore(ctx), undefined, "die fremde Datei wurde geparkt");
});

test("eine Freigabe von eigener Herkunft wird angenommen", async () => {
  const { ctx } = loadWorker();
  await ctx.onFetch({ request: shareRequest({ von: `${ORIGIN}/reader` }) });
  assert.deepEqual([...shareStore(ctx).keys()], ["/__pb-share/1"]);
});

test("Freigabe ohne Datei: Umleitung mit Fehlerkennung", async () => {
  const { ctx } = loadWorker();
  const form = new FormData();
  form.append("text", "nur Text");
  const res = await ctx.onFetch({
    request: new Request(`${ORIGIN}/share-target`, { method: "POST", body: form }),
  });
  assert.equal(res.status, 303);
  // Ohne die Kennung käme der Reader leer hoch, und die Freigabe sähe auf
  // Android einfach kaputt aus, ohne ein Wort.
  assert.equal(res.headers.get("location"), `${ORIGIN}/reader?share=failed`);
  assert.equal(shareStore(ctx)?.size ?? 0, 0, "leerer Eintrag angelegt");
});

test("andere POSTs gehen weiter ins Netz", async () => {
  const { ctx, fetchCalls } = loadWorker();
  await ctx.onFetch({ request: new Request(`${ORIGIN}/irgendwas`, { method: "POST", body: "x" }) });
  assert.deepEqual(fetchCalls, [`${ORIGIN}/irgendwas`]);
});

test("der Parkplatz übersteht einen Fassungswechsel", async () => {
  // Nicht der heutige Stand ist der Punkt (der ist richtig), sondern die Regel:
  // wer onActivate auf „alles außer dem aktuellen Cache" verallgemeinert,
  // frisst geteilte Dateien.
  const { ctx } = loadWorker({ version: "v2" });
  const share = await ctx.caches.open("pb-share");
  await share.put("/__pb-share/1", new Response("%PDF-1.7"));
  const alt = await ctx.caches.open("offline-cache-v1");
  await alt.put(`${ORIGIN}/alt`, new Response("alt"));
  const neu = await ctx.caches.open("offline-cache-v2"); // der aktuelle, wie nach onInstall
  await neu.put(`${ORIGIN}/index.html`, new Response("<html>"));

  await ctx.onActivate({});

  assert.ok(await (await ctx.caches.open("pb-share")).match("/__pb-share/1"), "pb-share wurde weggeräumt");
  assert.deepEqual(
    (await ctx.caches.keys()).filter((k) => k.startsWith("offline-cache-")),
    ["offline-cache-v2"],
    "der alte Offline-Cache blieb liegen",
  );
});

test("der Name des Parkplatzes trägt nicht das Aufräum-Präfix", () => {
  // Die Bedingung, von der der Test oben abhängt — hier an der Quelle geprüft,
  // damit eine Umbenennung auffällt und nicht nur ein Test anders durchläuft.
  assert.match(source, /const shareCacheName = 'pb-share'/);
  assert.ok(!"pb-share".startsWith("offline-cache-"));
  assert.match(
    source,
    /\.filter\(key => key\.startsWith\(cacheNamePrefix\) && key !== cacheName\)/,
    "die Aufräumregel in onActivate ist nicht mehr auf offline-cache-* beschränkt",
  );
});

test("Screenshots landen nicht im Offline-Cache, das App-Icon schon", async () => {
  // Die Screenshots sind nur für die Store-Einträge da und werden in der App
  // nie gezeigt. Über /\.png$/ wären sie bei JEDER Installation mitgeladen
  // worden — rund 1,5 MB, die niemand sieht.
  //
  // Geprüft am Verhalten von onInstall, nicht an den Mustern: die stehen als
  // `const` im Worker und wären von außen nicht sichtbar — ein Test, der sie
  // nachbaut, würde nur sich selbst prüfen.
  const { ctx, fetchCalls } = loadWorker({
    assets: [
      { url: `${ORIGIN}/index.html`, hash: "sha256-a" },
      { url: `${ORIGIN}/icon-512.png`, hash: "sha256-b" },
      { url: `${ORIGIN}/screenshots/wide-start.png`, hash: "sha256-c" },
      { url: `${ORIGIN}/screenshots/narrow-start.png`, hash: "sha256-d" },
    ],
  });
  await ctx.onInstall({});

  assert.ok(fetchCalls.some((u) => u.endsWith("/icon-512.png")), "das App-Icon fehlt im Offline-Cache");
  assert.ok(fetchCalls.some((u) => u.endsWith("/index.html")), "index.html fehlt im Offline-Cache");
  assert.deepEqual(
    fetchCalls.filter((u) => u.includes("/screenshots/")),
    [],
    "Screenshots werden bei jeder Installation mitgeladen",
  );
});

test("eine umgeleitete Antwort kommt nicht in den Cache", async () => {
  // Die Härtung aus c4b7bfb: eine Response mit redirected=true beantwortet eine
  // Navigation mit einem Netzwerkfehler. Lag sie im Cache, war die App für
  // wiederkehrende Besucher dauerhaft tot.
  //
  // Geprüft wird über addSanitized mit einem fetch, das WIRKLICH eine
  // umgeleitete Antwort liefert — sonst könnte der Test nicht rot werden.
  const { ctx } = loadWorker({
    fetchImpl: () => {
      const res = new Response("<html>neu</html>", { status: 200, headers: { "Content-Type": "text/html" } });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    },
  });
  const cache = await ctx.caches.open("offline-cache-v1");
  await ctx.addSanitized(cache, new Request(`${ORIGIN}/index.html`));

  const gecacht = await cache.match(`${ORIGIN}/index.html`);
  assert.ok(gecacht, "nichts gecacht");
  assert.equal(gecacht.redirected, false, "die umgeleitete Antwort liegt im Cache");
  assert.equal(await gecacht.text(), "<html>neu</html>", "der Inhalt ging verloren");
});

test("addSanitized cacht keine Fehlerantwort", async () => {
  const { ctx } = loadWorker({ fetchImpl: () => new Response("weg", { status: 404 }) });
  const cache = await ctx.caches.open("offline-cache-v1");
  await assert.rejects(() => ctx.addSanitized(cache, new Request(`${ORIGIN}/fehlt.js`)), /HTTP 404/);
  assert.equal(await cache.match(`${ORIGIN}/fehlt.js`), undefined);
});
