// =============================================================================
// PDF → PDF/A-2b bzw. PDF/A-3b (Best Effort) für den Pagebound MCP-Server.
//
// EHRLICHER SCOPE: Diese Nachbearbeitung bringt eine PDF per pdf-lib in die
// NÄHE von PDF/A-2b — sie ist KEINE Konformitätsgarantie. Was passiert:
//   0. Anhänge (nur part=3): EmbeddedFile-Stream + Filespec mit
//      /AFRelationship, verdrahtet in /Names /EmbeddedFiles UND im /AF-Array
//      des Katalogs; optional ZUGFeRD/Factur-X-Kennzeichnung im XMP inkl.
//      pdfaExtension-Schema (E-Rechnung).
//   1. XMP-Metadaten-Stream (Catalog /Metadata) mit pdfaid:part=2|3 /
//      pdfaid:conformance=B; dc:title/dc:creator etc. aus dem Info-Dict.
//   2. OutputIntent (GTS_PDFA1) mit eingebettetem sRGB-ICC-Profil.
//   3. Aufräumen: /OpenAction, /Names/JavaScript, /AA (Catalog + Seiten)
//      entfernen; AcroForm optional flatten; Trailer-ID setzen falls fehlt.
//   4. Font-Härtung (Option embedFonts, Default true): Standard-14-Fonts der
//      Familien Helvetica/Times/Courier OHNE eingebettetes Font-Programm werden
//      durch metrisch kompatible Liberation-Schriften (Sans/Serif/Mono, SIL
//      OFL 1.1, siehe mcp/fonts/LICENSE-OFL.txt) ersetzt und eingebettet:
//      pdf-lib embedFont(ttf, {subset:false}) liefert FontDescriptor+FontFile2,
//      das BESTEHENDE Font-Dict wird per Low-Level-Context auf ein einfaches
//      TrueType-Font-Dict mit WinAnsiEncoding + Widths umgebogen. Symbol/
//      ZapfDingbats und Fonts mit Differences/MacRoman-Encoding werden NICHT
//      ersetzt (nur Warnung).
//   5. Font-Embedding-PRÜFUNG: danach noch nicht eingebettete Schriften werden
//      als Warnung gemeldet — NICHT repariert.
// Was NICHT passiert (kann echte Konformität verhindern): Einbettung beliebiger
// Nicht-Standard-Fonts, Transparenz-/Farbraum-Normalisierung pro Objekt,
// Annotations-Appearance-Pflicht, eingebettete Dateien, Unicode-Mapping.
// Ergebnis für Archivzwecke extern prüfen (z. B. veraPDF).
//
// Bewusste Code-Duplikation mit der PWA-Bridge
// (src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts, convertToPdfA) —
// gleiches Muster wie design.ts.
// =============================================================================
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { NO_METADATA_BUMP, ToolError, deterministicFileId } from "./pdf.js";

// sRGB-ICC-Profil (v2, "magic" Minimalvariante, 736 Bytes).
// Quelle: https://github.com/saucecontrol/Compact-ICC-Profiles
//         (raw: profiles/sRGB-v2-magic.icc), Lizenz: CC0 1.0 (Public Domain).
const SRGB_ICC_BASE64 =
  "AAAC4GxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kk7I0qQ6wIoqY/Zqvo2eJmwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAAF4Z1RSQwAAAWgAAAF4YlRSQwAAAWgAAAF4ZGVzYwAAAAAAAAAFc1JHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAC2AAAAHAA4AFQAcACMAKgAxADhAQABIgFGAW0BlQHBAfACIAJVAosCxAMBAz8DggPGBA4EWQSnBPkFTAWkBf4GXAa+ByEHigf0CGMI1QlJCcMKPwq/C0ILyQxUDOENdA4JDqIPQA/gEIURLRHaEooTPhP2FLIVcRY2Fv0XyhiZGW4aRhsiHAMc5x3QHr0friCkIZ4inCOfJKUlsSbAJ9Uo7SoKKyssUS18Lqov3jEWMlIzlDTZNiQ3czjGOiA7fDzfPkU/sEEhQpZEEEWPRxJIm0ooS7tNUU7uUI9SNVPgVZBXRVkAWr5chF5MYBth72PHZaZniWlxa19tUW9KcUZzSnVRd155cXuIfaZ/yIHwhB6GUIiJisWNCY9RkZ+T85ZLmKubDp14n+eiW6TWp1ap26xnrvexj7Qqtsy5dLwhvtXBjcRMxxDJ2syrz3/SXNU92CTbEt4E4P7j/OcB6gztHPA081D2c/mb/Mr//w==";

// Namensraum der Factur-X-/ZUGFeRD-2.x-Kennzeichnung im XMP (Factur-X 1.0).
const FACTURX_NS = "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#";

const STANDARD_14 = new Set([
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  "Symbol", "ZapfDingbats",
]);

// --- Standard-14 → Liberation (metrisch kompatible Ersatzschriften) ----------
// Quelle der TTFs: https://github.com/liberationfonts/liberation-fonts
// Release 2.1.5 (liberation-fonts-ttf-2.1.5.tar.gz), Lizenz: SIL OFL 1.1
// (mcp/fonts/LICENSE-OFL.txt). Liberation Sans/Serif/Mono sind metrisch
// kompatibel zu Arial/Helvetica, Times New Roman/Times und Courier (New).
// Symbol/ZapfDingbats haben KEINEN Ersatz → bleiben Warnung.
const LIBERATION_MAP: Record<string, { file: string; label: string }> = {
  "Helvetica": { file: "LiberationSans-Regular.ttf", label: "Liberation Sans" },
  "Helvetica-Bold": { file: "LiberationSans-Bold.ttf", label: "Liberation Sans Bold" },
  "Helvetica-Oblique": { file: "LiberationSans-Italic.ttf", label: "Liberation Sans Italic" },
  "Helvetica-BoldOblique": { file: "LiberationSans-BoldItalic.ttf", label: "Liberation Sans Bold Italic" },
  "Times-Roman": { file: "LiberationSerif-Regular.ttf", label: "Liberation Serif" },
  "Times-Bold": { file: "LiberationSerif-Bold.ttf", label: "Liberation Serif Bold" },
  "Times-Italic": { file: "LiberationSerif-Italic.ttf", label: "Liberation Serif Italic" },
  "Times-BoldItalic": { file: "LiberationSerif-BoldItalic.ttf", label: "Liberation Serif Bold Italic" },
  "Courier": { file: "LiberationMono-Regular.ttf", label: "Liberation Mono" },
  "Courier-Bold": { file: "LiberationMono-Bold.ttf", label: "Liberation Mono Bold" },
  "Courier-Oblique": { file: "LiberationMono-Italic.ttf", label: "Liberation Mono Italic" },
  "Courier-BoldOblique": { file: "LiberationMono-BoldItalic.ttf", label: "Liberation Mono Bold Italic" },
};

// WinAnsiEncoding (CP1252): Codes 0x80–0x9F weichen von Unicode/Latin-1 ab.
// Nicht belegte Codes zeigen laut PDF-Spec auf "bullet" (U+2022).
const WINANSI_OVERRIDES: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

const winAnsiToUnicode = (code: number): number => {
  if (code === 0x7f) return 0x2022; // nicht belegt → bullet
  if (code >= 0x80 && code <= 0x9f) return WINANSI_OVERRIDES[code] ?? 0x2022;
  if (code === 0xa0) return 0x0020; // nbsp → Breite des Leerzeichens
  if (code === 0xad) return 0x002d; // soft hyphen → Breite des Bindestrichs
  return code;
};

/** Liest eine Liberation-TTF aus mcp/fonts/ (Pfad robust relativ zu dist via import.meta.url). */
const loadLiberationTtf = async (file: string): Promise<Uint8Array> => {
  const url = new URL(`../fonts/${file}`, import.meta.url);
  try {
    return new Uint8Array(await readFile(url));
  } catch (e) {
    throw new ToolError(`Ersatzschrift '${file}' nicht gefunden (${url.pathname}) — Installation unvollständig? (${e instanceof Error ? e.message : String(e)})`, "INTERNAL");
  }
};

/** Encoding-Eintrag eines Font-Dicts: dürfen wir gefahrlos WinAnsi setzen? */
function encodingAllowsWinAnsi(dict: PDFDict, ctx: PDFDocument["context"]): boolean {
  const encRaw = dict.get(PDFName.of("Encoding"));
  if (!encRaw) return true;
  const enc = encRaw instanceof PDFRef ? ctx.lookup(encRaw) : encRaw;
  if (enc instanceof PDFName) {
    const n = enc.decodeText();
    return n === "WinAnsiEncoding" || n === "StandardEncoding" || n === "PDFDocEncoding";
  }
  if (enc instanceof PDFDict) {
    if (enc.has(PDFName.of("Differences"))) return false; // Custom-Mapping nicht überschreiben
    const base = enc.lookupMaybe(PDFName.of("BaseEncoding"), PDFName)?.decodeText();
    return base === undefined || base === "WinAnsiEncoding" || base === "StandardEncoding" || base === "PDFDocEncoding";
  }
  return false;
}

/**
 * Bettet für nicht eingebettete Standard-14-Fonts der Familien Helvetica/Times/
 * Courier metrisch kompatible Liberation-Schriften ein. Technik: pdf-lib
 * embedFont(ttf, {subset:false}) erzeugt FontDescriptor + FontFile2; das
 * BESTEHENDE Font-Dict wird in ein einfaches TrueType-Font-Dict mit
 * WinAnsiEncoding + Widths-Array umgeschrieben (Referenzen in den Resources
 * bleiben unverändert gültig). Die pdf-lib-eigenen Type0-Hilfsobjekte werden
 * wieder aus dem Kontext entfernt. Liefert Hinweis-/Warnungstexte.
 */
async function embedStandard14Replacements(
  doc: PDFDocument,
  loadTtf: (file: string) => Promise<Uint8Array>
): Promise<string[]> {
  const notes: string[] = [];
  const ctx = doc.context;
  const fontType = PDFName.of("Font");

  const descriptorHasFontFile = (fd: PDFDict | undefined): boolean =>
    !!fd && (fd.has(PDFName.of("FontFile")) || fd.has(PDFName.of("FontFile2")) || fd.has(PDFName.of("FontFile3")));

  // 1) Kandidaten sammeln: einfache Standard-14-Fonts ohne Font-Programm.
  const candidates = new Map<string, PDFDict[]>(); // Std14-Name → Font-Dicts
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Type")) !== fontType) continue;
    const subtype = obj.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
    if (subtype !== "Type1" && subtype !== "MMType1" && subtype !== "TrueType") continue;
    const base = cleanFontName(obj.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.decodeText() ?? "");
    const replacement = LIBERATION_MAP[base];
    if (!replacement) continue;
    const fd = obj.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (descriptorHasFontFile(fd)) continue; // bereits eingebettet
    if (!encodingAllowsWinAnsi(obj, ctx)) {
      notes.push(`Schrift "${base}" hat ein eigenes Encoding (Differences/MacRoman) — Ersatz-Einbettung übersprungen, Schrift bleibt nicht eingebettet.`);
      continue;
    }
    const list = candidates.get(base) ?? [];
    list.push(obj);
    candidates.set(base, list);
  }
  if (candidates.size === 0) return notes;

  doc.registerFontkit(fontkit);

  // 2) Je Familie/Schnitt eine Liberation-TTF einbetten und Widths berechnen.
  const embedded: {
    std14: string; label: string; dicts: PDFDict[];
    fontRef: PDFRef; widths: number[];
  }[] = [];
  for (const [std14, dicts] of candidates) {
    const { file, label } = LIBERATION_MAP[std14];
    const ttf = await loadTtf(file);
    const font = await doc.embedFont(ttf, { subset: false });
    const widths: number[] = [];
    for (let code = 32; code <= 255; code++) {
      let w = 0;
      try { w = Math.round(font.widthOfTextAtSize(String.fromCodePoint(winAnsiToUnicode(code)), 1000)); }
      catch { w = 0; }
      widths.push(w);
    }
    embedded.push({ std14, label, dicts, fontRef: font.ref, widths });
  }

  // 3) flush() materialisiert die Type0-Objekte (Descriptor + FontFile2) im Kontext.
  await doc.flush();

  for (const item of embedded) {
    const t0 = ctx.lookup(item.fontRef);
    if (!(t0 instanceof PDFDict)) continue; // defensiv — sollte nie passieren
    const baseFont = t0.get(PDFName.of("BaseFont"));
    const descendants = t0.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
    const cidRef = descendants?.get(0);
    const cidDict = cidRef instanceof PDFRef ? ctx.lookup(cidRef) : undefined;
    if (!(cidDict instanceof PDFDict) || !(baseFont instanceof PDFName)) continue;
    const fdRef = cidDict.get(PDFName.of("FontDescriptor"));
    const fdDict = fdRef instanceof PDFRef ? ctx.lookup(fdRef) : undefined;
    if (!(fdRef instanceof PDFRef) || !(fdDict instanceof PDFDict)) continue;

    // Flags für einfache TrueType-Fonts mit WinAnsiEncoding: nonsymbolic
    // (Bit 6) statt symbolic (Bit 3) — pdf-lib setzt für CID-Fonts symbolic.
    const flags = fdDict.lookupMaybe(PDFName.of("Flags"), PDFNumber)?.asNumber() ?? 32;
    fdDict.set(PDFName.of("Flags"), PDFNumber.of((flags & ~4) | 32));

    // pdf-lib-Hilfsobjekte (Type0-Dict, CIDFont-Dict, ToUnicode-CMap) wieder
    // entfernen — Descriptor + FontFile2 bleiben referenziert.
    const toUniRef = t0.get(PDFName.of("ToUnicode"));
    ctx.delete(item.fontRef);
    if (cidRef instanceof PDFRef) ctx.delete(cidRef);
    if (toUniRef instanceof PDFRef) ctx.delete(toUniRef);

    const widthsRef = ctx.register(ctx.obj(item.widths));

    // 4) Bestehende Font-Dicts in place auf das eingebettete TrueType umbiegen.
    for (const dict of item.dicts) {
      dict.set(PDFName.of("Subtype"), PDFName.of("TrueType"));
      dict.set(PDFName.of("BaseFont"), baseFont);
      dict.set(PDFName.of("Encoding"), PDFName.of("WinAnsiEncoding"));
      dict.set(PDFName.of("FirstChar"), PDFNumber.of(32));
      dict.set(PDFName.of("LastChar"), PDFNumber.of(255));
      dict.set(PDFName.of("Widths"), widthsRef);
      dict.set(PDFName.of("FontDescriptor"), fdRef);
    }
    notes.push(`Schrift "${item.std14}" wurde durch "${item.label}" ersetzt und eingebettet (metrisch kompatibel, SIL OFL 1.1).`);
  }
  return notes;
}

// --- Anhänge (PDF/A-3) ---------------------------------------------------------
// PDF/A-2 erlaubt eingebettete Dateien nur, wenn sie selbst PDF/A sind; erst
// PDF/A-3 lässt beliebige Dateien zu. Genau darauf beruht die E-Rechnung
// (ZUGFeRD/Factur-X): ein PDF/A-3, in dem die maschinenlesbare XML-Rechnung als
// Anhang mit /AFRelationship /Alternative steckt.

/** /AFRelationship — Verhältnis des Anhangs zum Dokument (ISO 32000-2, 14.13). */
export type AfRelationship = "Source" | "Data" | "Alternative" | "Supplement" | "Unspecified";

export interface PdfAAttachment {
  /** Dateiname im PDF (/F und /UF), z. B. "factur-x.xml". */
  name: string;
  bytes: Uint8Array;
  /** MIME-Typ für /Subtype des EmbeddedFile-Streams (Default: application/octet-stream). */
  mimeType?: string;
  /** Beschreibung (/Desc am Filespec). */
  description?: string;
  /** /AFRelationship (Default: "Alternative" — der Fall der E-Rechnung). */
  relationship?: AfRelationship;
  /**
   * /Params /ModDate. OHNE Angabe wird KEIN Datum geschrieben — sonst wäre die
   * Ausgabe nicht mehr byte-gleich reproduzierbar (siehe D2 im Pack-CRM-ADR).
   */
  modDate?: Date;
}

/**
 * ZUGFeRD/Factur-X-Kennzeichnung im XMP. Die fx-Eigenschaften liegen außerhalb
 * der Standard-Schemata, deshalb schreibt buildXmp zusätzlich das von PDF/A
 * geforderte Erweiterungsschema (pdfaExtension).
 */
export interface FacturXInfo {
  /** fx:DocumentType (Default: "INVOICE"). */
  documentType?: string;
  /** fx:DocumentFileName — muss zum Namen des XML-Anhangs passen. */
  documentFileName: string;
  /** fx:Version (Default: "1.0"). */
  version?: string;
  /** fx:ConformanceLevel, z. B. "EN 16931", "BASIC", "MINIMUM", "EXTENDED". */
  conformanceLevel?: string;
}

export interface PdfAOptions {
  /** AcroForm-Felder einbrennen (Default: true). */
  flattenForm?: boolean;
  /** Nicht eingebettete Standard-14-Fonts ersetzen (Default: true). */
  embedFonts?: boolean;
  /** PDF/A-Teil: 2 (Default) oder 3 (erlaubt beliebige eingebettete Dateien). */
  part?: 2 | 3;
  /** Dateien, die eingebettet werden sollen (verlangt part=3). */
  attachments?: PdfAAttachment[];
  /** ZUGFeRD/Factur-X-Kennzeichnung im XMP. */
  facturX?: FacturXInfo;
  /**
   * Dokumentdatum (ISO 8601). Wird als /CreationDate und /ModDate ins
   * Info-Dict und in das XMP geschrieben. Ohne Angabe werden die Daten des
   * Eingabedokuments übernommen; hat auch das keine, bleibt das Ergebnis
   * datumslos — die Systemuhr wird bewusst NICHT befragt, sonst wäre die
   * Ausgabe nicht mehr byte-gleich reproduzierbar.
   */
  documentDate?: Date;
}

/** PDF-Datum (D:YYYYMMDDhhmmssZ, UTC) für /Params /ModDate. */
function toPdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export interface PdfAResult {
  bytes: Uint8Array;
  warnings: string[];
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Kein Rückfall auf die Systemuhr — ein erfundenes Datum machte die Ausgabe
// unreproduzierbar. Fehlt das Datum, bleibt das XMP an dieser Stelle leer
// (oder der Aufrufer gibt documentDate mit).
const isoDate = (d: Date | undefined): string | undefined => d?.toISOString();

/** Entfernt das Subset-Präfix ("ABCDEF+Arial" → "Arial") für lesbare Warnungen. */
const cleanFontName = (raw: string): string => raw.replace(/^[A-Z]{6}\+/, "");

/**
 * Erweiterungsschema für die fx-Eigenschaften (ZUGFeRD/Factur-X). PDF/A verlangt,
 * dass jede XMP-Eigenschaft außerhalb der bekannten Schemata über
 * pdfaExtension beschrieben wird — ohne diesen Block meldet veraPDF einen
 * Verstoß, obwohl die Werte selbst korrekt sind.
 */
function facturXExtensionSchema(): string {
  const prop = (name: string, description: string): string =>
    `      <rdf:li rdf:parseType="Resource">\n` +
    `       <pdfaProperty:name>${name}</pdfaProperty:name>\n` +
    `       <pdfaProperty:valueType>Text</pdfaProperty:valueType>\n` +
    `       <pdfaProperty:category>external</pdfaProperty:category>\n` +
    `       <pdfaProperty:description>${xmlEscape(description)}</pdfaProperty:description>\n` +
    `      </rdf:li>`;
  return (
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"\n` +
    `    xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"\n` +
    `    xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">\n` +
    `   <pdfaExtension:schemas>\n` +
    `    <rdf:Bag>\n` +
    `     <rdf:li rdf:parseType="Resource">\n` +
    `      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>\n` +
    `      <pdfaSchema:namespaceURI>${FACTURX_NS}</pdfaSchema:namespaceURI>\n` +
    `      <pdfaSchema:prefix>fx</pdfaSchema:prefix>\n` +
    `      <pdfaSchema:property>\n` +
    `       <rdf:Seq>\n` +
    prop("DocumentFileName", "name of the embedded XML invoice file") + "\n" +
    prop("DocumentType", "INVOICE") + "\n" +
    prop("Version", "The actual version of the standard applying to the embedded XML document") + "\n" +
    prop("ConformanceLevel", "The conformance level of the embedded XML document") + "\n" +
    `       </rdf:Seq>\n` +
    `      </pdfaSchema:property>\n` +
    `     </rdf:li>\n` +
    `    </rdf:Bag>\n` +
    `   </pdfaExtension:schemas>\n` +
    `  </rdf:Description>`
  );
}

function buildXmp(meta: {
  title?: string; author?: string; subject?: string; keywords?: string;
  creator?: string; producer?: string; createDate?: string; modifyDate?: string;
  part: 2 | 3; facturX?: FacturXInfo;
}): string {
  const lines: string[] = [];
  lines.push(`<pdfaid:part>${meta.part}</pdfaid:part>`);
  lines.push(`<pdfaid:conformance>B</pdfaid:conformance>`);
  if (meta.title) {
    lines.push(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(meta.title)}</rdf:li></rdf:Alt></dc:title>`);
  }
  if (meta.author) {
    lines.push(`<dc:creator><rdf:Seq><rdf:li>${xmlEscape(meta.author)}</rdf:li></rdf:Seq></dc:creator>`);
  }
  if (meta.subject) {
    lines.push(`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(meta.subject)}</rdf:li></rdf:Alt></dc:description>`);
  }
  if (meta.keywords) lines.push(`<pdf:Keywords>${xmlEscape(meta.keywords)}</pdf:Keywords>`);
  if (meta.creator) lines.push(`<xmp:CreatorTool>${xmlEscape(meta.creator)}</xmp:CreatorTool>`);
  if (meta.producer) lines.push(`<pdf:Producer>${xmlEscape(meta.producer)}</pdf:Producer>`);
  if (meta.createDate) lines.push(`<xmp:CreateDate>${meta.createDate}</xmp:CreateDate>`);
  if (meta.modifyDate) {
    lines.push(`<xmp:ModifyDate>${meta.modifyDate}</xmp:ModifyDate>`);
    lines.push(`<xmp:MetadataDate>${meta.modifyDate}</xmp:MetadataDate>`);
  }

  // Factur-X/ZUGFeRD: eigenes rdf:Description mit dem fx-Namensraum, plus das
  // von PDF/A geforderte Erweiterungsschema.
  let facturXBlocks = "";
  if (meta.facturX) {
    const fx = meta.facturX;
    facturXBlocks =
      "\n" + facturXExtensionSchema() + "\n" +
      `  <rdf:Description rdf:about="" xmlns:fx="${FACTURX_NS}">\n` +
      `   <fx:DocumentType>${xmlEscape(fx.documentType ?? "INVOICE")}</fx:DocumentType>\n` +
      `   <fx:DocumentFileName>${xmlEscape(fx.documentFileName)}</fx:DocumentFileName>\n` +
      `   <fx:Version>${xmlEscape(fx.version ?? "1.0")}</fx:Version>\n` +
      (fx.conformanceLevel ? `   <fx:ConformanceLevel>${xmlEscape(fx.conformanceLevel)}</fx:ConformanceLevel>\n` : "") +
      `  </rdf:Description>`;
  }

  // 2 KB Whitespace-Padding vor dem End-Packet (XMP-Spec-Empfehlung für In-Place-Edits).
  const padding = (" ".repeat(99) + "\n").repeat(20);
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"\n` +
    `    xmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
    `    xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n` +
    `    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n` +
    lines.map((l) => `   ${l}`).join("\n") + "\n" +
    `  </rdf:Description>` +
    facturXBlocks + "\n" +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    padding +
    `<?xpacket end="w"?>`
  );
}


/**
 * Prüft alle Font-Dictionaries auf eingebettete Font-Programme. Standard-14-
 * Fonts ohne Descriptor und Descriptors ohne FontFile/FontFile2/FontFile3
 * ergeben je eine Warnung. Type3-Fonts (Glyphen inline) gelten als eingebettet.
 */
function collectFontWarnings(doc: PDFDocument): string[] {
  const fontName = PDFName.of("Font");
  const missing = new Set<string>();

  const descriptorHasFontFile = (fd: PDFDict | undefined): boolean => {
    if (!fd) return false;
    return (
      fd.has(PDFName.of("FontFile")) ||
      fd.has(PDFName.of("FontFile2")) ||
      fd.has(PDFName.of("FontFile3"))
    );
  };

  const checkSimpleFont = (dict: PDFDict): void => {
    const baseRaw = dict.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.decodeText() ?? "(unbenannt)";
    const base = cleanFontName(baseRaw);
    const fd = dict.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (!descriptorHasFontFile(fd)) {
      missing.add(base + (STANDARD_14.has(base) ? " (Standard-14)" : ""));
    }
  };

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Type")) !== fontName) continue;
    const subtype = obj.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
    if (subtype === "Type3") continue; // Glyph-Prozeduren liegen inline → eingebettet
    if (subtype === "Type0") {
      const desc = obj.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
      if (!desc || desc.size() === 0) {
        checkSimpleFont(obj);
        continue;
      }
      for (let i = 0; i < desc.size(); i++) {
        const child = desc.lookup(i);
        if (child instanceof PDFDict) checkSimpleFont(child);
      }
      continue;
    }
    checkSimpleFont(obj);
  }

  return [...missing].sort().map(
    (name) => `Schrift "${name}" ist nicht eingebettet — das Ergebnis ist voraussichtlich nicht PDF/A-konform.`
  );
}

/**
 * Bettet Dateien als EmbeddedFile-Streams ein und verdrahtet sie an beiden
 * Stellen, die PDF/A-3 verlangt: im Namensbaum /Names /EmbeddedFiles (damit
 * Reader sie in der Anlagenliste zeigen) UND im /AF-Array des Katalogs (damit
 * sie als zugeordnete Datei mit /AFRelationship gelten). Liefert Hinweise.
 */
function embedAttachments(doc: PDFDocument, attachments: PdfAAttachment[]): string[] {
  const ctx = doc.context;
  const catalog = doc.catalog;
  const notes: string[] = [];

  // --- Namensbaum vorbereiten -------------------------------------------------
  let namesDict = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (!namesDict) {
    namesDict = ctx.obj({}) as PDFDict;
    catalog.set(PDFName.of("Names"), ctx.register(namesDict));
  }
  let efDict = namesDict.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  if (!efDict) {
    efDict = ctx.obj({}) as PDFDict;
    namesDict.set(PDFName.of("EmbeddedFiles"), ctx.register(efDict));
  }
  if (efDict.has(PDFName.of("Kids"))) {
    // Verzweigter Namensbaum: ein flaches /Names-Array danebenzusetzen wäre
    // ungültig. Ehrlich abbrechen statt eine kaputte Datei zu erzeugen.
    throw new ToolError(
      "Die PDF enthält bereits einen verzweigten Namensbaum für eingebettete Dateien (/Names /EmbeddedFiles /Kids) — " +
      "das Anhängen weiterer Dateien wird für diesen Fall nicht unterstützt."
    , "UNSUPPORTED");
  }

  // Bestehende Paare (Name, Filespec) unverändert übernehmen — als rohe
  // Einträge, damit vorhandene Referenzen Referenzen bleiben.
  const entries: Array<{ key: string; value: PDFObject }> = [];
  const existing = efDict.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (existing) {
    for (let i = 0; i + 1 < existing.size(); i += 2) {
      const rawKey = existing.lookup(i);
      const key = rawKey instanceof PDFString || rawKey instanceof PDFHexString ? rawKey.decodeText() : "";
      entries.push({ key, value: existing.get(i + 1) });
    }
  }

  // --- /AF-Array des Katalogs -------------------------------------------------
  let afArray = catalog.lookupMaybe(PDFName.of("AF"), PDFArray);
  if (!afArray) {
    afArray = ctx.obj([]) as PDFArray;
    catalog.set(PDFName.of("AF"), afArray);
  }

  for (const att of attachments) {
    if (!att.name) throw new ToolError("Ein Anhang ohne Dateinamen kann nicht eingebettet werden.");
    if (entries.some((e) => e.key === att.name)) {
      throw new ToolError(`Die PDF enthält bereits einen Anhang namens '${att.name}'.`);
    }

    // EmbeddedFile-Stream (unkomprimiert — wie der ICC-Stream; PDF/A-tauglich
    // und reproduzierbar, weil keine Kompressionsparameter mitspielen).
    const params = ctx.obj({});
    params.set(PDFName.of("Size"), PDFNumber.of(att.bytes.length));
    if (att.modDate) params.set(PDFName.of("ModDate"), PDFString.of(toPdfDate(att.modDate)));
    const efStream = ctx.stream(att.bytes, {
      Type: "EmbeddedFile",
      Subtype: att.mimeType || "application/octet-stream", // PDFName escapt '/' als #2F
    });
    efStream.dict.set(PDFName.of("Params"), params);
    const efRef = ctx.register(efStream);

    // Filespec: /F (ASCII) und /UF (UTF-16BE) — PDF/A-3 will beide.
    const filespec = ctx.obj({ Type: "Filespec" });
    filespec.set(PDFName.of("F"), PDFString.of(att.name));
    filespec.set(PDFName.of("UF"), PDFHexString.fromText(att.name));
    if (att.description) filespec.set(PDFName.of("Desc"), PDFHexString.fromText(att.description));
    filespec.set(PDFName.of("AFRelationship"), PDFName.of(att.relationship ?? "Alternative"));
    const ef = ctx.obj({});
    ef.set(PDFName.of("F"), efRef);
    ef.set(PDFName.of("UF"), efRef);
    filespec.set(PDFName.of("EF"), ef);
    const filespecRef = ctx.register(filespec);

    entries.push({ key: att.name, value: filespecRef });
    afArray.push(filespecRef);
    notes.push(
      `Datei "${att.name}" (${att.bytes.length} Bytes, ${att.mimeType || "application/octet-stream"}) ` +
      `wurde mit /AFRelationship /${att.relationship ?? "Alternative"} eingebettet.`
    );
  }

  // Das /Names-Array eines Namensbaums MUSS nach Schlüssel sortiert sein.
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const flat: PDFObject[] = [];
  for (const e of entries) {
    flat.push(PDFString.of(e.key));
    flat.push(e.value);
  }
  efDict.set(PDFName.of("Names"), ctx.obj(flat));

  return notes;
}

/**
 * Konvertiert eine PDF Richtung PDF/A-2b oder PDF/A-3b (Best Effort). Liefert
 * die neuen Bytes plus ehrliche Warnungen (z. B. nicht eingebettete Schriften).
 * Mit embedFonts=true (Default) werden nicht eingebettete Standard-14-Fonts
 * (Helvetica/Times/Courier) durch eingebettete Liberation-Fonts ersetzt.
 *
 * PDF/A-3 (part=3) erlaubt zusätzlich beliebige eingebettete Dateien — der Fall
 * der E-Rechnung: die XML-Rechnung als Anhang mit /AFRelationship /Alternative,
 * gekennzeichnet über facturX im XMP. Konformität extern prüfen (veraPDF).
 */
export async function toPdfA(input: Uint8Array, opts: PdfAOptions = {}): Promise<PdfAResult> {
  const flattenForm = opts.flattenForm ?? true;
  const embedFonts = opts.embedFonts ?? true;
  const part = opts.part ?? 2;
  const attachments = opts.attachments ?? [];
  if (part !== 2 && part !== 3) {
    throw new ToolError(`Ungültiger PDF/A-Teil '${part}' — unterstützt werden 2 und 3.`);
  }
  if (attachments.length > 0 && part !== 3) {
    throw new ToolError(
      "Eingebettete Dateien sind erst ab PDF/A-3 zulässig (PDF/A-2 erlaubt nur eingebettete PDF/A-Dateien) — bitte part=3 setzen."
    );
  }
  if (opts.facturX && part !== 3) {
    throw new ToolError("Eine ZUGFeRD/Factur-X-Kennzeichnung ergibt nur mit part=3 Sinn — bitte part=3 setzen.");
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, NO_METADATA_BUMP);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(m)) {
      throw new ToolError(`PDF ist passwortgeschützt/verschlüsselt — PDF/A verbietet Verschlüsselung; bitte zuerst entschlüsseln. (${m})`, "PDF_ENCRYPTED");
    }
    throw new ToolError(`Keine gültige PDF oder beschädigt (${m}).`, "PDF_CORRUPT");
  }

  const warnings: string[] = [];
  const catalog = doc.catalog;
  const ctx = doc.context;

  // --- 1) AcroForm: optional flatten (Default), sonst nur melden ------------
  const hasAcroForm = catalog.has(PDFName.of("AcroForm"));
  if (hasAcroForm) {
    const fieldCount = (() => {
      try { return doc.getForm().getFields().length; } catch { return 0; }
    })();
    if (fieldCount > 0 && flattenForm) {
      try {
        doc.getForm().flatten();
        catalog.delete(PDFName.of("AcroForm"));
        warnings.push(`${fieldCount} Formularfeld(er) wurden eingebrannt (flatten).`);
      } catch (e) {
        warnings.push(`AcroForm-Flatten fehlgeschlagen (${e instanceof Error ? e.message : String(e)}) — Felder bleiben erhalten; PDF/A-Konformität dadurch unsicher.`);
      }
    } else if (fieldCount > 0) {
      warnings.push(`${fieldCount} Formularfeld(er) bleiben erhalten (flatten=false) — Felder ohne Appearance-Streams verletzen PDF/A.`);
    }
  }

  // --- 2) Aufräumen: aktive Inhalte/Aktionen entfernen ----------------------
  if (catalog.has(PDFName.of("OpenAction"))) {
    catalog.delete(PDFName.of("OpenAction"));
    warnings.push("/OpenAction wurde entfernt (in PDF/A nicht erlaubt).");
  }
  if (catalog.has(PDFName.of("AA"))) {
    catalog.delete(PDFName.of("AA"));
    warnings.push("Additional Actions (/AA) am Catalog wurden entfernt.");
  }
  const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names?.has(PDFName.of("JavaScript"))) {
    names.delete(PDFName.of("JavaScript"));
    warnings.push("Dokument-JavaScript (/Names/JavaScript) wurde entfernt.");
  }
  let pageAaRemoved = 0;
  for (const page of doc.getPages()) {
    if (page.node.has(PDFName.of("AA"))) {
      page.node.delete(PDFName.of("AA"));
      pageAaRemoved++;
    }
  }
  if (pageAaRemoved > 0) {
    warnings.push(`Additional Actions (/AA) auf ${pageAaRemoved} Seite(n) wurden entfernt.`);
  }

  // --- 3) OutputIntent (GTS_PDFA1) mit sRGB-ICC-Profil -----------------------
  const iccBytes = new Uint8Array(Buffer.from(SRGB_ICC_BASE64, "base64"));
  const iccStream = ctx.stream(iccBytes, { N: 3 });
  const iccRef = ctx.register(iccStream);
  const intent = ctx.obj({ Type: "OutputIntent", S: "GTS_PDFA1" });
  intent.set(PDFName.of("OutputConditionIdentifier"), PDFString.of("sRGB IEC61966-2.1"));
  intent.set(PDFName.of("Info"), PDFString.of("sRGB IEC61966-2.1"));
  intent.set(PDFName.of("RegistryName"), PDFString.of("http://www.color.org"));
  intent.set(PDFName.of("DestOutputProfile"), iccRef);
  catalog.set(PDFName.of("OutputIntents"), ctx.obj([ctx.register(intent)]));

  // --- 3b) Dokumentdatum (falls vorgegeben) ---------------------------------
  // Info-Dict und XMP müssen übereinstimmen, deshalb wird beides aus derselben
  // Quelle gespeist: dem übergebenen Datum, sonst dem des Eingabedokuments.
  if (opts.documentDate) {
    doc.setCreationDate(opts.documentDate);
    doc.setModificationDate(opts.documentDate);
  }

  // --- 4) XMP-Metadaten-Stream (unkomprimiert, wie PDF/A es verlangt) --------
  const xmp = buildXmp({
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
    subject: doc.getSubject() || undefined,
    keywords: doc.getKeywords() || undefined,
    creator: doc.getCreator() || undefined,
    producer: doc.getProducer() || undefined,
    createDate: isoDate(doc.getCreationDate() ?? undefined),
    modifyDate: isoDate(doc.getModificationDate() ?? undefined),
    part,
    facturX: opts.facturX,
  });
  if (!doc.getCreationDate() && !doc.getModificationDate()) {
    warnings.push(
      "Das Dokument trägt kein Erstellungsdatum — das XMP bleibt datumslos (die Systemuhr wird bewusst nicht befragt, " +
      "sonst wäre die Ausgabe nicht byte-gleich reproduzierbar). Für Archivzwecke documentDate mitgeben."
    );
  }
  const xmpStream = ctx.stream(new TextEncoder().encode(xmp), { Type: "Metadata", Subtype: "XML" });
  catalog.set(PDFName.of("Metadata"), ctx.register(xmpStream));

  // --- 5) Trailer-ID setzen, falls keine vorhanden ---------------------------
  // AUS DEM INHALT abgeleitet, nicht aus dem Zufallsgenerator: sonst hätte
  // dasselbe Dokument bei jedem Lauf eine andere Kennung und damit andere
  // Bytes. Der Hash läuft über die Eingabe plus die Parameter, die das
  // Ergebnis verändern.
  if (!ctx.trailerInfo.ID) {
    const hex = deterministicFileId(
      input,
      `part=${part};flatten=${flattenForm};fonts=${embedFonts}`,
      ...attachments.map((a) => `${a.name}:${a.bytes.length}`),
    );
    const id = PDFHexString.of(hex);
    ctx.trailerInfo.ID = ctx.obj([id, id]);
  }

  // --- 5b) Anhänge einbetten (nur PDF/A-3) ----------------------------------
  if (attachments.length > 0) {
    warnings.push(...embedAttachments(doc, attachments));
  }
  if (opts.facturX) {
    const named = opts.facturX.documentFileName;
    if (!attachments.some((a) => a.name === named)) {
      warnings.push(
        `Die Factur-X-Kennzeichnung nennt "${named}", aber kein Anhang heißt so — ` +
        "Prüfer erwarten unter fx:DocumentFileName den Namen der eingebetteten XML-Rechnung."
      );
    }
  }
  if (part === 3 && attachments.length === 0) {
    warnings.push("PDF/A-3 wurde ausgezeichnet, aber keine Datei eingebettet — ohne Anhang wäre PDF/A-2b die passendere Stufe.");
  }

  // --- 6) Font-Härtung: Standard-14 → Liberation einbetten (optional) --------
  if (embedFonts) {
    warnings.push(...await embedStandard14Replacements(doc, loadLiberationTtf));
  }

  // --- 7) Font-Embedding-Prüfung (nur melden, nichts reparieren) -------------
  warnings.push(...collectFontWarnings(doc));

  // Klassische xref-Struktur für maximale Validator-Kompatibilität. Das
  // Info-Dict bleibt konsistent zum XMP-Paket, weil das Dokument mit
  // NO_METADATA_BUMP geladen wurde — pdf-lib würde sonst schon beim LADEN
  // /ModDate und /Producer mit der aktuellen Uhrzeit überschreiben.
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, warnings };
}
