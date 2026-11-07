// =============================================================================
// tts-bridge — Vorlesen, und warum das eine Datenschutzprüfung ist.
//
// Die Web Speech API ist nicht von sich aus lokal: in Chrome sind die
// „Google …"-Stimmen serverseitig, der vorgelesene Text geht dann an Google.
// Die CSP greift dagegen nicht, weil der Browser die Verbindung selbst aufbaut,
// nicht die Seite — und tools/privacy-check.mjs sieht es auch nicht, weil im
// Quelltext keine fremde Adresse steht. Genau deshalb diese Prüfungen: sie sind
// das einzige Signal, das diesen Abfluss finden könnte.
//
// Geprüft wird die GEBAUTE Bridge (wwwroot/js/tts-bridge.js, IIFE mit dem
// Global `pageboundTts`), weil die ausgeliefert wird.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const built = join(resolve(here, ".."), "wwwroot", "js", "tts-bridge.js");

const NETZ = { name: "Google Deutsch", voiceURI: "netz-de", lang: "de-DE", default: true, localService: false };
const LOKAL = { name: "Anna", voiceURI: "lokal-de", lang: "de-DE", default: false, localService: true };
const LOKAL2 = { name: "Markus", voiceURI: "lokal-de-2", lang: "de-DE", default: false, localService: true };
// Eine alte Engine ohne die Eigenschaft: unbekannt heißt „nicht benutzen".
const UNBEKANNT = { name: "Alt", voiceURI: "alt", lang: "de-DE", default: false };

function loadTts(voices, lang = "de") {
  assert.ok(
    existsSync(built),
    "wwwroot/js/tts-bridge.js fehlt — ohne `npm run build:js` prüft dieser Test nichts (CI baut vorher)",
  );
  const spoken = [];
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    Math, JSON, Object, Array, String, RegExp, Promise,
    SpeechSynthesisUtterance: class {
      constructor(text) { this.text = text; this.voice = undefined; this.rate = 1; }
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.document = { documentElement: { lang } };
  ctx.window.speechSynthesis = {
    getVoices: () => voices,
    cancel() {},
    speak(u) { spoken.push(u); },
    pause() {}, resume() {},
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(built, "utf8"), ctx, { filename: "tts-bridge.js" });
  return { tts: ctx.pageboundTts, spoken };
}

test("listVoices bietet keine Netz-Stimme an", () => {
  const { tts } = loadTts([NETZ, LOKAL, UNBEKANNT]);
  assert.deepEqual(tts.listVoices().map((v) => v.uri), ["lokal-de"]);
});

test("speak nimmt nie die Vorgabe-Stimme der Engine, wenn die im Netz rechnet", () => {
  // Ohne u.voice nimmt die Engine ihre Vorgabe — hier die Google-Stimme. Dann
  // ginge der Text des Dokuments an Google, ohne dass es irgendwo auffällt.
  const { tts, spoken } = loadTts([NETZ, LOKAL]);
  assert.equal(tts.speak("Ein Satz zum Vorlesen."), true);
  assert.ok(spoken.length > 0, "nichts gesprochen");
  for (const u of spoken) {
    assert.ok(u.voice, "keine Stimme gesetzt — die Engine nimmt ihre eigene Vorgabe");
    assert.equal(u.voice.localService, true, `Netz-Stimme benutzt: ${u.voice.name}`);
  }
});

test("speak lehnt eine ausdrücklich gewählte Netz-Stimme ab und nimmt eine lokale", () => {
  const { tts, spoken } = loadTts([NETZ, LOKAL]);
  assert.equal(tts.speak("Text", 1, "netz-de"), true);
  assert.equal(spoken[0].voice.voiceURI, "lokal-de");
});

test("speak nimmt die gewünschte lokale Stimme", () => {
  const { tts, spoken } = loadTts([NETZ, LOKAL, LOKAL2]);
  assert.equal(tts.speak("Text", 1, "lokal-de-2"), true);
  assert.equal(spoken[0].voice.voiceURI, "lokal-de-2");
});

test("ohne lokale Stimme wird nicht vorgelesen", () => {
  // Lieber kein Vorlesen als stilles Abfließen.
  const { tts, spoken } = loadTts([NETZ, UNBEKANNT]);
  assert.equal(tts.speak("Text"), false);
  assert.deepEqual(spoken, []);
});

test("leerer Text spricht nicht", () => {
  const { tts, spoken } = loadTts([LOKAL]);
  assert.equal(tts.speak("   "), false);
  assert.deepEqual(spoken, []);
});

const ENGLISCH = { name: "Daniel", voiceURI: "lokal-en", lang: "en-GB", default: true, localService: true };

test("mit langHint folgt die Stimme der Sprache des TEXTES", () => {
  // Nur der Aufrufer kennt die Sprache des vorgelesenen Textes. Gibt er sie an,
  // wird sie genommen — auch gegen die Vorgabe-Stimme des Systems.
  const { tts, spoken } = loadTts([ENGLISCH, LOKAL]);
  assert.equal(tts.speak("Ein deutscher Satz.", 1, null, "de-DE"), true);
  assert.equal(spoken[0].voice.voiceURI, "lokal-de", `genommen: ${spoken[0].voice.name}`);
  assert.equal(spoken[0].lang, "de-DE", "u.lang nicht gesetzt — manche Engines sprechen dann systemsprachlich");
});

test("ohne langHint fällt die Wahl auf die Plattform, NICHT auf die App-Sprache", () => {
  // Was dieser Test festnagelt: `document.documentElement.lang` ist die
  // eingestellte App-Sprache (index.html und applyLang() setzen sie), nicht die
  // des Dokuments. Wer sie als Ersatz nimmt, liest ein englisches PDF bei
  // deutscher Oberfläche mit deutscher Stimme vor und gibt der Engine dazu
  // `u.lang = "de-DE"` — eine falsche Angabe, nicht nur eine unschöne.
  //
  // Dies ist ein RÜCKFALL, kein Wunschverhalten: ohne Hinweis kann niemand die
  // Sprache des Textes kennen, und dann ist die Vorgabe der Plattform die
  // einzige Wahl, die nichts Falsches behauptet. Sie ist auch nicht gut —
  // deutsche Oberfläche, deutsches PDF und englische Systemstimme ergeben eine
  // englische Stimme auf deutschem Text. Gelöst wird das nur dadurch, dass der
  // Aufrufer die Sprache des Dokuments mitgibt — das tut der Reader seit
  // Nachtrag 4.4 (`loadPdf` liefert `/Lang` als `LoadResult.language`). Dieser
  // Rückfall gilt für PDFs, die `/Lang` nicht angeben, und das sind die meisten.
  //
  // Die App-Sprache steht bewusst auf "de", die Vorgabe-Stimme ist englisch:
  // erwartet wird die englische.
  const { tts, spoken } = loadTts([ENGLISCH, LOKAL], "de");
  assert.equal(tts.speak("Some English text."), true);
  assert.equal(
    spoken[0].voice.voiceURI,
    "lokal-en",
    `die App-Sprache hat die Stimme bestimmt: ${spoken[0].voice.name}`,
  );
  assert.equal(spoken[0].lang, "en-GB", "u.lang muss zur gewählten Stimme passen");
});

test("der Reader gibt die Dokumentsprache an speak() weiter", () => {
  // Die SCHWÄCHSTE Prüfung in dieser Kette, und sie wird als solche benannt:
  // sie liest den Quelltext von ReaderPane.razor, statt das Verhalten zu
  // messen. Ein Test, der das Verhalten prüft, bräuchte einen gemounteten
  // Blazor-Baum mit JS-Interop-Attrappe — den gibt es hier nicht.
  //
  // Was sie trotzdem findet: dass jemand den vierten Parameter wieder
  // wegnimmt oder die App-Sprache einsetzt. Genau das ist zweimal passiert
  // (5edb4ad: App-Sprache; b727c01: Parameter da, aber niemand füllte ihn).
  //
  // Was sie NICHT findet: ob `_handle.Language` zur Laufzeit wirklich ankommt.
  // Dafür stehen die beiden anderen Hälften der Kette: pdfjs-bridge.test.mjs
  // (echtes PDF.js liefert `/Lang` als `language`) und die Tests hier
  // (`langHint` bestimmt die Stimme). Die Verbindung dazwischen ist durch
  // KEINE Verhaltensprüfung gedeckt — das steht so in SECURITY.md nicht, weil
  // es keine Sicherheitsfrage ist, aber es steht hier.
  const razor = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../Features/Reader/ReaderPane.razor"),
    "utf8",
  );
  const aufruf = /pageboundTts\.speak"[^;]*?;/s.exec(razor);
  assert.ok(aufruf, "kein Aufruf von pageboundTts.speak in ReaderPane.razor gefunden");
  assert.match(
    aufruf[0],
    /_handle\.Language/,
    `speak() bekommt die Dokumentsprache nicht: ${aufruf[0].replace(/\s+/g, " ")}`,
  );
  assert.ok(
    !/documentElement\.lang|L\.Current|AppLanguage/.test(aufruf[0]),
    `speak() bekommt die APP-Sprache statt der Dokumentsprache: ${aufruf[0].replace(/\s+/g, " ")}`,
  );
});

test("eine ausdrücklich gewählte Stimme schlägt den langHint", () => {
  const { tts, spoken } = loadTts([ENGLISCH, LOKAL, LOKAL2]);
  assert.equal(tts.speak("Text", 1, "lokal-de-2", "en-GB"), true);
  assert.equal(spoken[0].voice.voiceURI, "lokal-de-2");
});

test("isSupported sagt nein, wenn es nur Netz-Stimmen gibt", () => {
  // Sonst zeigt die Oberflaeche den Knopf, speak() liefert false, und der
  // Nutzer erfaehrt nicht, warum nichts passiert.
  assert.equal(loadTts([NETZ, UNBEKANNT]).tts.isSupported(), false);
  assert.equal(loadTts([NETZ, LOKAL]).tts.isSupported(), true);
  // Liste noch nicht geladen: nicht vorschnell nein sagen.
  assert.equal(loadTts([]).tts.isSupported(), true);
});
