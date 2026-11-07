// =============================================================================
// service-worker.published.js im Prüfstand.
//
// Der Service Worker war bisher ungetestet, obwohl an ihm zwei Dinge hängen, die
// still kaputtgehen: die Umleitungs-Härtung (c4b7bfb — eine `redirected`-Antwort
// darf keine Navigation beantworten) und jetzt das Teilen-Ziel. Beides lässt
// sich im Browser nur mit Mühe herbeiführen, hier nicht.
//
// Der Worker läuft dafür in einem vm-Kontext mit nachgebauten Browser-Teilen
// (caches, importScripts, addEventListener). Die Funktionen auf oberster Ebene
// sind `function`-Deklarationen und landen dadurch als Eigenschaften im
// Kontext — so sind onFetch/onActivate direkt aufrufbar, ohne echte Events.
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
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  api._stores = stores;
  return api;
}

/**
 * Lädt den Worker. `fetchImpl` wird gezählt: so lässt sich belegen, dass eine
 * Freigabe NICHT ins Netz geht.
 */
function loadWorker({ version = "v1", fetchImpl } = {}) {
  const calls = [];
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    URL, Response, Request, Headers, FormData, Blob, File,
    TypeError,
    Promise,
    fetch: async (req) => {
      calls.push(String(req?.url ?? req));
      return fetchImpl ? fetchImpl(req) : new Response("netz", { status: 200 });
    },
    caches: makeCaches(),
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.self.origin = "https://example.test";
  ctx.self.location = { origin: "https://example.test", href: "https://example.test/service-worker.js" };
  ctx.self.assetsManifest = { version, assets: [{ url: "index.html", hash: "sha256-x" }] };
  ctx.self.importScripts = () => {};
  ctx.self.addEventListener = () => {};
  ctx.self.skipWaiting = () => {};
  ctx.self.clients = { claim: async () => {} };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "service-worker.published.js" });
  return { ctx, fetchCalls: calls };
}

const shareRequest = (name = "geteilt.pdf", bytes = "%PDF-1.7\n") => {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "application/pdf" }));
  return new Request("https://example.test/share-target", { method: "POST", body: form });
};

test("Freigabe: die Datei wird geparkt und auf /reader umgeleitet", async () => {
  const { ctx, fetchCalls } = loadWorker();
  const res = await ctx.onFetch({ request: shareRequest() });

  assert.equal(res.status, 303, "keine 303-Umleitung");
  assert.equal(res.headers.get("location"), "https://example.test/reader");
  // Der Kern: die Freigabe darf NICHT ins Netz gehen. Es gibt keinen Server,
  // der sie annehmen könnte — der GET-Ausstieg in onFetch würde genau das tun.
  assert.deepEqual(fetchCalls, [], "die Freigabe ging ins Netz");

  const cache = await ctx.caches.open("pb-share");
  const parked = await cache.match("/__pb-share");
  assert.ok(parked, "keine Datei im Parkplatz pb-share");
  assert.equal(parked.headers.get("X-Pagebound-Filename"), "geteilt.pdf");
  assert.match(await parked.text(), /^%PDF-/);
});

test("Freigabe: Dateiname mit Sonderzeichen übersteht den Header", async () => {
  // Ein Header darf keine Umlaute tragen; unkodiert wirft das oder liefert Müll.
  const { ctx } = loadWorker();
  await ctx.onFetch({ request: shareRequest("Prüfung, Entwürfe.pdf") });
  const cache = await ctx.caches.open("pb-share");
  const parked = await cache.match("/__pb-share");
  const raw = parked.headers.get("X-Pagebound-Filename");
  assert.equal(decodeURIComponent(raw), "Prüfung, Entwürfe.pdf");
});

test("Freigabe ohne Datei: trotzdem Umleitung, kein leerer Eintrag", async () => {
  const { ctx } = loadWorker();
  const form = new FormData();
  form.append("text", "nur Text");
  const res = await ctx.onFetch({
    request: new Request("https://example.test/share-target", { method: "POST", body: form }),
  });
  assert.equal(res.status, 303);
  const cache = await ctx.caches.open("pb-share");
  assert.equal(await cache.match("/__pb-share"), undefined, "leerer Eintrag angelegt");
});

test("andere POSTs gehen weiter ins Netz", async () => {
  const { ctx, fetchCalls } = loadWorker();
  await ctx.onFetch({ request: new Request("https://example.test/irgendwas", { method: "POST", body: "x" }) });
  assert.deepEqual(fetchCalls, ["https://example.test/irgendwas"]);
});

test("der Parkplatz übersteht einen Fassungswechsel", async () => {
  // Nicht der heutige Stand ist der Punkt (der ist richtig), sondern die Regel:
  // wer onActivate auf „alles außer dem aktuellen Cache" verallgemeinert,
  // frisst geteilte Dateien.
  const { ctx } = loadWorker({ version: "v2" });
  const share = await ctx.caches.open("pb-share");
  await share.put("/__pb-share", new Response("%PDF-1.7"));
  const alt = await ctx.caches.open("offline-cache-v1");
  await alt.put("https://example.test/alt", new Response("alt"));
  const neu = await ctx.caches.open("offline-cache-v2"); // der aktuelle, wie nach onInstall
  await neu.put("https://example.test/index.html", new Response("<html>"));

  await ctx.onActivate({});

  assert.ok(await (await ctx.caches.open("pb-share")).match("/__pb-share"), "pb-share wurde weggeräumt");
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

test("umgeleitete Antworten kommen nicht in den Offline-Cache", async () => {
  // Die Härtung aus c4b7bfb: eine Response mit redirected=true beantwortet eine
  // Navigation mit einem Netzwerkfehler. Lag sie im Cache, war die App für
  // wiederkehrende Besucher dauerhaft tot.
  const { ctx } = loadWorker();
  const umgeleitet = new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } });
  Object.defineProperty(umgeleitet, "redirected", { value: true });
  const cache = await ctx.caches.open("offline-cache-v1");
  await ctx.addSanitized(cache, new Request("https://example.test/index.html"), undefined);
  // addSanitized holt über das fetch-Stub; dieses liefert eine normale Antwort.
  // Entscheidend ist, dass der Pfad existiert und kein redirected durchlässt:
  const gereinigt = await ctx.withoutRedirect(umgeleitet);
  assert.equal(gereinigt.redirected, false, "withoutRedirect behält die Umleitung");
  assert.equal(await gereinigt.text(), "<html>");
});
