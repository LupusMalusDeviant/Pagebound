// =============================================================================
// PDF/UA-Vorbereitung + Prüfbericht (Best Effort) für den Pagebound MCP-Server.
//
// EHRLICHER SCOPE: preparePdfUa setzt die maschinenlesbare KENNZEICHNUNG, die
// PDF/UA-1 verlangt, und liefert einen ehrlichen PRÜFBERICHT — es stellt KEINE
// PDF/UA-Konformität her. Was passiert:
//   1. /MarkInfo <</Marked true>> am Catalog.
//   2. Catalog /Lang (Parameter, Default "de-DE").
//   3. /ViewerPreferences /DisplayDocTitle true.
//   4. XMP-Metadaten mit pdfuaid:part=1 (+ dc:title etc. aus dem Info-Dict).
// Was der Report NUR MELDET (nicht repariert):
//   • fehlender /StructTreeRoot — echtes Tagging (Strukturbaum, Lesereihenfolge,
//     Rollen) kann nicht synthetisiert werden; ohne Tags ist PDF/UA unerreichbar.
//   • fehlender Dokumenttitel.
//   • Bild-XObjects vs. Strukturelemente mit /Alt (Alternativtexte).
//   • Fonts ohne /ToUnicode-Mapping.
//
// Bewusste Code-Duplikation mit der PWA-Bridge
// (src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts, preparePdfUa) —
// gleiches Muster wie pdfa.ts/design.ts.
// =============================================================================
import {
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
} from "pdf-lib";
import { ToolError } from "./pdf.js";

export interface PdfUaResult {
  bytes: Uint8Array;
  /** Ehrlicher Bericht: angewandte Kennzeichnungen + gefundene Hürden. */
  report: string[];
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

function buildUaXmp(meta: {
  title?: string; author?: string; subject?: string;
  createDate: string; modifyDate: string;
}): string {
  const lines: string[] = [];
  lines.push(`<pdfuaid:part>1</pdfuaid:part>`);
  if (meta.title) {
    lines.push(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(meta.title)}</rdf:li></rdf:Alt></dc:title>`);
  }
  if (meta.author) {
    lines.push(`<dc:creator><rdf:Seq><rdf:li>${xmlEscape(meta.author)}</rdf:li></rdf:Seq></dc:creator>`);
  }
  if (meta.subject) {
    lines.push(`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(meta.subject)}</rdf:li></rdf:Alt></dc:description>`);
  }
  lines.push(`<xmp:CreateDate>${meta.createDate}</xmp:CreateDate>`);
  lines.push(`<xmp:ModifyDate>${meta.modifyDate}</xmp:ModifyDate>`);
  lines.push(`<xmp:MetadataDate>${meta.modifyDate}</xmp:MetadataDate>`);

  const padding = (" ".repeat(99) + "\n").repeat(20);
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"\n` +
    `    xmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
    `    xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n` +
    lines.map((l) => `   ${l}`).join("\n") + "\n" +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    padding +
    `<?xpacket end="w"?>`
  );
}

/** Zählt Bild-XObjects (unique Referenzen) über die /Resources aller Seiten. */
function countImageXObjects(doc: PDFDocument): number {
  const seen = new Set<string>();
  for (const page of doc.getPages()) {
    const res = page.node.Resources();
    const xobjects = res?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xobjects) continue;
    for (const [name] of xobjects.entries()) {
      const raw = xobjects.get(name);
      const obj = xobjects.lookupMaybe(name, PDFDict);
      const subtype = obj?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
      if (subtype === "Image") seen.add(String(raw ?? name));
    }
  }
  return seen.size;
}

/** Zählt Strukturelemente mit /Alt-Eintrag (Alternativtexte) im ganzen Dokument. */
function countStructElemsWithAlt(doc: PDFDocument): number {
  let count = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.has(PDFName.of("S")) && obj.has(PDFName.of("Alt"))) count++;
  }
  return count;
}

/**
 * Zählt Font-Dicts ohne /ToUnicode. Descendant-CIDFonts (CIDFontType0/2)
 * werden übersprungen — das ToUnicode-Mapping trägt ihr Type0-Parent.
 */
function countFontsWithoutToUnicode(doc: PDFDocument): number {
  const fontType = PDFName.of("Font");
  let count = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Type")) !== fontType) continue;
    const subtype = obj.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
    if (subtype === "CIDFontType0" || subtype === "CIDFontType2") continue;
    if (!obj.has(PDFName.of("ToUnicode"))) count++;
  }
  return count;
}

/**
 * Bereitet eine PDF Richtung PDF/UA-1 vor (Kennzeichnung) und erstellt einen
 * ehrlichen Prüfbericht. KEINE Konformitätsgarantie — echtes Tagging liegt
 * außerhalb des Scopes und wird nicht synthetisiert.
 */
export async function preparePdfUa(input: Uint8Array, opts: { lang?: string } = {}): Promise<PdfUaResult> {
  const lang = (opts.lang ?? "de-DE").trim();
  if (!LANG_RE.test(lang)) {
    throw new ToolError(`Ungültiger Sprachcode '${lang}' — erwartet wird BCP-47 (z. B. "de-DE", "en-US").`);
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(m)) {
      throw new ToolError(`PDF ist passwortgeschützt/verschlüsselt — bitte zuerst entschlüsseln. (${m})`);
    }
    throw new ToolError(`Keine gültige PDF oder beschädigt (${m}).`);
  }

  const report: string[] = [];
  const catalog = doc.catalog;
  const ctx = doc.context;

  // --- 1) Kennzeichnung setzen ------------------------------------------------
  const markInfo = catalog.lookupMaybe(PDFName.of("MarkInfo"), PDFDict) ?? ctx.obj({});
  markInfo.set(PDFName.of("Marked"), PDFBool.True);
  catalog.set(PDFName.of("MarkInfo"), markInfo);

  catalog.set(PDFName.of("Lang"), PDFString.of(lang));

  const viewerPrefs = catalog.lookupMaybe(PDFName.of("ViewerPreferences"), PDFDict) ?? ctx.obj({});
  viewerPrefs.set(PDFName.of("DisplayDocTitle"), PDFBool.True);
  catalog.set(PDFName.of("ViewerPreferences"), viewerPrefs);

  const nowIso = new Date().toISOString();
  const xmp = buildUaXmp({
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
    subject: doc.getSubject() || undefined,
    createDate: doc.getCreationDate()?.toISOString() ?? nowIso,
    modifyDate: doc.getModificationDate()?.toISOString() ?? nowIso,
  });
  const xmpStream = ctx.stream(new TextEncoder().encode(xmp), { Type: "Metadata", Subtype: "XML" });
  catalog.set(PDFName.of("Metadata"), ctx.register(xmpStream));

  report.push(`Kennzeichnung gesetzt: /MarkInfo (Marked), /Lang "${lang}", /DisplayDocTitle, XMP pdfuaid:part=1.`);

  // --- 2) Prüfbericht (nur melden, nichts reparieren) --------------------------
  const tagged = catalog.has(PDFName.of("StructTreeRoot"));
  if (!tagged) {
    report.push("Dokument ist nicht getaggt (kein /StructTreeRoot) — echtes Tagging (Strukturbaum, Lesereihenfolge, Rollen) kann nicht synthetisiert werden; ohne Tags ist PDF/UA-Konformität nicht erreichbar.");
  }

  if (!doc.getTitle()) {
    report.push("Kein Dokumenttitel gesetzt — PDF/UA verlangt einen Titel (dc:title), der per /DisplayDocTitle angezeigt wird. Vorher per Metadaten-Editor/pdf_set_metadata setzen.");
  }

  const imageCount = countImageXObjects(doc);
  if (imageCount > 0) {
    const altCount = tagged ? countStructElemsWithAlt(doc) : 0;
    report.push(`${imageCount} Bild-XObject(s) gefunden, ${altCount} Strukturelement(e) mit Alternativtext (/Alt) — Bilder ohne /Alt sind für Screenreader unzugänglich.`);
  }

  const fontsNoUni = countFontsWithoutToUnicode(doc);
  if (fontsNoUni > 0) {
    report.push(`${fontsNoUni} Schrift(en) ohne /ToUnicode-Mapping — Textextraktion/Vorlesen kann unzuverlässig sein (Standard-Encodings mildern das teilweise).`);
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, report };
}
