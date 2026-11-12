// =============================================================================
// Pagebound MCP — PDF säubern
// -----------------------------------------------------------------------------
// Vertrag: docs/contracts/pdf-saeubern.md
//
// Eine PDF bringt mehr mit als Seiten: JavaScript, das beim Öffnen läuft,
// eingebettete Dateien, Aktionen an Formularfeldern, Verweise auf fremde
// Dokumente. Wer sie weitergibt, gibt das alles mit — und sieht es nicht.
//
// Zwei Festlegungen, die hier sichtbar werden:
//   * Je Posten eine ZAHL zurück, kein „fertig". Wer zwölf Anhänge vermutet
//     und drei entfernt bekommt, muss das sehen.
//   * Der Seiteninhalt bleibt. Säubern ist kein Flachklopfen: Annotationen,
//     Formularfelder und Lesezeichen überleben, nur ihre Aktionen gehen.
//
// Reproduzierbarkeit (MCP-Zusage seit 2.0.0): keine Systemuhr, keine
// Zufalls-Ids, `updateMetadata: false` beim Laden.
// =============================================================================

import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef } from "pdf-lib";
import { NO_METADATA_BUMP } from "./pdf.js";

export interface SanitizeOptions {
  /** `/Names /JavaScript`, `/OpenAction` mit `/S /JavaScript`, `/AA`. Vorgabe: an. */
  javascript?: boolean;
  /** `/Names /EmbeddedFiles`, `/FileAttachment`-Annotationen. Vorgabe: an. */
  embeddedFiles?: boolean;
  /** `/Info`-Felder (ausser `/Producer`) und der XMP-Strom. Vorgabe: an. */
  metadata?: boolean;
  /** `/A` und `/AA` an Annotationen und Formularfeldern. Vorgabe: an. */
  annotationActions?: boolean;
  /** `/Launch`, `/GoToR`, `/SubmitForm`, `/ImportData`. Vorgabe: an. */
  launchActions?: boolean;
  /** `/URI`-Aktionen. Vorgabe: AUS — ein Link ist meist gewollter Inhalt. */
  externalLinks?: boolean;
}

export interface SanitizeReport {
  javascript: number;
  embeddedFiles: number;
  metadata: number;
  annotationActions: number;
  launchActions: number;
  externalLinks: number;
}

export interface SanitizeResult {
  bytes: Uint8Array;
  removed: SanitizeReport;
}

/** Aktionstypen, die aus der Datei herausgreifen. */
const HERAUSGREIFEND = ["Launch", "GoToR", "SubmitForm", "ImportData"];

/** `/Info`-Felder, die beim Säubern fallen. `/Producer` bleibt (siehe Vertrag). */
const INFO_FELDER = ["Title", "Author", "Subject", "Keywords", "Creator", "CreationDate", "ModDate", "Trapped"];

function dictOrNull(value: unknown): PDFDict | null {
  return value instanceof PDFDict ? value : null;
}

/** Den `/Type /Action`-Typ einer Aktion lesen, falls vorhanden. */
function aktionsTyp(action: PDFDict): string | null {
  const s = action.lookup(PDFName.of("S"));
  return s instanceof PDFName ? s.asString().replace(/^\//, "") : null;
}

/**
 * Entscheidet, ob eine Aktion fällt. Folgt `/Next` NICHT selbst — die Kette
 * wird von der Aufrufstelle her mitgeprüft, weil sonst eine Aktion stehen
 * bliebe, deren Nachfolger das Verbotene tut.
 */
function faelltWeg(action: PDFDict, opt: Required<SanitizeOptions>): "javascript" | "launchActions" | "externalLinks" | null {
  const typ = aktionsTyp(action);
  if (typ === "JavaScript") return opt.javascript ? "javascript" : null;
  if (typ && HERAUSGREIFEND.includes(typ)) return opt.launchActions ? "launchActions" : null;
  if (typ === "URI") return opt.externalLinks ? "externalLinks" : null;

  // Eine Aktion ohne eigenen Grund fällt trotzdem, wenn ihr Nachfolger fällt —
  // sonst bliebe ein Vorspann stehen, der das Verbotene gleich nachlädt.
  const next = action.lookup(PDFName.of("Next"));
  if (next instanceof PDFDict) return faelltWeg(next, opt);
  if (next instanceof PDFArray) {
    for (let i = 0; i < next.size(); i++) {
      const d = dictOrNull(next.lookup(i));
      if (d && faelltWeg(d, opt)) return faelltWeg(d, opt);
    }
  }
  return null;
}

/**
 * Räumt einen Namensbaum ab: zählt die Einträge UND löscht die Objekte, auf
 * die sie zeigen.
 *
 * Den Baum bloss abzuhängen genügt nicht. Der eingebettete Datenstrom bliebe
 * als verwaistes Objekt in der Datei stehen — `strings` findet ihn, jedes
 * Reparaturwerkzeug hängt ihn wieder ein. Für ein Werkzeug, dessen ganzer
 * Zweck „das ist jetzt raus" ist, wäre das die falsche Art von Sauberkeit.
 * (Nachgewiesen: die Klartextprüfung im Selbsttest fand `notiz.txt` nach dem
 * blossen Abhängen weiterhin.)
 */
function raeumeNamensbaum(doc: PDFDocument, wurzel: PDFDict | null): number {
  if (!wurzel) return 0;
  let n = 0;

  const names = wurzel.lookup(PDFName.of("Names"));
  if (names instanceof PDFArray) {
    // [name, wert, name, wert, …] — nur die ungeraden Plätze sind Werte.
    for (let i = 1; i < names.size(); i += 2) {
      loescheTief(doc, names.get(i));
      n++;
    }
  }

  const kids = wurzel.lookup(PDFName.of("Kids"));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      n += raeumeNamensbaum(doc, dictOrNull(kids.lookup(i)));
      loescheTief(doc, kids.get(i));
    }
  }
  return n;
}

/**
 * Löscht ein Objekt und, bei einer Dateianlage, den daran hängenden
 * Datenstrom. Tiefer als eine Ebene wird nicht gegraben: alles, was hier
 * vorkommt, ist entweder eine Aktion (flach) oder ein `/Filespec` mit `/EF`.
 */
function loescheTief(doc: PDFDocument, wert: unknown): void {
  if (!(wert instanceof PDFRef)) return;
  const ziel = doc.context.lookup(wert);

  if (ziel instanceof PDFDict) {
    const ef = dictOrNull(ziel.lookup(PDFName.of("EF")));
    if (ef) {
      for (const key of ef.keys()) {
        const stromRef = ef.get(key);
        if (stromRef instanceof PDFRef) doc.context.delete(stromRef);
      }
    }
  }
  doc.context.delete(wert);
}

/**
 * Säubert eine PDF. Jeder Posten ist einzeln abwählbar; die Vorgaben stehen
 * im Vertrag.
 */
export async function sanitize(input: Uint8Array, options: SanitizeOptions = {}): Promise<SanitizeResult> {
  const opt: Required<SanitizeOptions> = {
    javascript: options.javascript ?? true,
    embeddedFiles: options.embeddedFiles ?? true,
    metadata: options.metadata ?? true,
    annotationActions: options.annotationActions ?? true,
    launchActions: options.launchActions ?? true,
    externalLinks: options.externalLinks ?? false,
  };

  const doc = await PDFDocument.load(input, { ...NO_METADATA_BUMP, ignoreEncryption: true });
  const removed: SanitizeReport = {
    javascript: 0, embeddedFiles: 0, metadata: 0,
    annotationActions: 0, launchActions: 0, externalLinks: 0,
  };

  const katalog = doc.catalog;
  const names = dictOrNull(katalog.lookup(PDFName.of("Names")));

  // --- Namensbäume: /JavaScript und /EmbeddedFiles --------------------------
  if (names) {
    if (opt.javascript) {
      const js = dictOrNull(names.lookup(PDFName.of("JavaScript")));
      if (js) {
        removed.javascript += raeumeNamensbaum(doc, js);
        loescheTief(doc, names.get(PDFName.of("JavaScript")));
        names.delete(PDFName.of("JavaScript"));
      }
    }
    if (opt.embeddedFiles) {
      const ef = dictOrNull(names.lookup(PDFName.of("EmbeddedFiles")));
      if (ef) {
        removed.embeddedFiles += raeumeNamensbaum(doc, ef);
        loescheTief(doc, names.get(PDFName.of("EmbeddedFiles")));
        names.delete(PDFName.of("EmbeddedFiles"));
      }
    }
    // Leeren Namensbaum nicht als Leiche stehen lassen.
    if (names.keys().length === 0) katalog.delete(PDFName.of("Names"));
  }

  // --- /OpenAction am Katalog ----------------------------------------------
  const open = katalog.lookup(PDFName.of("OpenAction"));
  if (open instanceof PDFDict) {
    const grund = faelltWeg(open, opt);
    if (grund) {
      removed[grund]++;
      // Der Quelltext des Skripts steht im Objekt — abhängen genügt nicht,
      // er bliebe als verwaistes Objekt lesbar in der Datei.
      loescheTief(doc, katalog.get(PDFName.of("OpenAction")));
      katalog.delete(PDFName.of("OpenAction"));
    }
  }

  // --- /AA (zusätzliche Aktionen) am Katalog und an den Seiten --------------
  // /AA ist ein Bündel von Auslösern (WC = beim Schliessen, WS = beim
  // Speichern …). Entfernt wird das ganze Bündel, sobald einer davon fällt —
  // ein halbes Bündel wäre schwerer zu erklären als keins.
  const aaSaeubern = (traeger: PDFDict): void => {
    const aa = dictOrNull(traeger.lookup(PDFName.of("AA")));
    if (!aa) return;
    let grund: "javascript" | "launchActions" | "externalLinks" | null = null;
    for (const key of aa.keys()) {
      const d = dictOrNull(aa.lookup(key));
      if (d) grund = faelltWeg(d, opt) ?? grund;
    }
    if (grund) {
      removed[grund]++;
      for (const key of aa.keys()) loescheTief(doc, aa.get(key));
      loescheTief(doc, traeger.get(PDFName.of("AA")));
      traeger.delete(PDFName.of("AA"));
    }
  };
  aaSaeubern(katalog);

  // --- /AcroForm: /XFA und die Aktionen der Felder --------------------------
  const acro = dictOrNull(katalog.lookup(PDFName.of("AcroForm")));
  if (acro && opt.javascript) {
    // /CO (calculation order) zeigt auf Felder mit Rechen-Skripten; ohne die
    // Skripte ist die Liste bedeutungslos.
    acro.delete(PDFName.of("CO"));
  }

  // --- Seiten: /AA und die Annotationen -------------------------------------
  for (const page of doc.getPages()) {
    aaSaeubern(page.node);

    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;

    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = dictOrNull(annots.lookup(i));
      if (!annot) continue;

      // Dateianlagen gehen ganz — sie SIND der Anhang.
      const subtype = annot.lookup(PDFName.of("Subtype"));
      const istAnlage = subtype instanceof PDFName && subtype.asString() === "/FileAttachment";
      if (istAnlage && opt.embeddedFiles) {
        // Auch hier: die Annotation abzuhängen lässt den Datenstrom stehen.
        loescheTief(doc, annot.get(PDFName.of("FS")));
        removed.embeddedFiles++;
        const ref = annots.get(i);
        annots.remove(i);
        if (ref instanceof PDFRef) doc.context.delete(ref);
        continue;
      }

      // Sonst fällt nur die Aktion, nicht die Annotation.
      const a = dictOrNull(annot.lookup(PDFName.of("A")));
      if (a) {
        const grund = faelltWeg(a, opt);
        if (grund) {
          removed[grund]++;
          loescheTief(doc, annot.get(PDFName.of("A")));
          annot.delete(PDFName.of("A"));
        } else if (opt.annotationActions && aktionsTyp(a) !== "URI" && aktionsTyp(a) !== "GoTo") {
          // Alles, was weder ein Sprung im Dokument noch ein Link ist.
          removed.annotationActions++;
          loescheTief(doc, annot.get(PDFName.of("A")));
          annot.delete(PDFName.of("A"));
        }
      }

      const vorher = removed.javascript + removed.launchActions + removed.externalLinks;
      aaSaeubern(annot);
      const nachher = removed.javascript + removed.launchActions + removed.externalLinks;
      if (nachher === vorher && opt.annotationActions && annot.lookup(PDFName.of("AA"))) {
        removed.annotationActions++;
        annot.delete(PDFName.of("AA"));
      }
    }
  }

  // --- Metadaten -------------------------------------------------------------
  if (opt.metadata) {
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (info instanceof PDFDict) {
      for (const feld of INFO_FELDER) {
        if (info.lookup(PDFName.of(feld)) !== undefined) {
          info.delete(PDFName.of(feld));
          removed.metadata++;
        }
      }
    }
    // Der XMP-Strom am Katalog ist die zweite, oft vergessene Hälfte.
    if (katalog.lookup(PDFName.of("Metadata")) !== undefined) {
      katalog.delete(PDFName.of("Metadata"));
      removed.metadata++;
    }
  }

  return { bytes: await doc.save({ useObjectStreams: true }), removed };
}
