// =============================================================================
// TTS-Bridge — Seiten-Text per Web Speech API vorlesen (Barrierefreiheit).
// 100 % lokal (Browser-Stimmen), keine Dependency, kein Netz. Global
// `pageboundTts` (siehe esbuild.mjs). C#-Aufrufer: der Reader (Vorlesen).
// =============================================================================
const synth: SpeechSynthesis | undefined =
  typeof window !== "undefined" ? window.speechSynthesis : undefined;

export interface VoiceDto {
  name: string;
  uri: string;
  lang: string;
  isDefault: boolean;
}

export function isSupported(): boolean {
  return !!synth && typeof SpeechSynthesisUtterance !== "undefined";
}

export function listVoices(): VoiceDto[] {
  if (!synth) return [];
  return synth.getVoices().map((v) => ({
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
  const voice = voiceUri ? synth.getVoices().find((v) => v.voiceURI === voiceUri) : undefined;
  for (const c of chunks) {
    const u = new SpeechSynthesisUtterance(c);
    if (voice) u.voice = voice;
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
