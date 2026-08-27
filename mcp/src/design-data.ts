// =============================================================================
// Datenbindung für Design-Dokumente: ein JSON-Objekt füllt die {{platzhalter}}
// einer Vorlage. Gedacht für Dokumente, die ein Programm im Hintergrund
// erzeugt — Rechnungen, Bestätigungen, Serienbriefe.
//
// Drei Bausteine, alle im Designmodell und nicht in einer eigenen Sprache:
//   • {{pfad.zum.wert}}   — verschachtelte Werte, Listenindex per Zahl.
//   • block.when / .unless — Block nur zeichnen, wenn ein Wert gesetzt ist.
//     Damit passen Fälle, die sich ausschließen (Kleinunternehmer nach § 19
//     UStG vs. Regelbesteuerung), in EIN Dokument statt in zwei Vorlagen, die
//     mit der Zeit auseinanderlaufen.
//   • block.repeat        — Block bzw. Tabellenzeile je Listeneintrag.
//
// GRUNDSATZ ZU FEHLENDEN WERTEN: ein Platzhalter ohne Wert bleibt NICHT still
// leer. Auf einer Rechnung ist ein fehlendes Feld ein Fehler, kein
// Gestaltungsmittel — deshalb wird jeder unbesetzte Platzhalter mit Fundort
// gemeldet, und der Aufrufer entscheidet zwischen Abbruch und Bericht.
//
// Werte werden beim Einsetzen HTML-maskiert: ein Kundenname mit '<' darf das
// Dokument nicht zerlegen. Wer Auszeichnung braucht, baut sie in die Vorlage,
// nicht in die Daten.
// =============================================================================
import { EditorBlock, EditorDocument, EditorOverlay, EditorPage } from "./design.js";
import { ToolError } from "./pdf.js";

export interface MissingValue {
  /** Der Pfad, wie er in der Vorlage steht, z. B. "kunde.anschrift.ort". */
  placeholder: string;
  /** Fundort, z. B. "Seite 1 / Table / Zeile 2, Spalte 3". */
  where: string;
}

export interface MergeResult {
  doc: EditorDocument;
  /** Platzhalter ohne Wert, in Dokumentreihenfolge, ohne Dubletten. */
  missing: MissingValue[];
  /** Strukturelle Hinweise (leere Listen, entfallene Blöcke). */
  notes: string[];
}

export interface MergeOptions {
  /**
   * "error" (Default): fehlende Werte führen zum Abbruch mit Nennung der
   * Platzhalter. "report": das Dokument wird gefüllt, die Lücken stehen im
   * Ergebnis — der Aufrufer entscheidet.
   */
  onMissing?: "error" | "report";
}

const TOKEN = /\{\{\s*([A-Za-z0-9_.\-#]+)\s*\}\}/g;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Json = unknown;

/** Ein Segment eines Pfads auflösen — exakt, sonst ohne Rücksicht auf Groß/Klein. */
function step(value: Json, key: string): Json {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const idx = Number(key);
    return Number.isInteger(idx) && idx >= 0 ? value[idx] : undefined;
  }
  if (typeof value !== "object") return undefined;
  const obj = value as Record<string, Json>;
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lower) return obj[k];
  return undefined;
}

function resolvePath(root: Json, path: string): Json {
  let cur = root;
  for (const seg of path.split(".")) {
    cur = step(cur, seg);
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * Auflösung im Wiederholungsblock: erst der Listeneintrag, dann das
 * Wurzelobjekt. So greift {{bezeichnung}} auf die Position zu und
 * {{verkaeufer.name}} weiterhin auf das Dokument.
 */
interface Scope { item?: Json; index?: number; root: Json }

function lookup(scope: Scope, path: string): Json {
  if (path === "#" || path.toLowerCase() === "index") return scope.index;
  if (scope.item !== undefined) {
    const fromItem = resolvePath(scope.item, path);
    if (fromItem !== undefined) return fromItem;
  }
  return resolvePath(scope.root, path);
}

/** Ein Wert gilt als vorhanden, wenn er nicht leer ist — Leerstring inklusive. */
function toText(value: Json): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim().length ? value : undefined;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return undefined; // Objekte/Listen sind kein Text
}

/**
 * Wahrheitswert für when/unless. Locker gefasst, weil Daten aus lose
 * typisierten Quellen kommen: die Zeichenketten "false", "nein", "0" und ""
 * gelten als unwahr, leere Listen und Objekte ebenfalls.
 */
export function isTruthy(value: Json): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v.length > 0 && v !== "false" && v !== "nein" && v !== "0" && v !== "no";
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

interface Collector {
  missing: MissingValue[];
  seen: Set<string>;
  note: (n: string) => void;
}

/** Ersetzt alle Platzhalter eines Textes; fehlende Werte werden gesammelt. */
function fill(text: string, scope: Scope, where: string, col: Collector, escape: boolean): string {
  return text.replace(TOKEN, (_m, path: string) => {
    const value = toText(lookup(scope, path));
    if (value === undefined) {
      const key = `${path} ${where}`;
      if (!col.seen.has(key)) {
        col.seen.add(key);
        col.missing.push({ placeholder: path, where });
      }
      return "";
    }
    return escape ? escapeHtml(value) : value;
  });
}

function fillBlockTexts(block: EditorBlock, scope: Scope, where: string, col: Collector): EditorBlock {
  const out: EditorBlock = { ...block };
  if (typeof out.text === "string") out.text = fill(out.text, scope, where, col, true);
  if (typeof out.alt === "string") out.alt = fill(out.alt, scope, where, col, true);
  // Bildquellen dürfen aus den Daten kommen (z. B. ein Logo als data:-URL) —
  // hier NICHT maskieren, dafür prüft validateDesign danach erneut.
  if (typeof out.src === "string" && out.src.includes("{{")) out.src = fill(out.src, scope, where, col, false);
  if (Array.isArray(out.columnsHtml)) {
    out.columnsHtml = out.columnsHtml.map((c, i) => fill(String(c ?? ""), scope, `${where} / Spalte ${i + 1}`, col, true));
  }
  if (Array.isArray(out.rows)) {
    out.rows = out.rows.map((row, r) =>
      row.map((cell, c) => fill(String(cell ?? ""), scope, `${where} / Zeile ${r + 1}, Spalte ${c + 1}`, col, true)));
  }
  return out;
}

/** Tabelle mit repeat: Kopfzeile, EINE Schablonenzeile je Eintrag, dann Fußzeilen. */
function expandTable(block: EditorBlock, list: Json[], scope: Scope, where: string, col: Collector): EditorBlock {
  const rows = block.rows ?? [];
  const headerCount = block.headerRow !== false && rows.length > 0 ? 1 : 0;
  const template = rows[headerCount];
  if (!template) {
    col.note(`${where}: Tabelle mit 'repeat' hat keine Schablonenzeile — nur Kopf und Fuß werden ausgegeben.`);
  }
  const footer = rows.slice(headerCount + 1);

  const out: string[][] = [];
  for (let i = 0; i < headerCount; i++) {
    out.push(rows[i].map((cell, c) => fill(String(cell ?? ""), scope, `${where} / Kopfzeile, Spalte ${c + 1}`, col, true)));
  }
  if (template) {
    list.forEach((item, i) => {
      const itemScope: Scope = { item, index: i + 1, root: scope.root };
      out.push(template.map((cell, c) =>
        fill(String(cell ?? ""), itemScope, `${where} / Eintrag ${i + 1}, Spalte ${c + 1}`, col, true)));
    });
  }
  footer.forEach((row, r) => {
    out.push(row.map((cell, c) => fill(String(cell ?? ""), scope, `${where} / Fußzeile ${r + 1}, Spalte ${c + 1}`, col, true)));
  });

  const merged: EditorBlock = { ...block, rows: out };
  delete merged.repeat;
  return merged;
}

function mergeBlock(block: EditorBlock, scope: Scope, where: string, col: Collector): EditorBlock[] {
  // 1) Bedingungen: ein nicht erfüllter Block verschwindet ganz. Ein fehlender
  //    Wert ist hier KEIN Fehler — genau dafür ist die Bedingung da.
  if (block.when && !isTruthy(lookup(scope, block.when))) return [];
  if (block.unless && isTruthy(lookup(scope, block.unless))) return [];

  const clean = (b: EditorBlock): EditorBlock => {
    const out = { ...b };
    delete out.when;
    delete out.unless;
    return out;
  };

  // 2) Wiederholung
  if (block.repeat) {
    const value = lookup(scope, block.repeat);
    const list = Array.isArray(value) ? value : undefined;
    if (!list) {
      col.note(`${where}: '${block.repeat}' ist keine Liste — der Block entfällt.`);
      return [];
    }
    if (list.length === 0) {
      col.note(`${where}: Liste '${block.repeat}' ist leer — der Block entfällt.`);
      return [];
    }
    if (block.type === "Table") {
      return [clean(fillBlockTexts(expandTable(block, list, scope, where, col), scope, where, col))].map((b) => {
        const out = { ...b };
        delete out.repeat;
        return out;
      });
    }
    // Andere Blocktypen: der ganze Block je Eintrag.
    return list.map((item, i) => {
      const out = clean(fillBlockTexts(block, { item, index: i + 1, root: scope.root }, `${where} / Eintrag ${i + 1}`, col));
      delete out.repeat;
      return out;
    });
  }

  return [clean(fillBlockTexts(block, scope, where, col))];
}

function mergeOverlay(ov: EditorOverlay, scope: Scope, where: string, col: Collector): EditorOverlay {
  const out: EditorOverlay = { ...ov };
  if (typeof out.text === "string") out.text = fill(out.text, scope, where, col, true);
  if (typeof out.alt === "string") out.alt = fill(out.alt, scope, where, col, true);
  if (typeof out.src === "string" && out.src.includes("{{")) out.src = fill(out.src, scope, where, col, false);
  return out;
}

/**
 * Füllt eine Vorlage mit einem JSON-Objekt. Das Ergebnis ist wieder ein
 * Design-Dokument — es kann gerendert, gespeichert oder geprüft werden.
 */
export function mergeDesign(doc: EditorDocument, data: unknown, opts: MergeOptions = {}): MergeResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ToolError("Die Daten müssen ein JSON-Objekt sein (kein Array, kein Einzelwert).");
  }
  const notes: string[] = [];
  const col: Collector = { missing: [], seen: new Set(), note: (n) => notes.push(n) };
  const scope: Scope = { root: data };

  const pages: EditorPage[] = doc.pages.map((page, pi) => {
    const blocks: EditorBlock[] = [];
    (page.blocks ?? []).forEach((b, bi) => {
      blocks.push(...mergeBlock(b, scope, `Seite ${pi + 1} / ${b.type} #${bi + 1}`, col));
    });
    const overlays = (page.overlays ?? []).map((o, oi) =>
      mergeOverlay(o, scope, `Seite ${pi + 1} / Overlay-${o.type} #${oi + 1}`, col));
    return { ...page, blocks, ...(page.overlays ? { overlays } : {}) };
  });

  const merged: EditorDocument = {
    ...doc,
    title: fill(doc.title ?? "", scope, "Dokumenttitel", col, false),
    pages,
  };

  if (col.missing.length > 0 && (opts.onMissing ?? "error") === "error") {
    const list = col.missing.map((m) => `{{${m.placeholder}}} (${m.where})`).join("\n- ");
    throw new ToolError(
      `${col.missing.length} Platzhalter ohne Wert — das Dokument wäre an diesen Stellen leer:\n- ${list}\n` +
      "Mit onMissing='report' wird stattdessen gefüllt und die Liste zurückgegeben.",
    );
  }

  return { doc: merged, missing: col.missing, notes };
}

/** Alle Platzhalter einer Vorlage (für Vorabprüfungen und Formulare). */
export function collectPlaceholders(doc: EditorDocument): string[] {
  const found = new Set<string>();
  const scan = (s: unknown): void => {
    if (typeof s !== "string") return;
    for (const m of s.matchAll(TOKEN)) found.add(m[1]);
  };
  scan(doc.title);
  for (const page of doc.pages) {
    for (const b of page.blocks ?? []) {
      scan(b.text); scan(b.alt); scan(b.src);
      (b.columnsHtml ?? []).forEach(scan);
      (b.rows ?? []).forEach((row) => row.forEach(scan));
      if (b.when) found.add(b.when);
      if (b.unless) found.add(b.unless);
      if (b.repeat) found.add(b.repeat);
    }
    for (const o of page.overlays ?? []) { scan(o.text); scan(o.alt); scan(o.src); }
  }
  return [...found].sort();
}
