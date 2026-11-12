// =============================================================================
// Pagebound MCP — PDF säubern
// -----------------------------------------------------------------------------
// Vertrag: docs/contracts/pdf-saeubern.md
//
// Eine PDF bringt mehr mit als Seiten: JavaScript, das beim Öffnen läuft,
// eingebettete Dateien, Aktionen an Formularfeldern, Verweise auf fremde
// Dokumente. Wer sie weitergibt, gibt das alles mit — und sieht es nicht.
//
// Drei Festlegungen, die hier sichtbar werden:
//   * Je Posten eine ZAHL zurück, kein „fertig". Wer zwölf Anhänge vermutet
//     und drei entfernt bekommt, muss das sehen. Gezählt wird je ENTFERNTER
//     AKTION, nicht je Träger (Nachtrag 2 im Vertrag).
//   * Der Seiteninhalt bleibt. Säubern ist kein Flachklopfen: Annotationen,
//     Formularfelder und Lesezeichen überleben, nur ihre Aktionen gehen.
//   * Entfernt heisst gelöscht, nicht abgehängt. Ein abgehängter Datenstrom
//     steht weiter lesbar in der Datei (Nachtrag 1 im Vertrag).
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

/**
 * Aktionstypen, die an einer Annotation oder einem Feld stehen bleiben, auch
 * wenn `annotationActions` an ist: ein Sprung im eigenen Dokument und ein Link
 * sind gewollter Inhalt, kein Angriff.
 */
const BLEIBT_AM_FELD = ["GoTo", "URI"];

/**
 * Schlüssel, unter denen eine Aktion oder eine Dateianlage ihre Nutzlast oder
 * ihren Nachfolger hält. `loescheTief` folgt genau diesen — das ist die Liste,
 * an der entscheidet, ob am Ende noch Klartext in der Datei steht.
 *
 *   /JS   Quelltext des Skripts (Strom ODER String, oft indirekt)
 *   /Next nachgeschaltete Aktion(en) — die eigentliche Falle (Befund 2)
 *   /F    Dateiangabe einer /Launch-Aktion bzw. der Strom in einem /EF
 *   /UF   dasselbe in Unicode
 *   /D    Ziel einer /GoToR-Aktion
 *   /Win  Windows-Teil einer /Launch-Aktion (enthält den Programmpfad)
 *   /EF   die eingebetteten Ströme einer Dateianlage
 */
const NUTZLAST = ["JS", "Next", "F", "UF", "D", "Win", "EF"];

/** `/Info`-Feld, das als einziges stehen bleibt (siehe Vertrag). */
const INFO_BLEIBT = "/Producer";

type Grund = "javascript" | "launchActions" | "externalLinks";

function dictOrNull(value: unknown): PDFDict | null {
  return value instanceof PDFDict ? value : null;
}

/** Den `/S`-Typ einer Aktion lesen, falls vorhanden. */
function aktionsTyp(action: PDFDict): string | null {
  const s = action.lookup(PDFName.of("S"));
  return s instanceof PDFName ? s.asString().replace(/^\//, "") : null;
}

/** Der Grund, aus dem eine Aktion aus eigenem Recht fällt — ohne die Kette. */
function eigenerGrund(action: PDFDict, opt: Required<SanitizeOptions>): Grund | null {
  const typ = aktionsTyp(action);
  if (typ === "JavaScript") return opt.javascript ? "javascript" : null;
  if (typ && HERAUSGREIFEND.includes(typ)) return opt.launchActions ? "launchActions" : null;
  if (typ === "URI") return opt.externalLinks ? "externalLinks" : null;
  return null;
}

/**
 * Entscheidet, ob eine Aktion fällt — aus eigenem Recht oder weil ihr
 * Nachfolger fällt.
 *
 * Die `/Next`-Kette wird IMMER weiterverfolgt, auch wenn die Aktion selbst
 * bleiben dürfte. Vorher brach die Prüfung beim ersten erkannten Typ ab, und
 * genau das war der Weg an der Vorgabe vorbei: `externalLinks` steht per
 * Vorgabe AUS, also blieb ein `/URI` stehen — und mit ihm das JavaScript in
 * seinem `/Next`. Jeder Posten meldete dabei 0.
 *
 * `gesehen` bricht Zyklen ab: `/Next` darf laut Format auf eine Aktion zeigen,
 * die schon in der Kette steht, und eine solche Datei würde den Säuberer sonst
 * bis zum Stapelüberlauf im Kreis schicken.
 */
function faelltWeg(
  action: PDFDict,
  opt: Required<SanitizeOptions>,
  gesehen: Set<PDFDict> = new Set()
): Grund | null {
  if (gesehen.has(action)) return null;
  gesehen.add(action);

  const eigen = eigenerGrund(action, opt);
  if (eigen) return eigen;

  const next = action.lookup(PDFName.of("Next"));
  if (next instanceof PDFDict) return faelltWeg(next, opt, gesehen);
  if (next instanceof PDFArray) {
    for (let i = 0; i < next.size(); i++) {
      const d = dictOrNull(next.lookup(i));
      const grund = d ? faelltWeg(d, opt, gesehen) : null;
      if (grund) return grund;
    }
  }
  return null;
}

/**
 * Löscht ein Objekt samt allem, was unter {@link NUTZLAST} daran hängt.
 *
 * Den Verweis bloss zu entfernen genügt nicht. Der eingebettete Datenstrom,
 * der Skriptquelltext und der Programmpfad einer `/Launch`-Aktion blieben als
 * verwaiste Objekte in der Datei stehen — `strings` findet sie, jedes
 * Reparaturwerkzeug hängt sie wieder ein. Für ein Werkzeug, dessen ganzer
 * Zweck „das ist jetzt raus" ist, wäre das die falsche Art von Sauberkeit.
 *
 * `gesehen` verhindert, dass ein von zwei Seiten verwendetes Objekt zweimal
 * besucht wird (und bricht Zyklen ab).
 */
function loescheTief(doc: PDFDocument, wert: unknown, gesehen: Set<string> = new Set()): void {
  if (wert instanceof PDFRef) {
    const schluessel = wert.toString();
    if (gesehen.has(schluessel)) return;
    gesehen.add(schluessel);
    loescheInhalt(doc, doc.context.lookup(wert), gesehen);
    doc.context.delete(wert);
    return;
  }
  // Ein direktes (nicht indirektes) Dict hat kein eigenes Objekt, seine Kinder
  // aber oft schon — der Strom unter /EF etwa.
  loescheInhalt(doc, wert, gesehen);
}

function loescheInhalt(doc: PDFDocument, ziel: unknown, gesehen: Set<string>): void {
  if (ziel instanceof PDFArray) {
    for (let i = 0; i < ziel.size(); i++) loescheTief(doc, ziel.get(i), gesehen);
    return;
  }
  if (!(ziel instanceof PDFDict)) return;
  for (const name of NUTZLAST) {
    const wert = ziel.get(PDFName.of(name));
    if (wert !== undefined) loescheTief(doc, wert, gesehen);
  }
}

/**
 * Räumt einen Namensbaum ab: zählt die Einträge UND löscht die Objekte, auf
 * die sie zeigen (siehe {@link loescheTief}).
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

  /**
   * Säubert `/A` und `/AA` an einem Träger.
   *
   * `alsFeld` unterscheidet die zwei Sorten von Trägern: an einer Annotation
   * oder einem Formularfeld fällt unter `annotationActions` auch eine Aktion
   * ohne eigenen Grund (ausser Sprung und Link). Am Katalog, an einer Seite
   * und an einem Lesezeichen fällt nur, was aus eigenem Recht fällt — dort
   * ist ein `/O`-Auslöser mit einem Sprung normales Verhalten.
   *
   * Gezählt wird je Aktion, nicht je Bündel: ein `/AA` mit drei Skripten
   * meldete vorher `javascript: 1`. Eine Zahl, die nicht zählt, ist der
   * Hauptzweck des Berichts verfehlt.
   */
  const aktionenSaeubern = (traeger: PDFDict, alsFeld: boolean): void => {
    const a = dictOrNull(traeger.lookup(PDFName.of("A")));
    if (a) {
      const grund = faelltWeg(a, opt);
      const unterAnnotationActions =
        !grund && alsFeld && opt.annotationActions && !BLEIBT_AM_FELD.includes(aktionsTyp(a) ?? "");
      if (grund || unterAnnotationActions) {
        if (grund) removed[grund]++; else removed.annotationActions++;
        loescheTief(doc, traeger.get(PDFName.of("A")));
        traeger.delete(PDFName.of("A"));
      }
    }

    const aa = dictOrNull(traeger.lookup(PDFName.of("AA")));
    if (!aa) return;
    for (const key of [...aa.keys()]) {
      const eintrag = dictOrNull(aa.lookup(key));
      if (!eintrag) continue;
      const grund = faelltWeg(eintrag, opt);
      if (grund) removed[grund]++;
      else if (alsFeld && opt.annotationActions) removed.annotationActions++;
      else continue; // harmloser Auslöser an Katalog/Seite/Lesezeichen: bleibt
      loescheTief(doc, aa.get(key));
      aa.delete(key);
    }
    if (aa.keys().length === 0) {
      loescheTief(doc, traeger.get(PDFName.of("AA")));
      traeger.delete(PDFName.of("AA"));
    }
  };

  // Ein Widget steht in `/Annots` der Seite UND in `/AcroForm /Fields`. Ohne
  // dieses Gedächtnis zählte derselbe Fund zweimal.
  const besucht = new Set<PDFDict>();
  const einmal = (knoten: PDFDict, alsFeld: boolean): boolean => {
    if (besucht.has(knoten)) return false;
    besucht.add(knoten);
    aktionenSaeubern(knoten, alsFeld);
    return true;
  };

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

  // --- /AA am Katalog -------------------------------------------------------
  aktionenSaeubern(katalog, false);

  // --- Seiten: /AA und die Annotationen -------------------------------------
  for (const page of doc.getPages()) {
    aktionenSaeubern(page.node, false);

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
        besucht.add(annot);
        if (ref instanceof PDFRef) doc.context.delete(ref);
        continue;
      }

      einmal(annot, true);
    }
  }

  // --- /AcroForm: /XFA, /CO und die Aktionen der Felder ---------------------
  // Ein Feld mit `/AA /K` (Tastendruck) oder `/AA /V` (Prüfung) ist KEINE
  // Annotation der Seite, wenn es Kinder hat — es steht nur hier. Vorher lief
  // der Säuberer an diesem ganzen Teilbaum vorbei.
  const acro = dictOrNull(katalog.lookup(PDFName.of("AcroForm")));
  if (acro) {
    if (opt.javascript) {
      // /CO (calculation order) zeigt auf Felder mit Rechen-Skripten; ohne die
      // Skripte ist die Liste bedeutungslos.
      acro.delete(PDFName.of("CO"));
    }
    const felder = acro.lookup(PDFName.of("Fields"));
    if (felder instanceof PDFArray) {
      const stapel: PDFDict[] = [];
      for (let i = 0; i < felder.size(); i++) {
        const f = dictOrNull(felder.lookup(i));
        if (f) stapel.push(f);
      }
      while (stapel.length > 0) {
        const knoten = stapel.pop()!;
        if (!einmal(knoten, true)) continue;
        const kids = knoten.lookup(PDFName.of("Kids"));
        if (kids instanceof PDFArray) {
          for (let i = 0; i < kids.size(); i++) {
            const k = dictOrNull(kids.lookup(i));
            if (k) stapel.push(k);
          }
        }
      }
    }
  }

  // --- Lesezeichen ----------------------------------------------------------
  // Ein Lesezeichen mit `/Launch` startet beim Klick ein Programm. Es ist
  // weder Annotation noch Feld, also fällt hier NUR, was aus eigenem Recht
  // fällt — ein `/GoTo` ist das, wofür Lesezeichen da sind.
  const outlines = dictOrNull(katalog.lookup(PDFName.of("Outlines")));
  if (outlines) {
    const stapel: PDFDict[] = [];
    const erstes = dictOrNull(outlines.lookup(PDFName.of("First")));
    if (erstes) stapel.push(erstes);
    while (stapel.length > 0) {
      const knoten = stapel.pop()!;
      if (!einmal(knoten, false)) continue;
      for (const kante of ["First", "Next"]) {
        const n = dictOrNull(knoten.lookup(PDFName.of(kante)));
        if (n) stapel.push(n);
      }
    }
  }

  // --- Metadaten -------------------------------------------------------------
  if (opt.metadata) {
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (info instanceof PDFDict) {
      // Über die tatsächlichen Schlüssel laufen, nicht über eine feste Liste:
      // `/Customer`, `/Matter`, `/SAP_DocID` sind erlaubte eigene Felder, und
      // der Vertrag sagt „alle ausser /Producer". Eine feste Liste liess genau
      // die Felder stehen, die niemand erwartet — und meldete dafür 0.
      for (const key of [...info.keys()]) {
        if (key.asString() === INFO_BLEIBT) continue;
        loescheTief(doc, info.get(key));
        info.delete(key);
        removed.metadata++;
      }
    }
    // Der XMP-Strom am Katalog ist die zweite, oft vergessene Hälfte — und er
    // muss gelöscht werden, nicht abgehängt: sein Inhalt ist Klartext-XML.
    if (katalog.get(PDFName.of("Metadata")) !== undefined) {
      loescheTief(doc, katalog.get(PDFName.of("Metadata")));
      katalog.delete(PDFName.of("Metadata"));
      removed.metadata++;
    }
  }

  return { bytes: await doc.save({ useObjectStreams: true }), removed };
}
