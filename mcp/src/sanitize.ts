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
//     und drei entfernt bekommt, muss das sehen. Gezählt wird je VERBOTENER
//     AKTION, auch innerhalb einer /Next-Kette (Nachtrag 3 im Vertrag).
//   * Der Seiteninhalt bleibt. Säubern ist kein Flachklopfen: Annotationen,
//     Formularfelder und Lesezeichen überleben, nur ihre Aktionen gehen.
//   * Entfernt heisst gelöscht, nicht abgehängt. Ein abgehängter Datenstrom
//     steht weiter lesbar in der Datei (Nachtrag 1 im Vertrag).
//
// DER AUFBAU — erst abhängen, dann fegen.
//
// Das Löschen läuft NICHT entlang einer Liste bekannter Nutzlast-Schlüssel.
// Dieser Weg wurde versucht und war zweimal falsch: er folgte dem Ziel einer
// `/GoTo`-Aktion bis in den Seitenbaum und löschte die Seite, und er übersah
// die Ströme unter `/EF /DOS`, `/Mac` und `/Unix`, weil sie nicht auf der
// Liste standen. Eine Liste, die beides richtig hätte, müsste das ganze
// Format kennen — und ein geteiltes Objekt riss sie trotzdem mit.
//
// Stattdessen: der Durchlauf HÄNGT nur ab (löscht Schlüssel, nimmt Einträge
// aus Feldern), und danach fegt `fegen()` jedes indirekte Objekt fort, das
// von der Wurzel aus nicht mehr erreichbar ist. Das trifft die Nutzlast
// zuverlässig, lässt Seiten und geteilte Objekte in Ruhe und braucht keine
// Vorannahme darüber, wo eine PDF ihre Geheimnisse ablegt.
//
// Reproduzierbarkeit (MCP-Zusage seit 2.0.0): keine Systemuhr, keine
// Zufalls-Ids, `updateMetadata: false` beim Laden.
// =============================================================================

import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef, PDFStream, PDFInvalidObject } from "pdf-lib";
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
 * Alle verbotenen Aktionen einer `/Next`-Kette, mit ihrem jeweiligen Grund.
 *
 * Die Kette wird IMMER ganz durchlaufen, auch wenn die erste Aktion bleiben
 * dürfte, und sie wird GANZ gezählt, nicht nur bis zum ersten Treffer. Zwei
 * Gründe dafür, beide aus Codex-Runden:
 *
 *   * `externalLinks` steht per Vorgabe AUS. Ein `/URI` mit JavaScript im
 *     `/Next` ging deshalb im Normalbetrieb durch, und jeder Posten meldete 0.
 *   * Zwei verkettete Skripte verschwanden beide, gemeldet wurde `1`. Eine
 *     Zahl, die nicht zählt, verfehlt den erklärten Zweck des Berichts.
 *
 * `gesehen` bricht Zyklen ab: `/Next` darf laut Format auf eine Aktion zeigen,
 * die schon in der Kette steht, und eine solche Datei würde den Säuberer sonst
 * bis zum Stapelüberlauf im Kreis schicken.
 */
function gruendeInKette(
  action: PDFDict,
  opt: Required<SanitizeOptions>,
  gesehen: Set<PDFDict> = new Set()
): Array<[PDFDict, Grund]> {
  if (gesehen.has(action)) return [];
  gesehen.add(action);

  const treffer: Array<[PDFDict, Grund]> = [];
  const eigen = eigenerGrund(action, opt);
  if (eigen) treffer.push([action, eigen]);

  const next = action.lookup(PDFName.of("Next"));
  if (next instanceof PDFDict) {
    treffer.push(...gruendeInKette(next, opt, gesehen));
  } else if (next instanceof PDFArray) {
    for (let i = 0; i < next.size(); i++) {
      const d = dictOrNull(next.lookup(i));
      if (d) treffer.push(...gruendeInKette(d, opt, gesehen));
    }
  }
  return treffer;
}

/**
 * Die Werte eines Namensbaums. Gelöscht wird hier nichts — das besorgt
 * `fegen()`, sobald der Baum vom Katalog abgehängt ist. Zurück kommen die
 * aufgelösten Werte und nicht nur ihre Zahl, weil dieselbe Dateianlage auch
 * unter `/AF` hängen kann und dann nicht zweimal zählen darf.
 */
function namensbaumWerte(wurzel: PDFDict | null): unknown[] {
  if (!wurzel) return [];
  const werte: unknown[] = [];

  // [name, wert, name, wert, …] — nur die ungeraden Plätze sind Werte.
  const names = wurzel.lookup(PDFName.of("Names"));
  if (names instanceof PDFArray) {
    for (let i = 1; i < names.size(); i += 2) werte.push(names.lookup(i));
  }

  const kids = wurzel.lookup(PDFName.of("Kids"));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) werte.push(...namensbaumWerte(dictOrNull(kids.lookup(i))));
  }
  return werte;
}

/**
 * Verweise aus einem Objekt herauslesen, das pdf-lib nicht zerlegen konnte.
 *
 * `PDFInvalidObject` entsteht zum Beispiel bei einem Strom mit indirektem
 * `/Length` — vom Format ausdrücklich erlaubt. Für das Markieren ist so ein
 * Objekt eine Blackbox: seine Verweise sind unsichtbar, und was sie halten,
 * fiele dem Fegen zum Opfer. Gemessen: eine Form-XObject mit indirektem
 * `/Length` verlor ihre Schrift, und die Textextraktion lieferte danach
 * `stream` statt `ABCDEF`.
 *
 * Deshalb werden seine Rohbytes nach `N M R` abgesucht. Zu viel zu markieren
 * ist harmlos — dann bleibt ein Objekt liegen. Zu wenig zerstört die Datei.
 *
 * Getrennt werden die drei Marken durch PDF-Zwischenraum ODER einen
 * Kommentar. Beides steht im Format (§ 7.2.2 und 7.2.3), und beides deckt
 * das `\s` einer JavaScript-Regex NICHT ab: `\0` fehlt ihm, Kommentare
 * ohnehin. `/F1 5%Anmerkung\n0 R` wurde deshalb übersehen, und die Schrift
 * dahinter weggefegt.
 */
const TRENNER = String.raw`(?:[\0\t\n\f\r ]|%[^\r\n]*)+`;
const REF_MUSTER = new RegExp(
  String.raw`(\d+)${TRENNER}(\d+)${TRENNER}R(?![0-9A-Za-z])`, "g");

function refsAusRohbytes(obj: PDFInvalidObject): PDFRef[] {
  const puffer = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(puffer, 0);
  const text = Buffer.from(puffer).toString("latin1");
  const treffer: PDFRef[] = [];
  // Eine globale Regex trägt ihren Stand mit sich; vor jedem Durchlauf
  // zurücksetzen, sonst beginnt der zweite Aufruf mitten im Text.
  REF_MUSTER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_MUSTER.exec(text)) !== null) {
    treffer.push(PDFRef.of(Number(m[1]), Number(m[2])));
  }
  return treffer;
}

/**
 * Jedes indirekte Objekt, das von den Wurzeln des Dokuments aus erreichbar
 * ist, und jedes erreichbare Wörterbuch. Wurzeln sind alle Einträge des
 * Trailers — `/Root`, `/Info`, `/ID` und was sonst dort steht.
 *
 * Die Wörterbücher kommen mit zurück, weil `/AF` (associated files) nicht nur
 * am Katalog und an Seiten stehen darf, sondern auch an Struktur-Elementen,
 * Annotationen und XObjects. Wer nur die zwei bekannten Stellen abräumt, lässt
 * einen angeblich entfernten Anhang über die dritte am Leben.
 */
function erreichbare(doc: PDFDocument): { refs: Set<string>; dicts: PDFDict[] } {
  const refs = new Set<string>();
  const dicts: PDFDict[] = [];
  const gesehen = new Set<PDFDict>();
  const offen: unknown[] = Object.values(doc.context.trailerInfo as Record<string, unknown>);

  while (offen.length > 0) {
    const wert = offen.pop();

    if (wert instanceof PDFRef) {
      const schluessel = wert.toString();
      if (refs.has(schluessel)) continue;
      refs.add(schluessel);
      offen.push(doc.context.lookup(wert));
      continue;
    }
    if (wert instanceof PDFArray) {
      for (let i = 0; i < wert.size(); i++) offen.push(wert.get(i));
      continue;
    }
    if (wert instanceof PDFInvalidObject) {
      for (const ref of refsAusRohbytes(wert)) offen.push(ref);
      continue;
    }
    // Ein Strom trägt sein Wörterbuch bei sich; dessen Verweise zählen mit
    // (etwa `/SMask` an einem Bild).
    const dict = wert instanceof PDFDict ? wert : (wert instanceof PDFStream ? wert.dict : null);
    if (!dict || gesehen.has(dict)) continue;
    gesehen.add(dict);
    dicts.push(dict);
    for (const key of dict.keys()) offen.push(dict.get(key));
  }
  return { refs, dicts };
}

/**
 * Fegt jedes indirekte Objekt fort, das nicht mehr erreichbar ist.
 *
 * Das ist die eigentliche Löschung. Abgehängte Skriptquelltexte, Anhänge,
 * Aktionsketten und der XMP-Strom verschwinden hier — ohne dass der Säuberer
 * wissen muss, unter welchem Schlüssel eine PDF sie abgelegt hat, und ohne
 * dass er ein Objekt mitreisst, das noch jemandem gehört.
 *
 * Verwaiste Objekte, die schon beim Laden niemandem gehörten, gehen mit. Für
 * ein Säuberungswerkzeug ist das kein Nebeneffekt: ein verwaistes Objekt kann
 * eine frühere Fassung des Seiteninhalts enthalten.
 */
function fegen(doc: PDFDocument): number {
  const { refs: erreicht } = erreichbare(doc);
  let n = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (erreicht.has(ref.toString())) continue;
    doc.context.delete(ref);
    n++;
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

  // Ein Aktionsobjekt kann an mehreren Stellen hängen (zwei Annotationen, die
  // sich dasselbe `/A` teilen; ein `/Next`, das auch für sich verwendet wird).
  // Gezählt wird es einmal.
  const gezaehlt = new Set<PDFDict>();

  /** Zählt die verbotenen Aktionen einer Kette; sagt, ob die Kette fällt. */
  const zaehleKette = (action: PDFDict): boolean => {
    const treffer = gruendeInKette(action, opt);
    for (const [dict, grund] of treffer) {
      if (gezaehlt.has(dict)) continue;
      gezaehlt.add(dict);
      removed[grund]++;
    }
    return treffer.length > 0;
  };

  /**
   * Hängt `/A` und `/AA` an einem Träger ab.
   *
   * `alsFeld` unterscheidet die zwei Sorten von Trägern: an einer Annotation
   * oder einem Formularfeld fällt unter `annotationActions` auch eine Aktion
   * ohne eigenen Grund (ausser Sprung und Link). Am Katalog, an einer Seite
   * und an einem Lesezeichen fällt nur, was aus eigenem Recht fällt — dort
   * ist ein `/O`-Auslöser mit einem Sprung normales Verhalten.
   */
  const aktionenSaeubern = (traeger: PDFDict, alsFeld: boolean): void => {
    const a = dictOrNull(traeger.lookup(PDFName.of("A")));
    if (a) {
      let weg = zaehleKette(a);
      if (!weg && alsFeld && opt.annotationActions && !BLEIBT_AM_FELD.includes(aktionsTyp(a) ?? "")) {
        if (!gezaehlt.has(a)) { gezaehlt.add(a); removed.annotationActions++; }
        weg = true;
      }
      if (weg) traeger.delete(PDFName.of("A"));
    }

    const aa = dictOrNull(traeger.lookup(PDFName.of("AA")));
    if (!aa) return;
    for (const key of [...aa.keys()]) {
      const eintrag = dictOrNull(aa.lookup(key));
      if (!eintrag) continue;
      let weg = zaehleKette(eintrag);
      if (!weg && alsFeld && opt.annotationActions) {
        if (!gezaehlt.has(eintrag)) { gezaehlt.add(eintrag); removed.annotationActions++; }
        weg = true;
      }
      if (weg) aa.delete(key);
    }
    if (aa.keys().length === 0) traeger.delete(PDFName.of("AA"));
  };

  // Dieselbe Dateianlage hängt oft an MEHREREN Stellen: im Namensbaum
  // `/EmbeddedFiles`, an einer `/FileAttachment`-Annotation und zusätzlich in
  // `/AF` (associated files) — am Katalog, an einer Seite, an einem
  // Struktur-Element, an einer Annotation, an einem XObject. pdf-lib selbst
  // schreibt Namensbaum UND Katalog-`/AF`. Wer nur eine Stelle abhängt, lässt
  // die Anlage über die anderen erreichbar. Dieses Gedächtnis sorgt dafür,
  // dass alle Wege abgeräumt werden und die Anlage trotzdem EINMAL zählt.
  const anhaenge = new Set<PDFDict>();

  const afSaeubern = (traeger: PDFDict): void => {
    if (!opt.embeddedFiles) return;
    const af = traeger.lookup(PDFName.of("AF"));
    if (!(af instanceof PDFArray)) return;
    for (let i = af.size() - 1; i >= 0; i--) {
      const spec = dictOrNull(af.lookup(i));
      if (spec && !anhaenge.has(spec)) { anhaenge.add(spec); removed.embeddedFiles++; }
      af.remove(i);
    }
    traeger.delete(PDFName.of("AF"));
  };

  // Ein Widget steht in `/Annots` der Seite UND in `/AcroForm /Fields`. Ohne
  // dieses Gedächtnis liefe der Träger zweimal durch.
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
        for (const wert of namensbaumWerte(js)) {
          const aktion = dictOrNull(wert);
          // Durch denselben Zähler wie alle anderen Stellen: ein Skript, das
          // sich Namensbaum und `/OpenAction` teilen, ist EIN Fund, und ein
          // Eintrag mit `/Next` sind mehrere. Beides sah die blosse
          // Längenzählung nicht.
          if (!aktion) { removed.javascript++; continue; }
          if (zaehleKette(aktion)) continue;
          // Ein Eintrag im JavaScript-Baum ohne `/S /JavaScript` — manche
          // Erzeuger schreiben nur `/JS`. Er zählt trotzdem, einmal.
          if (!gezaehlt.has(aktion)) { gezaehlt.add(aktion); removed.javascript++; }
        }
        names.delete(PDFName.of("JavaScript"));
      }
    }
    if (opt.embeddedFiles) {
      const ef = dictOrNull(names.lookup(PDFName.of("EmbeddedFiles")));
      if (ef) {
        for (const wert of namensbaumWerte(ef)) {
          const spec = dictOrNull(wert);
          if (spec) anhaenge.add(spec);
          removed.embeddedFiles++;
        }
        names.delete(PDFName.of("EmbeddedFiles"));
      }
    }
    // Leeren Namensbaum nicht als Leiche stehen lassen.
    if (names.keys().length === 0) katalog.delete(PDFName.of("Names"));
  }

  // --- /OpenAction am Katalog ----------------------------------------------
  const open = katalog.lookup(PDFName.of("OpenAction"));
  if (open instanceof PDFDict && zaehleKette(open)) {
    katalog.delete(PDFName.of("OpenAction"));
  }

  // --- /AA am Katalog -------------------------------------------------------
  aktionenSaeubern(katalog, false);

  // --- Seiten: /AA und die Annotationen -------------------------------------
  for (const page of doc.getPages()) {
    aktionenSaeubern(page.node, false);

    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;

    const raus = new Set<number>();
    const popups = new Set<string>();

    for (let i = 0; i < annots.size(); i++) {
      const annot = dictOrNull(annots.lookup(i));
      if (!annot) continue;

      // Dateianlagen gehen ganz — sie SIND der Anhang.
      const subtype = annot.lookup(PDFName.of("Subtype"));
      const istAnlage = subtype instanceof PDFName && subtype.asString() === "/FileAttachment";
      if (istAnlage && opt.embeddedFiles) {
        const spec = dictOrNull(annot.lookup(PDFName.of("FS")));
        if (!spec || !anhaenge.has(spec)) {
          if (spec) anhaenge.add(spec);
          removed.embeddedFiles++;
        }
        // Den Anhang AM OBJEKT lösen, nicht nur die Annotation aus der Liste
        // nehmen. Ein Popup zeigt über `/Parent` auf sie zurück, ein
        // getaggtes Dokument über `/OBJR /Obj` — beides hält die Annotation
        // am Leben, und dann hinge der Anhang weiter daran.
        annot.delete(PDFName.of("FS"));
        const popup = annot.get(PDFName.of("Popup"));
        if (popup instanceof PDFRef) popups.add(popup.toString());
        raus.add(i);
        besucht.add(annot);
        continue;
      }

      einmal(annot, true);
    }

    // Zweiter Durchgang: die Anlagen und ihre Popups aus der Liste nehmen.
    // Ein Popup kann vor seiner Annotation stehen, deshalb nicht im ersten.
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i);
      if (raus.has(i) || (ref instanceof PDFRef && popups.has(ref.toString()))) annots.remove(i);
    }
  }

  // --- /AcroForm: /CO und die Aktionen der Felder ---------------------------
  // Ein Feld mit Kindern steht NUR hier, nicht in `/Annots` der Seite — sein
  // `/AA /K` (Tastendruck) bliebe sonst aktiv.
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

  // --- /AF, wo immer es steht ----------------------------------------------
  // Nicht nur am Katalog und an Seiten: `/AF` darf auch an Struktur-Elementen,
  // Annotationen und XObjects hängen. Ein Anhang, der im Namensbaum abgehängt
  // wurde, bliebe über jede dieser Stellen am Leben — gemeldet als entfernt,
  // tatsächlich noch da. Deshalb läuft dieser Durchgang über ALLE erreichbaren
  // Wörterbücher, und er läuft NACH Namensbaum und Annotationen, damit jede
  // Anlage schon bekannt ist und nur einmal zählt.
  if (opt.embeddedFiles) {
    for (const d of erreichbare(doc).dicts) afSaeubern(d);
  }

  // --- Metadaten -------------------------------------------------------------
  if (opt.metadata) {
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (info instanceof PDFDict) {
      // Über die tatsächlichen Schlüssel laufen, nicht über eine feste Liste:
      // `/Customer`, `/Matter`, `/SAP_DocID` sind erlaubte eigene Felder, und
      // der Vertrag sagt „alle ausser /Producer".
      for (const key of [...info.keys()]) {
        if (key.asString() === INFO_BLEIBT) continue;
        info.delete(key);
        removed.metadata++;
      }
    }
    // Der XMP-Strom am Katalog ist die zweite, oft vergessene Hälfte.
    if (katalog.get(PDFName.of("Metadata")) !== undefined) {
      katalog.delete(PDFName.of("Metadata"));
      removed.metadata++;
    }
  }

  // Erst jetzt wird gelöscht: alles, was nach dem Abhängen niemandem mehr
  // gehört. Siehe den Kopf dieser Datei.
  fegen(doc);

  return { bytes: await doc.save({ useObjectStreams: true }), removed };
}
