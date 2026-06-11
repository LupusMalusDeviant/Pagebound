// =============================================================================
// PDF → PDF/A-2b (Best Effort) für den Pagebound MCP-Server.
//
// EHRLICHER SCOPE: Diese Nachbearbeitung bringt eine PDF per pdf-lib in die
// NÄHE von PDF/A-2b — sie ist KEINE Konformitätsgarantie. Was passiert:
//   1. XMP-Metadaten-Stream (Catalog /Metadata) mit pdfaid:part=2 /
//      pdfaid:conformance=B; dc:title/dc:creator etc. aus dem Info-Dict.
//   2. OutputIntent (GTS_PDFA1) mit eingebettetem sRGB-ICC-Profil.
//   3. Aufräumen: /OpenAction, /Names/JavaScript, /AA (Catalog + Seiten)
//      entfernen; AcroForm optional flatten; Trailer-ID setzen falls fehlt.
//   4. Font-Embedding-PRÜFUNG: nicht eingebettete Schriften werden als
//      Warnung gemeldet — NICHT repariert.
// Was NICHT passiert (kann echte Konformität verhindern): Font-Embedding,
// Transparenz-/Farbraum-Normalisierung pro Objekt, Annotations-Appearance-
// Pflicht, eingebettete Dateien, Unicode-Mapping. Ergebnis für Archivzwecke
// extern prüfen (z. B. veraPDF).
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
  PDFString,
} from "pdf-lib";
import { ToolError } from "./pdf.js";

// sRGB-ICC-Profil (v2, "magic" Minimalvariante, 736 Bytes).
// Quelle: https://github.com/saucecontrol/Compact-ICC-Profiles
//         (raw: profiles/sRGB-v2-magic.icc), Lizenz: CC0 1.0 (Public Domain).
const SRGB_ICC_BASE64 =
  "AAAC4GxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kk7I0qQ6wIoqY/Zqvo2eJmwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAAF4Z1RSQwAAAWgAAAF4YlRSQwAAAWgAAAF4ZGVzYwAAAAAAAAAFc1JHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAC2AAAAHAA4AFQAcACMAKgAxADhAQABIgFGAW0BlQHBAfACIAJVAosCxAMBAz8DggPGBA4EWQSnBPkFTAWkBf4GXAa+ByEHigf0CGMI1QlJCcMKPwq/C0ILyQxUDOENdA4JDqIPQA/gEIURLRHaEooTPhP2FLIVcRY2Fv0XyhiZGW4aRhsiHAMc5x3QHr0friCkIZ4inCOfJKUlsSbAJ9Uo7SoKKyssUS18Lqov3jEWMlIzlDTZNiQ3czjGOiA7fDzfPkU/sEEhQpZEEEWPRxJIm0ooS7tNUU7uUI9SNVPgVZBXRVkAWr5chF5MYBth72PHZaZniWlxa19tUW9KcUZzSnVRd155cXuIfaZ/yIHwhB6GUIiJisWNCY9RkZ+T85ZLmKubDp14n+eiW6TWp1ap26xnrvexj7Qqtsy5dLwhvtXBjcRMxxDJ2syrz3/SXNU92CTbEt4E4P7j/OcB6gztHPA081D2c/mb/Mr//w==";

const STANDARD_14 = new Set([
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  "Symbol", "ZapfDingbats",
]);

export interface PdfAResult {
  bytes: Uint8Array;
  warnings: string[];
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const isoDate = (d: Date | undefined): string => (d ?? new Date()).toISOString();

/** Entfernt das Subset-Präfix ("ABCDEF+Arial" → "Arial") für lesbare Warnungen. */
const cleanFontName = (raw: string): string => raw.replace(/^[A-Z]{6}\+/, "");

function buildXmp(meta: {
  title?: string; author?: string; subject?: string; keywords?: string;
  creator?: string; producer?: string; createDate: string; modifyDate: string;
}): string {
  const lines: string[] = [];
  lines.push(`<pdfaid:part>2</pdfaid:part>`);
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
  lines.push(`<xmp:CreateDate>${meta.createDate}</xmp:CreateDate>`);
  lines.push(`<xmp:ModifyDate>${meta.modifyDate}</xmp:ModifyDate>`);
  lines.push(`<xmp:MetadataDate>${meta.modifyDate}</xmp:MetadataDate>`);

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
    `  </rdf:Description>\n` +
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
 * Konvertiert eine PDF Richtung PDF/A-2b (Best Effort). Liefert die neuen
 * Bytes plus ehrliche Warnungen (z. B. nicht eingebettete Schriften).
 */
export async function toPdfA(input: Uint8Array, flattenForm = true): Promise<PdfAResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(m)) {
      throw new ToolError(`PDF ist passwortgeschützt/verschlüsselt — PDF/A verbietet Verschlüsselung; bitte zuerst entschlüsseln. (${m})`);
    }
    throw new ToolError(`Keine gültige PDF oder beschädigt (${m}).`);
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
  });
  const xmpStream = ctx.stream(new TextEncoder().encode(xmp), { Type: "Metadata", Subtype: "XML" });
  catalog.set(PDFName.of("Metadata"), ctx.register(xmpStream));

  // --- 5) Trailer-ID setzen, falls keine vorhanden ---------------------------
  if (!ctx.trailerInfo.ID) {
    const rnd = crypto.getRandomValues(new Uint8Array(16));
    let hex = "";
    for (const b of rnd) hex += b.toString(16).padStart(2, "0").toUpperCase();
    const id = PDFHexString.of(hex);
    ctx.trailerInfo.ID = ctx.obj([id, id]);
  }

  // --- 6) Font-Embedding-Prüfung (nur melden, nichts reparieren) -------------
  warnings.push(...collectFontWarnings(doc));

  // Klassische xref-Struktur für maximale Validator-Kompatibilität; pdf-lib
  // verändert das Info-Dict beim Save nicht → bleibt konsistent zum XMP-Paket.
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, warnings };
}
