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

function loadWorker({
  version = "v1",
  fetchImpl,
  assets = [{ url: "index.html", hash: "sha256-x" }],
  // Für den Rückfall in neueKennung(): eine Engine ohne crypto.randomUUID.
  // getRandomValues bleibt, das ist viel älter.
  ohneRandomUUID = false,
} = {}) {
  const calls = [];
  // Das ECHTE crypto, nicht ein gezähltes: eine Kennungsvergabe, die der
  // Prüfstand vorhersagen kann, prüft die Vergabe nicht mehr. Die Tests lesen
  // die Kennung aus der Umleitung — genau wie boot.js es tut.
  const echtesCrypto = {
    getRandomValues: (a) => globalThis.crypto.getRandomValues(a),
    randomUUID: () => globalThis.crypto.randomUUID(),
  };
  if (ohneRandomUUID) delete echtesCrypto.randomUUID;
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    URL, Response, Request, Headers, FormData, Blob, File,
    TypeError, Promise, Number, Math, RegExp, Date, String, Array, Uint8Array, isFinite,
    crypto: echtesCrypto,
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

/**
 * Eine Freigabe mit vorab gelesenem Formular. `formData()` löst dann als
 * Mikrotask auf, nicht erst in einem späteren Makrotask wie beim Lesen eines
 * echten Body-Streams — nur so verschränken sich zwei gleichzeitige Abläufe im
 * Prüfstand so wie im Browser (siehe den Wettlauf-Test unten).
 *
 * `headers.get` liefert immer null. So ist es gemessen: ein Service Worker
 * bekommt bei einer Formular-Navigation auf /share-target acht Header, und
 * Content-Length ist keiner davon (Nachtrag 4.3).
 */
function fakeShareRequest(form) {
  return {
    method: "POST",
    url: `${ORIGIN}/share-target`,
    headers: { get: () => null },
    formData: async () => form,
  };
}

/** Form einer Freigabe-Kennung (Nachtrag 4.1): UUID oder 32 Hexzeichen. */
const KENNUNG = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/;

/** Die Kennung aus der Umleitung — der Weg, den boot.js auch geht. */
function kennungAus(res) {
  return new URL(res.headers.get("location")).searchParams.get("share");
}

test("Freigabe: die Datei wird geparkt und auf /reader umgeleitet", async () => {
  const { ctx, fetchCalls } = loadWorker();
  const res = await ctx.onFetch({ request: shareRequest() });

  assert.equal(res.status, 303, "keine 303-Umleitung");
  const kennung = kennungAus(res);
  assert.match(kennung, KENNUNG, `keine Kennung in der Umleitung: ${kennung}`);
  // Der Kern: die Freigabe darf NICHT ins Netz gehen. Es gibt keinen Server,
  // der sie annehmen könnte — der GET-Ausstieg in onFetch würde genau das tun.
  assert.deepEqual(fetchCalls, [], "die Freigabe ging ins Netz");

  const store = shareStore(ctx);
  assert.deepEqual([...store.keys()], [`/__pb-share/${kennung}`], "falscher Schlüssel im Parkplatz");
  const parked = store.get(`/__pb-share/${kennung}`);
  assert.equal(parked.headers.get("X-Pagebound-Filename"), "geteilt.pdf");
  assert.match(await parked.text(), /^%PDF-/);
});

test("Freigabe: der Ablagezeitpunkt steht im Eintrag", async () => {
  // Ohne diesen Zeitstempel kann ein Start nicht unterscheiden, ob ein fremder
  // Eintrag eine Waise ist oder eine Freigabe, auf die gerade ein anderes
  // Fenster wartet — und löscht im Zweifel beides (Nachtrag 4.2).
  const vorher = Date.now();
  const { ctx } = loadWorker();
  const res = await ctx.onFetch({ request: shareRequest() });
  const eintrag = shareStore(ctx).get(`/__pb-share/${kennungAus(res)}`);
  const roh = eintrag.headers.get("X-Pagebound-Shared-At");
  assert.ok(roh, "kein Zeitstempel im Eintrag");
  const ms = Number(roh);
  assert.ok(Number.isFinite(ms), `Zeitstempel nicht lesbar: ${roh}`);
  assert.ok(ms >= vorher && ms <= Date.now(), `Zeitstempel liegt daneben: ${ms}`);
});

test("ohne crypto.randomUUID greift der Rückfall auf 32 Hexzeichen", async () => {
  // Der Rückfall ist im Vertrag benannt (Nachtrag 4.1), also muss boot.js auch
  // SEINE Form als Kennung erkennen. Ohne diesen Test wäre das eine Zeile, die
  // nie läuft, bis sie in einer alten Engine das erste Mal läuft.
  const { ctx } = loadWorker({ ohneRandomUUID: true });
  const res = await ctx.onFetch({ request: shareRequest() });
  const kennung = kennungAus(res);
  assert.match(kennung, /^[0-9a-f]{32}$/, `Rückfall liefert keine 32 Hexzeichen: ${kennung}`);
  assert.deepEqual([...shareStore(ctx).keys()], [`/__pb-share/${kennung}`]);
});

test("Freigabe: Dateiname mit Sonderzeichen übersteht den Header", async () => {
  // Ein Header darf keine Umlaute tragen; unkodiert wirft das oder liefert Müll.
  const { ctx } = loadWorker();
  const res = await ctx.onFetch({ request: shareRequest({ name: "Prüfung, Entwürfe.pdf" }) });
  const raw = shareStore(ctx).get(`/__pb-share/${kennungAus(res)}`).headers.get("X-Pagebound-Filename");
  assert.equal(decodeURIComponent(raw), "Prüfung, Entwürfe.pdf");
});

test("zwei Freigaben nacheinander bekommen eigene Schlüssel", async () => {
  // Mit einem festen Schlüssel überschrieb die zweite die erste, und die erste
  // war ohne eine Spur verloren.
  const { ctx } = loadWorker();
  const a = await ctx.onFetch({ request: shareRequest({ name: "eins.pdf" }) });
  const b = await ctx.onFetch({ request: shareRequest({ name: "zwei.pdf" }) });
  const ka = kennungAus(a), kb = kennungAus(b);
  assert.notEqual(ka, kb, "beide Freigaben bekamen dieselbe Kennung");
  const store = shareStore(ctx);
  assert.deepEqual([...store.keys()].sort(), [`/__pb-share/${ka}`, `/__pb-share/${kb}`].sort());
  assert.equal(
    decodeURIComponent(store.get(`/__pb-share/${ka}`).headers.get("X-Pagebound-Filename")),
    "eins.pdf",
    "die erste Freigabe wurde überschrieben",
  );
});

test("zwei Freigaben GLEICHZEITIG bekommen eigene Schlüssel", async () => {
  // Der Test oben sieht den Wettlauf nicht: mit `await` dazwischen ist die
  // erste längst fertig. Ein Service Worker bekommt die beiden Fetch-Events
  // aber ohne Pause, und an jedem `await` wechseln sie sich ab.
  //
  // Bis Nachtrag 4.1 war das ein echter Wettlauf: die Nummer kam aus
  // `max(vorhandene) + 1`, beide lasen dieselbe höchste Nummer, beide schrieben
  // denselben Schlüssel, eine Datei war weg. Eine Sperre hielt sie deshalb
  // hintereinander. Mit einer gezogenen Kennung gibt es nichts zu lesen und
  // nichts zu sperren — die Eigenschaft gilt von selbst. Der Test bleibt
  // trotzdem: er prüft die EIGENSCHAFT (zwei gleichzeitige Freigaben überleben
  // beide), nicht ihre frühere Umsetzung.
  //
  // Zwei echte `Request`-Objekte reichen dafür NICHT: `request.formData()`
  // liest einen Body-Stream und wird erst in einem späteren Makrotask fertig.
  // Gemessen (Reihenfolge der Schritte beider Abläufe):
  //     A:start B:start A:form A:open A:keys A:put B:form B:open B:keys B:put
  // A ist komplett durch, bevor B überhaupt sein Formular hat — keine
  // Verschränkung. Mit vorab gelesenem Formular (formData löst als Mikrotask
  // auf) verschränken sich die Abläufe wie im Browser:
  //     A:start B:start A:form B:form A:open B:open A:put B:put
  const { ctx } = loadWorker();
  const formulare = await Promise.all(
    ["eins.pdf", "zwei.pdf"].map((name) => shareRequest({ name }).formData()),
  );
  const anfragen = formulare.map((form) => fakeShareRequest(form));

  const antworten = await Promise.all(anfragen.map((request) => ctx.onFetch({ request })));
  const kennungen = antworten.map(kennungAus);
  assert.notEqual(kennungen[0], kennungen[1], "beide Freigaben bekamen dieselbe Kennung");

  const store = shareStore(ctx);
  assert.equal(store.size, 2, "eine der beiden gleichzeitigen Freigaben wurde überschrieben");
  assert.deepEqual(
    [...store.keys()].sort(),
    kennungen.map((k) => `/__pb-share/${k}`).sort(),
    "die Umleitungen nennen andere Schlüssel als der Parkplatz hat",
  );
  const namen = [...store.values()]
    .map((r) => decodeURIComponent(r.headers.get("X-Pagebound-Filename")))
    .sort();
  assert.deepEqual(namen, ["eins.pdf", "zwei.pdf"]);
});

test("eine Freigabe von fremder Herkunft wird abgewiesen, mit eigener Kennung", async () => {
  // Eine beliebige Website kann ein Formular auf /share-target absenden. Das
  // ist keine Freigabe, sondern eine fremde Datei mit einem Namen der Wahl des
  // Angreifers, die sich im Pagebound des Nutzers öffnen würde.
  const { ctx } = loadWorker();
  const res = await ctx.onFetch({ request: shareRequest({ von: "https://boese.example/seite" }) });
  assert.equal(res.status, 303, "soll weiterleiten, nicht scheitern");
  // Ohne eigene Kennung käme der Reader leer hoch: der Nutzer sieht, dass
  // nichts aufgeht, und erfährt nicht warum.
  assert.equal(res.headers.get("location"), `${ORIGIN}/reader?share=rejected`);
  assert.equal(shareStore(ctx), undefined, "die fremde Datei wurde geparkt");
});

test("BEKANNTE LÜCKE: ohne Verweis gilt eine fremde Freigabe als Freigabe des Geräts", async () => {
  // Dieser Test nagelt eine Lücke fest, nicht einen Schutz. Eine fremde Seite
  // kann ihr Formular mit referrerpolicy="no-referrer" abschicken; dann ist
  // `request.referrer` leer, und ein leerer Verweis MUSS als Betriebssystem
  // gelten — eine echte Freigabe hat keinen Verweis auf eine Seite.
  //
  // Sec-Fetch-Site hilft nicht: diese Header setzt der Browser erst nach dem
  // Service Worker. Die Herkunftsprüfung ist deshalb die erste Schranke, nicht
  // die einzige: die Datei wird wie jede Eingabe über
  // pageboundBoot.offer() nach MIME UND Magic Bytes geprüft, und der Reader
  // zeigt den Dateinamen. Was bleibt: eine gültige PDF, die der Nutzer nicht
  // gewählt hat, kann aufgehen.
  //
  // In Kauf genommen, siehe „Offen 2" in docs/contracts/datei-eintritt.md und
  // die Zeile zum Teilen-Ziel in SECURITY.md. Wird dort entschieden, eine
  // Rückfrage einzubauen, muss DIESER Test rot werden — dann ist er der
  // Hinweis, dass die Entscheidung umgesetzt gehört.
  const { ctx } = loadWorker();
  const form = await shareRequest({ name: "fremd.pdf" }).formData();
  const res = await ctx.onFetch({
    request: {
      method: "POST",
      url: `${ORIGIN}/share-target`,
      referrer: "",
      headers: { get: () => null },
      formData: async () => form,
    },
  });
  assert.match(kennungAus(res), KENNUNG, "heutiges Verhalten: die Freigabe wird angenommen");
  assert.ok(shareStore(ctx), "heutiges Verhalten: die Datei wird geparkt");
});

test("eine Freigabe von eigener Herkunft wird angenommen", async () => {
  const { ctx } = loadWorker();
  const res = await ctx.onFetch({ request: shareRequest({ von: `${ORIGIN}/reader` }) });
  assert.deepEqual([...shareStore(ctx).keys()], [`/__pb-share/${kennungAus(res)}`]);
});

test("die Android-App (TWA) teilt mit einem android-app://-Verweis und wird angenommen", async () => {
  // Der Punkt dieses Tests. Chrome gibt einer Trusted Web Activity den Verweis
  // `android-app://<paket>/` — und dessen `URL.origin` ist "null", also immer
  // ungleich der eigenen Origin. Eine Herkunftsprüfung, die nur
  // `origin !== self.origin` fragt, weist damit JEDE Freigabe in genau der
  // Play-Fassung ab, um die es in diesem Meilenstein geht. Im Browser fällt das
  // nicht auf, weil es dort keinen solchen Verweis gibt.
  const { ctx } = loadWorker();
  const res = await ctx.onFetch({
    request: shareRequest({ name: "von-android.pdf", von: "android-app://de.pagebound.app/" }),
  });
  const kennung = kennungAus(res);
  assert.match(kennung, KENNUNG, "die Freigabe der eigenen App wurde abgewiesen");
  const store = shareStore(ctx);
  assert.ok(store, "nichts geparkt — die App bekäme einen leeren Reader");
  assert.equal(
    decodeURIComponent(store.get(`/__pb-share/${kennung}`).headers.get("X-Pagebound-Filename")),
    "von-android.pdf",
  );
});

test("eine zu große Freigabe wird nicht abgelegt", async () => {
  // Grenze VOR dem Ablegen: sonst wandert eine 1-GB-Datei vollständig in den
  // Cache Storage, nur damit boot.js sie danach wegen Übergröße ablehnt — auf
  // einem Telefon kostet das Speicher, Kontingent und Zeit, und das Kontingent
  // bleibt belegt, wenn der Reader nie hochkommt.
  //
  // Die Datei wird nicht wirklich angelegt (200 MB im Test wären unsinnig),
  // sondern ihre `size` überschrieben — genau der Wert, den der Worker liest.
  const { ctx } = loadWorker();
  const echt = shareRequest({ name: "riesig.pdf" });
  const form = await echt.formData();
  const datei = form.getAll("file")[0];
  Object.defineProperty(datei, "size", { value: 200 * 1024 * 1024, configurable: true });
  assert.equal(datei.size, 200 * 1024 * 1024, "size ließ sich nicht überschreiben — der Test prüft nichts");
  // Ohne Content-Length: so greift genau die Prüfung an der echten Größe.
  const res = await ctx.onFetch({ request: fakeShareRequest(form) });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), `${ORIGIN}/reader?share=toobig`);
  assert.equal(shareStore(ctx)?.size ?? 0, 0, "die zu große Datei liegt im Cache Storage");
});

test("eine Freigabe knapp unter der Grenze wird abgelegt", async () => {
  // Gegenstück: die Grenze darf nicht alles abweisen.
  const { ctx } = loadWorker();
  const echt = shareRequest({ name: "knapp.pdf" });
  const form = await echt.formData();
  Object.defineProperty(form.getAll("file")[0], "size", {
    value: 100 * 1024 * 1024 - 1,
    configurable: true,
  });
  const res = await ctx.onFetch({ request: fakeShareRequest(form) });
  const kennung = kennungAus(res);
  assert.match(kennung, KENNUNG);
  assert.deepEqual([...shareStore(ctx).keys()], [`/__pb-share/${kennung}`]);
});

test("ein fremdes Schema gilt nicht als Gerät", async () => {
  // Nachtrag 3.2. „Jedes Schema außer http(s) ist das Betriebssystem" war zu
  // weit offen: damit zählte auch eine Browser-Erweiterung als Gerät. Benannt
  // ist nur android-app: — kommt ein Auslieferungsweg hinzu, wird sein Schema
  // eingetragen und geprüft, nicht stillschweigend mitgenommen.
  const { ctx } = loadWorker();
  for (const ref of ["chrome-extension://abcdefghijklmnop/seite.html", "file:///C:/tmp/seite.html"]) {
    const res = await ctx.onFetch({
      request: {
        method: "POST",
        url: `${ORIGIN}/share-target`,
        referrer: ref,
        headers: { get: () => null },
        formData: async () => { throw new Error("darf nicht gelesen werden"); },
      },
    });
    assert.equal(res.headers.get("location"), `${ORIGIN}/reader?share=rejected`, `durchgelassen: ${ref}`);
  }
  assert.equal(shareStore(ctx), undefined, "eine fremde Datei wurde geparkt");
});

test("ein unlesbarer Verweis gilt nicht als Gerät", async () => {
  // Der Zweifel fällt gegen die Freigabe. Vorher war ein Verweis, den
  // `new URL()` nicht lesen kann, vertrauenswürdig — der Vorgabewert war offen.
  const { ctx } = loadWorker();
  const res = await ctx.onFetch({
    request: {
      method: "POST",
      url: `${ORIGIN}/share-target`,
      referrer: ":::kein-url:::",
      headers: { get: () => null },
      formData: async () => { throw new Error("darf nicht gelesen werden"); },
    },
  });
  assert.equal(res.headers.get("location"), `${ORIGIN}/reader?share=rejected`);
});

test("die Umleitung nennt die Kennung DIESER Freigabe", async () => {
  // Nachtrag 3.1: ohne die Kennung holte boot.js „alles, was herumliegt" ab und
  // öffnete die älteste Freigabe. Jede Freigabe braucht ihre eigene Kennung,
  // und die Umleitung muss auf GENAU deren Eintrag zeigen.
  const { ctx } = loadWorker();
  const erste = await ctx.onFetch({ request: shareRequest({ name: "eins.pdf" }) });
  const zweite = await ctx.onFetch({ request: shareRequest({ name: "zwei.pdf" }) });
  const k1 = kennungAus(erste), k2 = kennungAus(zweite);
  assert.notEqual(k1, k2, "beide Umleitungen zeigen auf denselben Eintrag");
  const store = shareStore(ctx);
  assert.equal(
    decodeURIComponent(store.get(`/__pb-share/${k1}`).headers.get("X-Pagebound-Filename")),
    "eins.pdf",
  );
  assert.equal(
    decodeURIComponent(store.get(`/__pb-share/${k2}`).headers.get("X-Pagebound-Filename")),
    "zwei.pdf",
  );
});

test("keine Kennung lässt sich aus einer anderen ableiten", async () => {
  // Der Grund, warum die laufende Nummer weg ist (Nachtrag 4.1): bei einer
  // Nummer konnte jeder die nächste und die vorige erraten — ein Link auf
  // `/reader?share=999` löschte dann jeden Eintrag mit kleinerer Nummer, und
  // eine stehengebliebene Adresse griff nach einer fremden Freigabe. Dieser
  // Test würde rot, wenn jemand zur Berechenbarkeit zurückkehrt (Zähler,
  // Zeitstempel als Kennung, Hash über den Dateinamen).
  const { ctx } = loadWorker();
  const kennungen = [];
  for (let i = 0; i < 5; i++) {
    kennungen.push(kennungAus(await ctx.onFetch({ request: shareRequest({ name: `d${i}.pdf` }) })));
  }
  assert.equal(new Set(kennungen).size, 5, `Kennungen wiederholen sich: ${kennungen.join(", ")}`);
  for (const k of kennungen) assert.match(k, KENNUNG, `keine Kennung: ${k}`);
  // Keine zwei aufeinanderfolgenden unterscheiden sich in nur einem Zeichen —
  // so sähe ein Zähler aus, auch ein als Hex geschriebener.
  for (let i = 1; i < kennungen.length; i++) {
    const a = kennungen[i - 1], b = kennungen[i];
    let gleich = 0;
    for (let j = 0; j < Math.min(a.length, b.length); j++) if (a[j] === b[j]) gleich++;
    assert.ok(
      a.length - gleich > 4,
      `aufeinanderfolgende Kennungen sind fast gleich — gezählt statt gezogen? ${a} / ${b}`,
    );
  }
});

test("genau an der Grenze wird eine Freigabe noch angenommen", async () => {
  // Das Verhalten AN der Grenze, nicht knapp darunter: 100 MiB − 1 läuft mit `>`
  // und mit `>=` durch, der Test unterscheidet die beiden also nicht. Genau
  // 100 MiB tut es. Festgelegt ist: die Grenze selbst ist erlaubt (`>`), hier
  // wie in boot.js und in ReaderPane.MaxFileSize.
  //
  // Geprüft am VERHALTEN, nicht an einem Regex auf den Quelltext: ein Regex
  // würde eine zweite Schranke an anderer Stelle oder einen umformulierten
  // Vergleich nicht sehen. Die Datei wird nicht wirklich angelegt, nur ihre
  // `size` überschrieben — genau der Wert, den der Worker liest.
  const { ctx } = loadWorker();
  const form = await shareRequest({ name: "genau.pdf" }).formData();
  const datei = form.getAll("file")[0];
  Object.defineProperty(datei, "size", { value: 100 * 1024 * 1024, configurable: true });
  assert.equal(datei.size, 100 * 1024 * 1024, "size ließ sich nicht überschreiben — der Test prüft nichts");

  const res = await ctx.onFetch({ request: fakeShareRequest(form) });
  const kennung = kennungAus(res);
  assert.match(kennung, KENNUNG, "genau die Grenze wurde abgewiesen");
  assert.deepEqual([...shareStore(ctx).keys()], [`/__pb-share/${kennung}`]);
});

test("ein Byte über der Grenze wird abgewiesen", async () => {
  // Das Gegenstück: die Grenze muss überhaupt greifen.
  const { ctx } = loadWorker();
  const form = await shareRequest({ name: "einsdrueber.pdf" }).formData();
  Object.defineProperty(form.getAll("file")[0], "size", {
    value: 100 * 1024 * 1024 + 1,
    configurable: true,
  });
  const res = await ctx.onFetch({ request: fakeShareRequest(form) });
  assert.equal(res.headers.get("location"), `${ORIGIN}/reader?share=toobig`);
  assert.equal(shareStore(ctx)?.size ?? 0, 0);
});

test("die Grenze steht in allen drei Schichten auf derselben Zahl", () => {
  // Quelltextvergleich, und das ist hier die einzige Möglichkeit: die dritte
  // Schicht ist C#. Entscheidend ist, dass der Test die dritte Stelle wirklich
  // ansieht — vorher hieß er „und im Reader", ohne ReaderPane je zu öffnen.
  assert.match(source, /const shareMaxBytes = 100 \* 1024 \* 1024;/);
  const boot = readFileSync(join(resolve(here, ".."), "wwwroot", "js", "boot.js"), "utf8");
  assert.match(boot, /MAX_BYTES\s*=\s*100 \* 1024 \* 1024/);

  const reader = readFileSync(
    join(resolve(here, ".."), "Features", "Reader", "ReaderPane.razor"),
    "utf8",
  );
  // C#-Literale dürfen Suffixe (100L) und Unterstriche (100_000) tragen; beides
  // wird entfernt, dann wird das Produkt ausgerechnet — ohne eval.
  const treffer = /MaxFileSize\s*=\s*([0-9_LlUu\s*]+);/.exec(reader);
  assert.ok(treffer, "ReaderPane.MaxFileSize nicht gefunden — umbenannt? Dann hier mitziehen.");
  const faktoren = treffer[1]
    .replace(/[_LlUu\s]/g, "")
    .split("*")
    .map(Number);
  assert.ok(faktoren.every(Number.isFinite), `MaxFileSize nicht lesbar: ${treffer[1].trim()}`);
  const wert = faktoren.reduce((a, b) => a * b, 1);
  assert.equal(wert, 100 * 1024 * 1024, `ReaderPane.MaxFileSize ist ${wert}, nicht 100 MiB`);
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
