// =============================================================================
// TTS-Bridge — Seiten-Text per Web Speech API vorlesen (Barrierefreiheit).
// Global `pageboundTts` (siehe esbuild.mjs). C#-Aufrufer: der Reader (Vorlesen).
//
// WICHTIG, und der Grund für localVoices() unten: die Web Speech API ist NICHT
// von sich aus lokal. In Chrome sind die „Google …"-Stimmen serverseitig — der
// vorgelesene Text geht dann an Google. Die CSP greift dagegen nicht, weil der
// Browser die Verbindung selbst aufbaut, nicht die Seite. Das wäre ein Bruch
// der Kernzusage (SECURITY.md: keine Anfrage an Dritte), und zwar der
// unauffälligste: es funktioniert ja.
//
// Deshalb werden ausschließlich Stimmen angeboten UND benutzt, die
// `localService === true` melden. Fehlt die Eigenschaft (alte Engine), wird die
// Stimme nicht angeboten — lieber kein Vorlesen als stilles Abfließen.
// =============================================================================
const synth: SpeechSynthesis | undefined =
  typeof window !== "undefined" ? window.speechSynthesis : undefined;

export interface VoiceDto {
  name: string;
  uri: string;
  lang: string;
  isDefault: boolean;
}

/** Nur Stimmen, die im Gerät rechnen. Alles andere schickt den Text weg. */
function localVoices(): SpeechSynthesisVoice[] {
  if (!synth) return [];
  return synth.getVoices().filter((v) => v.localService === true);
}

export function isSupported(): boolean {
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;
  const alle = synth.getVoices();
  // Beim ersten Aufruf ist die Liste oft noch leer (sie kommt asynchron) —
  // dann gilt es als unterstützt, speak() entscheidet später erneut.
  if (alle.length === 0) return true;
  // Liste da, aber keine lokale Stimme: speak() würde false liefern und der
  // Knopf wäre wirkungslos, ohne dass der Nutzer erfährt warum. Dann lieber
  // nein sagen, damit die Oberfläche ihn gar nicht anbietet.
  return alle.some((v) => v.localService === true);
}

export function listVoices(): VoiceDto[] {
  return localVoices().map((v) => ({
    name: v.name,
    uri: v.voiceURI,
    lang: v.lang,
    isDefault: v.default,
  }));
}

// Text in überschaubare Stücke aufteilen — an Satzenden, lange Sätze weiter
// zerteilt (manche Engines schneiden zu lange Utterances ab / hängen).
function chunk(text: string): string[] {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  for (const sentence of clean.split(/(?<=[.!?…])\s+/)) {
    if (sentence.length <= 200) {
      out.push(sentence);
    } else {
      for (let i = 0; i < sentence.length; i += 200) out.push(sentence.slice(i, i + 200));
    }
  }
  return out;
}

/** Startet das Vorlesen (bricht Laufendes ab). Gibt false, wenn nicht unterstützt/leer. */
export function speak(text: string, rate?: number, voiceUri?: string | null): boolean {
  if (!synth || !isSupported()) return false;
  synth.cancel();
  const chunks = chunk(text);
  if (chunks.length === 0) return false;
  // Die Stimme wird IMMER gesetzt. Ohne u.voice nimmt die Engine ihre Vorgabe —
  // und die ist je nach Plattform eine Netz-Stimme. Gibt es keine lokale, wird
  // nicht vorgelesen.
  const lokal = localVoices();
  if (lokal.length === 0) return false;
  const gewuenscht = voiceUri ? lokal.find((v) => v.voiceURI === voiceUri) : undefined;
  // Ohne ausdrückliche Wahl die Sprache des Dokuments bevorzugen: die
  // „default"-Stimme des Systems ist die des Systems, nicht die des Textes —
  // ein deutsches Dokument wurde sonst mit englischer Stimme vorgelesen.
  const wunschLang = (typeof document !== "undefined" ? document.documentElement.lang : "") || "";
  const passend = wunschLang
    ? lokal.find((v) => v.lang && v.lang.toLowerCase().startsWith(wunschLang.toLowerCase().slice(0, 2)))
    : undefined;
  const voice = gewuenscht ?? passend ?? lokal.find((v) => v.default) ?? lokal[0];
  for (const c of chunks) {
    const u = new SpeechSynthesisUtterance(c);
    u.voice = voice;
    // lang mitgeben: manche Engines ignorieren voice.lang und nehmen sonst die
    // Systemsprache für die Aussprache.
    u.lang = voice.lang;
    if (rate && rate > 0) u.rate = Math.min(2, Math.max(0.5, rate));
    synth.speak(u);
  }
  return true;
}

export function pause(): void {
  synth?.pause();
}

export function resume(): void {
  synth?.resume();
}

export function cancel(): void {
  synth?.cancel();
}

export function isSpeaking(): boolean {
  return !!synth && (synth.speaking || synth.pending);
}
