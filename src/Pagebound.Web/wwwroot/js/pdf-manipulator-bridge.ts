// =============================================================================
// Pagebound — PDF-Manipulator Bridge (pdf-lib)
// ----------------------------------------------------------------------------
// Wird von Blazor WASM via IJSRuntime.InvokeAsync("pageboundPdfManipulator.<fn>", ...)
// genutzt. Nutzt pdf-lib (MIT) im Browser, weil PdfSharpCore unter Blazor WASM
// MD5.Create() in seinem SecurityHandler-Konstruktor aufruft — das schlägt in
// WASM mit "Cryptography_UnknownHashAlgorithm, MD5" fehl. pdf-lib hat dieses
// Problem nicht (keine MD5-Abhängigkeit im Save-Pfad).
//
// Entsprechende C#-Klasse: Pagebound.Infrastructure.Pdf.JsPdfLibManipulator.
// =============================================================================

import {
  PDFDocument,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  PDFRef,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  StandardFonts,
  rgb,
  degrees,
  BlendMode,
  LineCapStyle
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as pdfjsLib from "pdfjs-dist";

// Eigene Worker-Konfig — diese Bridge ist ein separater IIFE-Bundle, der
// seinen eigenen pdfjs-Modulscope hat. Der Worker selbst (gleiche .mjs-Datei)
// kann shared sein, daher reicht der Pfad wie in pdfjs-bridge.ts.
// Shim statt direkt pdf.worker.min.mjs: polyfillt Math.sumPrecise im Worker
// (pdfjs 5.7 braucht es), bevor der echte Worker lädt — sonst crasht PDF.js in
// Browsern ohne dieses sehr neue JS-API.
pdfjsLib.GlobalWorkerOptions.workerSrc = "/js/pdfjs-worker-shim.mjs";

export interface EmbeddedSignatureInput {
  pageNumber: number;
  imageBytes: Uint8Array;
  /** 0..1, Seiten-Anteil. Origin oben-links (wie im Reader-UI). */
  x: number;
  y: number;
  width: number;
  height: number;
  signedAtIso: string;
  signerName: string;
  signerEmail: string | null;
  signerReason: string | null;
  signerLocation: string | null;
  integrityHash: string | null;
}

export async function embedSignatures(
  pdfBytes: Uint8Array,
  signatures: EmbeddedSignatureInput[]
): Promise<Uint8Array> {
  if (!signatures || signatures.length === 0) {
    return pdfBytes;
  }

  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();

  for (const sig of signatures) {
    const pageIdx = sig.pageNumber - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;

    const page = pages[pageIdx];
    const img = await doc.embedPng(sig.imageBytes);
    const { width: pw, height: ph } = page.getSize();

    // pdf-lib-Origin ist unten-links — wir bekommen oben-links und rechnen um.
    page.drawImage(img, {
      x: sig.x * pw,
      y: ph - (sig.y + sig.height) * ph,
      width: sig.width * pw,
      height: sig.height * ph
    });
  }

  // Metadaten ins Info-Dictionary: Primärer Unterzeichner als /Author,
  // jede Signatur mit Custom-Keys (entspricht 1:1 dem PdfSharp-Layout aus FA-015).
  const primary = signatures.find(s => s.signerName);
  if (primary && primary.signerName) {
    doc.setAuthor(primary.signerName);
  }
  doc.setCreator("Pagebound");

  // getInfoDict() ist in pdf-lib als privat typisiert, existiert aber zur Laufzeit
  // und ist der einzige Zugang zum Info-Dictionary. Eng begrenzter Cast (kein any).
  const infoDict = (doc as unknown as { getInfoDict(): import("pdf-lib").PDFDict }).getInfoDict();
  infoDict.set(
    PDFName.of("Pagebound.SignatureCount"),
    PDFString.of(String(signatures.length))
  );

  signatures.forEach((sig, idx) => {
    const prefix = `Pagebound.Signature.${idx + 1}`;
    const setKey = (key: string, value: string | null | undefined) => {
      if (value === null || value === undefined || value === "") return;
      infoDict.set(PDFName.of(`${prefix}.${key}`), PDFString.of(value));
    };
    setKey("Page", String(sig.pageNumber));
    setKey("SignedAt", sig.signedAtIso);
    setKey("SignerName", sig.signerName);
    setKey("SignerEmail", sig.signerEmail);
    setKey("SignerReason", sig.signerReason);
    setKey("SignerLocation", sig.signerLocation);
    setKey("IntegrityHash", sig.integrityHash);
  });

  return await doc.save({ updateMetadata: false });
}

// ============================================================================
// PDF-Komprimierung (FA-026)
// ----------------------------------------------------------------------------
// Strategie: jede Seite mit PDF.js auf ein Canvas rendern, das Canvas als JPEG
// mit konfigurierbarer Quality kodieren und mit pdf-lib in eine frische PDF
// einbauen. Verliert Vektor-Text und macht die Datei eventuell nicht
// kleiner, wenn die Original-PDF bereits hoch komprimiert ist — aber für die
// typischen "Foto-PDFs mit zu großen Bildern" funktioniert es robust.
// Echte image-level-Recompression (PDF-Strukturen erhalten, nur Bilder neu
// kodieren) folgt in einer späteren Iteration.
// ============================================================================

export interface CompressOptions {
  /** JPEG-Quality 0.1 .. 0.95. */
  imageQuality: number;
  /** Optionale Auflösungs-Skalierung; 2.0 = ungefähr Display-Pixel. */
  renderScale?: number;
}

export async function compressPdf(
  pdfBytes: Uint8Array,
  options: CompressOptions
): Promise<Uint8Array> {
  const quality = Math.min(0.95, Math.max(0.1, options.imageQuality ?? 0.75));
  const renderScale = Math.max(1.0, options.renderScale ?? 2.0);

  const srcDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const outDoc = await PDFDocument.create();

  try {
    for (let i = 1; i <= srcDoc.numPages; i++) {
      const page = await srcDoc.getPage(i);
      const viewport = page.getViewport({ scale: renderScale });
      const origViewport = page.getViewport({ scale: 1 });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport, canvas: canvas as any }).promise;

      const jpegBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
      );
      if (!jpegBlob) continue;
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());

      const jpegImg = await outDoc.embedJpg(jpegBytes);
      const pdfPage = outDoc.addPage([origViewport.width, origViewport.height]);
      pdfPage.drawImage(jpegImg, {
        x: 0,
        y: 0,
        width: origViewport.width,
        height: origViewport.height
      });
    }
  } finally {
    srcDoc.loadingTask.destroy();
  }

  outDoc.setCreator("Pagebound");
  outDoc.setProducer("Pagebound Compress");
  return await outDoc.save({ updateMetadata: false });
}

// ============================================================================
// Schwärzen / Redaktion (FA — echte Redaktion, nicht nur Überdecken)
// ----------------------------------------------------------------------------
// Eine echte Redaktion muss den darunterliegenden Inhalt ENTFERNEN, nicht nur
// verdecken. Strategie: betroffene Seiten mit PDF.js auf ein Canvas rendern, die
// Schwärzungs-Rechtecke als schwarze Pixel einbrennen und die Seite als Bild
// (JPEG) in eine neue PDF einbauen — damit ist der ursprüngliche Text-/Vektor-
// Layer dieser Seite weg (nicht markier-/extrahierbar). Seiten OHNE Schwärzung
// werden vektor-treu kopiert (keine Qualitäts-/Textverluste). Koordinaten 0..1,
// Origin oben-links (wie im Reader).
// ============================================================================

export interface RedactionRegion {
  pageNumber: number; // 1-basiert
  x: number; y: number; w: number; h: number; // 0..1, oben-links
}

export async function redactPdf(pdfBytes: Uint8Array, regions: RedactionRegion[]): Promise<Uint8Array> {
  if (!regions || regions.length === 0) return pdfBytes;

  const byPage = new Map<number, RedactionRegion[]>();
  for (const r of regions) {
    const arr = byPage.get(r.pageNumber);
    if (arr) arr.push(r); else byPage.set(r.pageNumber, [r]);
  }

  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const srcDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  const out = await PDFDocument.create();

  try {
    for (let i = 1; i <= total; i++) {
      const rects = byPage.get(i);
      if (!rects || rects.length === 0) {
        const [copied] = await out.copyPages(src, [i - 1]);
        out.addPage(copied);
        continue;
      }

      const page = await srcDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const origViewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) { const [c] = await out.copyPages(src, [i - 1]); out.addPage(c); continue; }

      await page.render({ canvasContext: ctx, viewport, canvas: canvas as any }).promise;

      // Schwärzungen als schwarze Pixel einbrennen — danach ist der Text dieser
      // Seite physisch weg (die Seite wird zum Bild).
      ctx.fillStyle = "#000000";
      for (const r of rects) {
        ctx.fillRect(
          Math.floor(r.x * canvas.width),
          Math.floor(r.y * canvas.height),
          Math.ceil(r.w * canvas.width),
          Math.ceil(r.h * canvas.height));
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92));
      if (!blob) { const [c] = await out.copyPages(src, [i - 1]); out.addPage(c); continue; }
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const img = await out.embedJpg(jpeg);
      const pdfPage = out.addPage([origViewport.width, origViewport.height]);
      pdfPage.drawImage(img, { x: 0, y: 0, width: origViewport.width, height: origViewport.height });
    }
  } finally {
    srcDoc.loadingTask.destroy();
  }

  out.setCreator("Pagebound");
  out.setProducer("Pagebound Redaction");
  return await out.save({ useObjectStreams: false });
}

// ============================================================================
// AcroForms: Formularfelder lesen + ausfüllen (FA-040 / FA-041)
// ----------------------------------------------------------------------------
// pdf-lib bringt eine vollständige Form-API mit (getForm/getFields/setText/...).
// getFormFields liefert eine flache Feldliste; fillForm setzt die Werte und
// speichert — optional geflattet (Werte fixiert, Felder nicht mehr editierbar).
// Entspricht Pagebound.Infrastructure.Pdf.JsPdfFormService auf der C#-Seite.
//
// Der Feldtyp wird als String ("Text"/"Checkbox"/...) zurückgegeben, weil die
// JSInterop-Deserialisierung C#-Enums sonst als Zahl erwarten würde —
// JsPdfFormService mappt den String auf das Domain-Enum.
// ============================================================================

export interface FormFieldDto {
  name: string;
  type: "Text" | "Checkbox" | "Radio" | "Dropdown" | "ListBox";
  /** Aktuelle Werte: Text/Radio/Dropdown 0..1, Checkbox ["true"] oder [], ListBox 0..n. */
  value: string[];
  /** Wählbare Optionen bei Radio/Dropdown/ListBox; leer bei Text/Checkbox. */
  options: string[];
  readOnly: boolean;
  required: boolean;
  /** 1-basierte Seitenzahl, 0 = nicht ermittelbar. */
  pageNumber: number;
}

export interface FormFieldValueDto {
  name: string;
  value: string[];
}

export interface FillFormDto {
  flatten: boolean;
}

function classifyFormField(field: unknown): FormFieldDto["type"] | null {
  if (field instanceof PDFTextField) return "Text";
  if (field instanceof PDFCheckBox) return "Checkbox";
  if (field instanceof PDFRadioGroup) return "Radio";
  if (field instanceof PDFDropdown) return "Dropdown";
  if (field instanceof PDFOptionList) return "ListBox";
  return null; // Buttons / Signaturfelder etc. ignorieren wir bewusst
}

function safeBool(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

/**
 * Baut eine Map von Widget-Dict-Instanz → 1-basierte Seitenzahl, indem die
 * Annotation-Arrays aller Seiten durchlaufen werden. pdf-lib cached gelookupte
 * Objekte, daher ist die Dict-Instanz eines Widgets identisch mit dem Eintrag
 * im Annots-Array seiner Seite.
 */
function buildWidgetPageMap(doc: PDFDocument): Map<unknown, number> {
  const map = new Map<unknown, number>();
  const pages = doc.getPages();
  pages.forEach((page, idx) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (const ref of annots.asArray()) {
      try {
        const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
        if (obj) map.set(obj, idx + 1);
      } catch {
        // defekte/zirkuläre Referenz — überspringen
      }
    }
  });
  return map;
}

function formFieldPageNumber(field: any, widgetPageMap: Map<unknown, number>): number {
  try {
    for (const widget of field.acroField.getWidgets()) {
      const page = widgetPageMap.get(widget.dict);
      if (page) return page;
    }
  } catch {
    // Feld ohne (auflösbare) Widgets
  }
  return 0;
}

export async function getFormFields(pdfBytes: Uint8Array): Promise<FormFieldDto[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const fields = form.getFields();
  if (!fields || fields.length === 0) return [];

  const widgetPageMap = buildWidgetPageMap(doc);
  const result: FormFieldDto[] = [];

  for (const field of fields) {
    const type = classifyFormField(field);
    if (!type) continue;

    let value: string[] = [];
    let options: string[] = [];

    switch (type) {
      case "Text": {
        const t = (field as PDFTextField).getText();
        value = t ? [t] : [];
        break;
      }
      case "Checkbox":
        value = (field as PDFCheckBox).isChecked() ? ["true"] : [];
        break;
      case "Radio": {
        const rg = field as PDFRadioGroup;
        options = rg.getOptions();
        const sel = rg.getSelected();
        value = sel ? [sel] : [];
        break;
      }
      case "Dropdown": {
        const dd = field as PDFDropdown;
        options = dd.getOptions();
        value = dd.getSelected() ?? [];
        break;
      }
      case "ListBox": {
        const ol = field as PDFOptionList;
        options = ol.getOptions();
        value = ol.getSelected() ?? [];
        break;
      }
    }

    result.push({
      name: field.getName(),
      type,
      value,
      options,
      readOnly: safeBool(() => field.isReadOnly()),
      required: safeBool(() => field.isRequired()),
      pageNumber: formFieldPageNumber(field, widgetPageMap)
    });
  }

  return result;
}

export async function fillForm(
  pdfBytes: Uint8Array,
  values: FormFieldValueDto[],
  options: FillFormDto
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();

  for (const entry of values ?? []) {
    let field: any;
    try {
      field = form.getField(entry.name);
    } catch {
      continue; // Feld nicht (mehr) vorhanden
    }
    const vals = entry.value ?? [];
    try {
      if (field instanceof PDFTextField) {
        field.setText(vals.length > 0 ? vals[0] : undefined);
      } else if (field instanceof PDFCheckBox) {
        if (vals.includes("true")) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (vals.length > 0) field.select(vals[0]);
        else field.clear();
      } else if (field instanceof PDFDropdown) {
        field.clear();
        if (vals.length > 0) field.select(vals);
      } else if (field instanceof PDFOptionList) {
        field.clear();
        if (vals.length > 0) field.select(vals);
      }
    } catch (e) {
      // Einzelfeld-Fehler (Wert nicht in Optionsliste, nicht-WinAnsi-Zeichen
      // ohne eingebetteten Font, ...) nicht den ganzen Save abbrechen lassen.
      console.warn(`[pagebound] fillForm: Feld '${entry.name}' nicht setzbar:`, e);
    }
  }

  if (options?.flatten) {
    form.flatten();
  } else {
    try {
      form.updateFieldAppearances();
    } catch (e) {
      console.warn("[pagebound] fillForm: updateFieldAppearances fehlgeschlagen:", e);
    }
  }

  return await doc.save({ updateMetadata: false });
}

// ============================================================================
// Bild → PDF (FA-025)
// ----------------------------------------------------------------------------
// Erzeugt aus PNG/JPG-Bildern eine PDF — je Bild eine Seite, in übergebener
// Reihenfolge. Bilder kommen als Base64 (verschachtelte byte[] marshalled
// Blazor nicht als Uint8Array), werden hier dekodiert und mit pdf-lib
// (embedPng/embedJpg) eingebettet. Entspricht JsImageToPdfConverter.
// ============================================================================

export interface ImageInput {
  base64: string;
  mime: string;
}

export interface ImagesToPdfOptions {
  /** "image" = Seite in Bildgröße, sonst feste Seite mit eingepasstem Bild. */
  pageSize: "image" | "a4" | "letter";
  marginPt: number;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function imagesToPdf(
  images: ImageInput[],
  options: ImagesToPdfOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const A4: [number, number] = [595.28, 841.89];
  const LETTER: [number, number] = [612, 792];
  const margin = Math.max(0, options?.marginPt ?? 0);

  for (const input of images ?? []) {
    const bytes = base64ToBytes(input.base64);
    const img = (input.mime || "").toLowerCase().includes("png")
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);

    if (options?.pageSize === "image" || !options?.pageSize) {
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      continue;
    }

    // Feste Seite — Orientierung nach Bild-Seitenverhältnis, Bild "contain".
    const [shortSide, longSide] = options.pageSize === "letter" ? LETTER : A4;
    const portrait = img.height >= img.width;
    const pageW = portrait ? shortSide : longSide;
    const pageH = portrait ? longSide : shortSide;
    const page = doc.addPage([pageW, pageH]);

    const availW = Math.max(1, pageW - 2 * margin);
    const availH = Math.max(1, pageH - 2 * margin);
    const scale = Math.min(availW / img.width, availH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
  }

  doc.setCreator("Pagebound");
  doc.setProducer("Pagebound Image-to-PDF");
  return await doc.save();
}

// ============================================================================
// Seiten-Operationen (FA-020..024) + Normalize — pdf-lib statt PdfSharpCore
// ----------------------------------------------------------------------------
// PdfSharpCore.Save crasht in Blazor WASM (MD5 im Security-Handler via
// CryptoConfig-Reflection → TargetInvocationException) — selbst bei plainem
// Save. Daher laufen Merge/Split/Reorder/Delete/Rotate + Normalize hier über
// pdf-lib (copyPages/setRotation/save), das kein MD5 braucht.
// useObjectStreams:false → klassische xref-Tabelle (Voraussetzung u.a. für den
// PdfAesEncryptor, der die normalisierte Ausgabe objektweise parst).
// ============================================================================

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function normalizePdf(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  return await doc.save({ useObjectStreams: false });
}

export async function mergePdfs(pdfsBase64: string[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const b64 of pdfsBase64 ?? []) {
    const src = await PDFDocument.load(base64ToBytes(b64), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return await out.save({ useObjectStreams: false });
}

export async function splitPdf(pdfBytes: Uint8Array, splitAfterPages: number[]): Promise<string[]> {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const points = [...new Set((splitAfterPages ?? []).filter((p) => p >= 1 && p < total))].sort((a, b) => a - b);

  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  for (const sp of points) {
    ranges.push([cursor, sp]);
    cursor = sp;
  }
  ranges.push([cursor, total]);

  const results: string[] = [];
  for (const [start, end] of ranges) {
    const part = await PDFDocument.create();
    const idx: number[] = [];
    for (let i = start; i < end; i++) idx.push(i);
    const pages = await part.copyPages(src, idx);
    pages.forEach((p) => part.addPage(p));
    results.push(bytesToBase64(await part.save({ useObjectStreams: false })));
  }
  return results;
}

export async function reorderPdf(pdfBytes: Uint8Array, newOrder: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = (newOrder ?? []).map((n) => n - 1).filter((i) => i >= 0 && i < src.getPageCount());
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return await out.save({ useObjectStreams: false });
}

export async function deletePages(pdfBytes: Uint8Array, pageIndices: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const del = new Set(pageIndices ?? []);
  const keep: number[] = [];
  for (let i = 1; i <= src.getPageCount(); i++) if (!del.has(i)) keep.push(i - 1);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, keep);
  pages.forEach((p) => out.addPage(p));
  return await out.save({ useObjectStreams: false });
}

export async function rotatePages(
  pdfBytes: Uint8Array,
  rotations: Record<string, number>
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const [key, deg] of Object.entries(rotations ?? {})) {
    const idx = parseInt(key, 10) - 1;
    if (idx < 0 || idx >= pages.length) continue;
    const current = pages[idx].getRotation().angle;
    pages[idx].setRotation(degrees((((current + deg) % 360) + 360) % 360));
  }
  return await doc.save({ useObjectStreams: false });
}

// ============================================================================
// Stempeln: Wasserzeichen (diagonal) + Seitenzahlen/Bates (pdf-lib drawText)
// ============================================================================

export interface StampOptions {
  watermarkText?: string | null;
  watermarkOpacity?: number;
  watermarkFontSize?: number;
  pageNumbers?: boolean;
  pageNumberFormat?: string;
  pageNumberPosition?: "bottom-center" | "bottom-right" | "bottom-left";
  pageNumberFontSize?: number;
  pageNumberStartAt?: number;
}

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Formular-Erstellung (Roadmap D1): legt AcroForm-Felder (Text/Checkbox) an.
// Positionen kommen als 0..1-Page-Fractions (oben-links, wie im UI) und werden in
// pdf-lib-Punkte (unten-links) umgerechnet. Spiegelt die MCP-Engine `createFields`.
interface NewFormField {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  fieldType: string;
}

export async function createFormFields(pdfBytes: Uint8Array, fields: NewFormField[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const pages = doc.getPages();
  for (const f of fields ?? []) {
    const page = pages[f.pageNumber - 1];
    if (!page || !f.name) continue;
    const pw = page.getWidth();
    const ph = page.getHeight();
    const w = f.width * pw;
    const h = f.height * ph;
    const x = f.x * pw;
    const y = ph - f.y * ph - h; // oben-links-Fraction → unten-links-Punkte
    const rect = { x, y, width: w, height: h };
    try {
      if (f.fieldType === "checkbox") {
        form.createCheckBox(f.name).addToPage(page, rect);
      } else {
        form.createTextField(f.name).addToPage(page, rect);
      }
    } catch {
      // Name evtl. schon vergeben — Feld überspringen statt alles abzubrechen.
    }
  }
  return doc.save();
}

// Metadaten lesen/setzen (MCP↔PWA-Parität für pdf_set_metadata) — pdf-lib Info-Dict.
interface DocMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

export async function setMetadata(pdfBytes: Uint8Array, meta: DocMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  if (meta.title != null) doc.setTitle(meta.title);
  if (meta.author != null) doc.setAuthor(meta.author);
  if (meta.subject != null) doc.setSubject(meta.subject);
  if (meta.keywords != null) {
    doc.setKeywords(meta.keywords.split(",").map((k) => k.trim()).filter(Boolean));
  }
  return doc.save();
}

export async function getMetadata(pdfBytes: Uint8Array): Promise<DocMeta> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  return {
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: doc.getKeywords() ?? "",
  };
}

// ============================================================================
// PDF → PDF/A-2b (Best Effort) — Entsprechung zum MCP-Tool pdf_to_pdfa.
// ----------------------------------------------------------------------------
// EHRLICHER SCOPE: bringt die PDF per pdf-lib in die NÄHE von PDF/A-2b, ist
// aber KEINE Konformitätsgarantie. Schritte: XMP-Metadaten (pdfaid 2/B),
// sRGB-OutputIntent (GTS_PDFA1), /OpenAction + /Names/JavaScript + /AA
// entfernen, AcroForm optional flatten, Trailer-ID setzen.
// Font-Härtung (embedFonts, Default true): nicht eingebettete Standard-14-
// Fonts der Familien Helvetica/Times/Courier werden durch metrisch kompatible
// Liberation-Fonts (SIL OFL 1.1) ersetzt; die TTFs werden zur Laufzeit per
// fetch aus wwwroot/fonts/liberation/ geladen (bewusst NICHT ins JS-Bundle
// eingebettet — 12 TTFs ≈ 4,3 MB). Andere nicht eingebettete Schriften werden
// weiterhin NICHT repariert, nur als warnings gemeldet.
// Bewusste Code-Duplikation mit mcp/src/pdfa.ts (gleiches Muster wie design.ts).
// C#-Seite: Pagebound.Infrastructure.Pdf.JsPdfArchiveService.
// ============================================================================

// sRGB-ICC-Profil (v2, "magic" Minimalvariante, 736 Bytes).
// Quelle: https://github.com/saucecontrol/Compact-ICC-Profiles
//         (raw: profiles/sRGB-v2-magic.icc), Lizenz: CC0 1.0 (Public Domain).
const SRGB_ICC_BASE64 =
  "AAAC4GxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kk7I0qQ6wIoqY/Zqvo2eJmwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAAF4Z1RSQwAAAWgAAAF4YlRSQwAAAWgAAAF4ZGVzYwAAAAAAAAAFc1JHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAC2AAAAHAA4AFQAcACMAKgAxADhAQABIgFGAW0BlQHBAfACIAJVAosCxAMBAz8DggPGBA4EWQSnBPkFTAWkBf4GXAa+ByEHigf0CGMI1QlJCcMKPwq/C0ILyQxUDOENdA4JDqIPQA/gEIURLRHaEooTPhP2FLIVcRY2Fv0XyhiZGW4aRhsiHAMc5x3QHr0friCkIZ4inCOfJKUlsSbAJ9Uo7SoKKyssUS18Lqov3jEWMlIzlDTZNiQ3czjGOiA7fDzfPkU/sEEhQpZEEEWPRxJIm0ooS7tNUU7uUI9SNVPgVZBXRVkAWr5chF5MYBth72PHZaZniWlxa19tUW9KcUZzSnVRd155cXuIfaZ/yIHwhB6GUIiJisWNCY9RkZ+T85ZLmKubDp14n+eiW6TWp1ap26xnrvexj7Qqtsy5dLwhvtXBjcRMxxDJ2syrz3/SXNU92CTbEt4E4P7j/OcB6gztHPA081D2c/mb/Mr//w==";

const PDFA_STANDARD_14 = new Set([
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  "Symbol", "ZapfDingbats",
]);

export interface PdfAResultDto {
  dataBase64: string;
  warnings: string[];
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Entfernt das Subset-Präfix ("ABCDEF+Arial" → "Arial") für lesbare Warnungen. */
const cleanFontName = (raw: string): string => raw.replace(/^[A-Z]{6}\+/, "");

function buildPdfAXmp(meta: {
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

  // 2 KB Whitespace-Padding vor dem End-Packet (XMP-Spec-Empfehlung).
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
      missing.add(base + (PDFA_STANDARD_14.has(base) ? " (Standard-14)" : ""));
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

// --- Standard-14 → Liberation (metrisch kompatible Ersatzschriften) ----------
// Quelle der TTFs: https://github.com/liberationfonts/liberation-fonts
// Release 2.1.5, Lizenz: SIL OFL 1.1 (wwwroot/fonts/liberation/LICENSE-OFL.txt).
// Liberation Sans/Serif/Mono sind metrisch kompatibel zu Arial/Helvetica,
// Times New Roman/Times und Courier (New). Symbol/ZapfDingbats: kein Ersatz.
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

/** Lädt eine Liberation-TTF per fetch aus wwwroot/fonts/liberation/ (Base-URI-relativ, kein CDN). */
async function loadLiberationTtf(file: string): Promise<Uint8Array> {
  const url = new URL(`fonts/liberation/${file}`, document.baseURI);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Ersatzschrift '${file}' nicht ladbar (${res.status}) — fehlt wwwroot/fonts/liberation/?`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

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
 * Identische Engine wie mcp/src/pdfa.ts (bewusste Duplikation).
 */
async function embedStandard14Replacements(doc: PDFDocument): Promise<string[]> {
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
    const ttf = await loadLiberationTtf(file);
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

export async function convertToPdfA(pdfBytes: Uint8Array, flattenForm: boolean, embedFonts: boolean = true): Promise<PdfAResultDto> {
  // Bewusst OHNE ignoreEncryption: PDF/A verbietet Verschlüsselung; eine
  // verschlüsselte Eingabe soll mit klarer Fehlermeldung scheitern.
  const doc = await PDFDocument.load(pdfBytes);
  const warnings: string[] = [];
  const catalog = doc.catalog;
  const ctx = doc.context;

  // --- 1) AcroForm: optional flatten (Default), sonst nur melden ------------
  if (catalog.has(PDFName.of("AcroForm"))) {
    const fieldCount = (() => {
      try { return doc.getForm().getFields().length; } catch { return 0; }
    })();
    if (fieldCount > 0 && (flattenForm ?? true)) {
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
  const namesDict = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (namesDict?.has(PDFName.of("JavaScript"))) {
    namesDict.delete(PDFName.of("JavaScript"));
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
  const iccBytes = base64ToBytes(SRGB_ICC_BASE64);
  const iccRef = ctx.register(ctx.stream(iccBytes, { N: 3 }));
  const intent = ctx.obj({ Type: "OutputIntent", S: "GTS_PDFA1" });
  intent.set(PDFName.of("OutputConditionIdentifier"), PDFString.of("sRGB IEC61966-2.1"));
  intent.set(PDFName.of("Info"), PDFString.of("sRGB IEC61966-2.1"));
  intent.set(PDFName.of("RegistryName"), PDFString.of("http://www.color.org"));
  intent.set(PDFName.of("DestOutputProfile"), iccRef);
  catalog.set(PDFName.of("OutputIntents"), ctx.obj([ctx.register(intent)]));

  // --- 4) XMP-Metadaten-Stream (unkomprimiert, wie PDF/A es verlangt) --------
  const nowIso = new Date().toISOString();
  const xmp = buildPdfAXmp({
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
    subject: doc.getSubject() || undefined,
    keywords: doc.getKeywords() || undefined,
    creator: doc.getCreator() || undefined,
    producer: doc.getProducer() || undefined,
    createDate: doc.getCreationDate()?.toISOString() ?? nowIso,
    modifyDate: doc.getModificationDate()?.toISOString() ?? nowIso,
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

  // --- 6) Font-Härtung: Standard-14 → Liberation einbetten (optional) --------
  if (embedFonts) {
    warnings.push(...await embedStandard14Replacements(doc));
  }

  // --- 7) Font-Embedding-Prüfung (nur melden, nichts reparieren) -------------
  warnings.push(...collectFontWarnings(doc));

  // Klassische xref-Struktur für maximale Validator-Kompatibilität; pdf-lib
  // verändert das Info-Dict beim Save nicht → bleibt konsistent zum XMP-Paket.
  const bytes = await doc.save({ useObjectStreams: false });
  return { dataBase64: bytesToBase64(bytes), warnings };
}

// ============================================================================
// PDF/UA-Vorbereitung + Prüfbericht (Best Effort) — Entsprechung zum MCP-Tool
// pdf_ua_prepare (mcp/src/pdfua.ts, bewusste Duplikation).
// ----------------------------------------------------------------------------
// EHRLICHER SCOPE: setzt die maschinenlesbare KENNZEICHNUNG, die PDF/UA-1
// verlangt (/MarkInfo Marked, /Lang, /DisplayDocTitle, XMP pdfuaid:part=1)
// und liefert einen ehrlichen Bericht — KEINE Konformitätsgarantie. Echtes
// Tagging (Strukturbaum, Lesereihenfolge, Alternativtexte) kann NICHT
// synthetisiert werden und wird nur gemeldet.
// C#-Seite: Pagebound.Infrastructure.Pdf.JsPdfArchiveService.PreparePdfUaAsync.
// ============================================================================

const UA_LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

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
 * ehrlichen Prüfbericht (warnings = Berichtszeilen). KEINE Konformitäts-
 * garantie — echtes Tagging liegt außerhalb des Scopes.
 */
export async function preparePdfUa(pdfBytes: Uint8Array, lang: string): Promise<PdfAResultDto> {
  const langCode = (lang ?? "de-DE").trim() || "de-DE";
  if (!UA_LANG_RE.test(langCode)) {
    throw new Error(`Ungültiger Sprachcode '${langCode}' — erwartet wird BCP-47 (z. B. "de-DE", "en-US").`);
  }

  // Bewusst OHNE ignoreEncryption — verschlüsselte Eingaben sollen klar scheitern.
  const doc = await PDFDocument.load(pdfBytes);
  const report: string[] = [];
  const catalog = doc.catalog;
  const ctx = doc.context;

  // --- 1) Kennzeichnung setzen ------------------------------------------------
  const markInfo = catalog.lookupMaybe(PDFName.of("MarkInfo"), PDFDict) ?? ctx.obj({});
  markInfo.set(PDFName.of("Marked"), PDFBool.True);
  catalog.set(PDFName.of("MarkInfo"), markInfo);

  catalog.set(PDFName.of("Lang"), PDFString.of(langCode));

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

  report.push(`Kennzeichnung gesetzt: /MarkInfo (Marked), /Lang "${langCode}", /DisplayDocTitle, XMP pdfuaid:part=1.`);

  // --- 2) Prüfbericht (nur melden, nichts reparieren) --------------------------
  const tagged = catalog.has(PDFName.of("StructTreeRoot"));
  if (!tagged) {
    report.push("Dokument ist nicht getaggt (kein /StructTreeRoot) — echtes Tagging (Strukturbaum, Lesereihenfolge, Rollen) kann nicht synthetisiert werden; ohne Tags ist PDF/UA-Konformität nicht erreichbar.");
  }

  if (!doc.getTitle()) {
    report.push("Kein Dokumenttitel gesetzt — PDF/UA verlangt einen Titel (dc:title), der per /DisplayDocTitle angezeigt wird. Vorher im Metadaten-Werkzeug setzen.");
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
  return { dataBase64: bytesToBase64(bytes), warnings: report };
}

export async function stampPdf(pdfBytes: Uint8Array, opts: StampOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;

  const wmText = (opts.watermarkText ?? "").trim();
  const wmOpacity = clampNum(opts.watermarkOpacity ?? 0.12, 0.02, 0.6);
  const wmSize = clampNum(opts.watermarkFontSize ?? 48, 8, 240);

  const pnOn = !!opts.pageNumbers;
  const pnFmt = opts.pageNumberFormat || "{n} / {total}";
  const pnPos = opts.pageNumberPosition || "bottom-center";
  const pnSize = clampNum(opts.pageNumberFontSize ?? 10, 6, 48);
  const startAt = Number.isFinite(opts.pageNumberStartAt) ? (opts.pageNumberStartAt as number) : 1;
  const margin = 24;

  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    if (wmText) {
      const tw = font.widthOfTextAtSize(wmText, wmSize);
      const angle = Math.PI / 4; // 45° — die rotierte Baseline mittig durch die Seite legen
      page.drawText(wmText, {
        x: width / 2 - (tw / 2) * Math.cos(angle),
        y: height / 2 - (tw / 2) * Math.sin(angle),
        size: wmSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: wmOpacity,
        rotate: degrees(45),
      });
    }
    if (pnOn) {
      const label = pnFmt.replace("{n}", String(i + startAt)).replace("{total}", String(total));
      const tw = font.widthOfTextAtSize(label, pnSize);
      let x = (width - tw) / 2;
      if (pnPos === "bottom-right") x = width - tw - margin;
      else if (pnPos === "bottom-left") x = margin;
      page.drawText(label, { x, y: margin, size: pnSize, font, color: rgb(0.3, 0.3, 0.3) });
    }
  });

  return await doc.save({ useObjectStreams: false });
}

// ============================================================================
// Annotationen einbrennen / Flatten (FA — Richtung 1.0)
// ----------------------------------------------------------------------------
// Brennt Sidecar-Annotationen dauerhaft in die PDF: Highlights, Ink (Freihand),
// Formen (Rechteck/Linie/Pfeil), Notiz (Marker-Karte + Text) und Signaturen.
// Reader-Koordinaten sind 0..1 mit Origin OBEN-LINKS; pdf-lib zeichnet in Punkten
// mit Origin UNTEN-LINKS → pro Seite wird umgerechnet. Entspricht
// JsPdfLibManipulator.FlattenAnnotationsAsync (projiziert die Domain-Typen).
// ============================================================================

export interface FlattenItem {
  kind: "highlight" | "ink" | "shape" | "note" | "signature" | "text";
  pageNumber: number;
  color?: string | null;
  opacity?: number | null;
  /** Strichbreite als Anteil der Seitenbreite (wie im Reader). */
  strokeWidth?: number | null;
  rects?: { x: number; y: number; w: number; h: number }[] | null;
  strokes?: { x: number; y: number }[][] | null;
  shape?: "rectangle" | "line" | "arrow" | null;
  startX?: number; startY?: number; endX?: number; endY?: number;
  text?: string | null;
  /** Schriftgröße als Anteil der Seitenhöhe (Freitext, wie im Reader via cqh). */
  fontSize?: number | null;
  x?: number; y?: number;
  imageBase64?: string | null;
  width?: number; height?: number;
}

function hexToRgbColor(hex: string | null | undefined, fallback = rgb(0, 0, 0)) {
  if (!hex) return fallback;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return fallback;
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  );
}

function wrapText(font: any, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = "";
    for (const w of words) {
      const trial = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line) { lines.push(line); line = w; }
      else line = trial;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function stripMarkdown(md: string): string {
  return (md ?? "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(\*|_){1,3}([^*_]+)(\*|_){1,3}/g, "$2")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

export async function flattenAnnotations(
  pdfBytes: Uint8Array,
  items: FlattenItem[]
): Promise<Uint8Array> {
  if (!items || items.length === 0) return pdfBytes;
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const it of items) {
    const page = pages[it.pageNumber - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const flipY = (yTop: number) => ph - yTop * ph; // 0..1 oben → Punkte unten
    const color = hexToRgbColor(it.color);
    const thickness = Math.max(0.5, (it.strokeWidth ?? 0.004) * pw);

    if (it.kind === "highlight" && it.rects) {
      for (const r of it.rects) {
        page.drawRectangle({
          x: r.x * pw,
          y: ph - (r.y + r.h) * ph,
          width: r.w * pw,
          height: r.h * ph,
          color,
          opacity: clampNum(it.opacity ?? 0.85, 0.05, 1),
          blendMode: BlendMode.Multiply, // wie der Reader (mix-blend-mode: multiply)
        });
      }
    } else if (it.kind === "ink" && it.strokes) {
      for (const stroke of it.strokes) {
        if (stroke.length === 1) {
          page.drawCircle({ x: stroke[0].x * pw, y: flipY(stroke[0].y), size: thickness / 2, color });
          continue;
        }
        for (let i = 1; i < stroke.length; i++) {
          page.drawLine({
            start: { x: stroke[i - 1].x * pw, y: flipY(stroke[i - 1].y) },
            end: { x: stroke[i].x * pw, y: flipY(stroke[i].y) },
            thickness, color, lineCap: LineCapStyle.Round,
          });
        }
      }
    } else if (it.kind === "shape") {
      const sx = (it.startX ?? 0) * pw, sy = flipY(it.startY ?? 0);
      const ex = (it.endX ?? 0) * pw, ey = flipY(it.endY ?? 0);
      if (it.shape === "rectangle") {
        page.drawRectangle({
          x: Math.min(sx, ex), y: Math.min(sy, ey),
          width: Math.abs(ex - sx), height: Math.abs(ey - sy),
          borderColor: color, borderWidth: thickness, opacity: 0, // nur Rahmen, keine Füllung
        });
      } else if (it.shape === "line") {
        page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness, color, lineCap: LineCapStyle.Round });
      } else if (it.shape === "arrow") {
        const dx = ex - sx, dy = ey - sy;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const headLen = Math.max(6, thickness * 4);
        const headW = headLen * 0.8;
        const bcx = ex - ux * headLen, bcy = ey - uy * headLen; // Basis-Mitte der Spitze
        const px = -uy, py = ux;                                 // Perpendikular
        const c1x = bcx + px * (headW / 2), c1y = bcy + py * (headW / 2);
        const c2x = bcx - px * (headW / 2), c2y = bcy - py * (headW / 2);
        // Schaft endet an der Spitzen-Basis → keine runde Endkappe als „Punkt".
        page.drawLine({ start: { x: sx, y: sy }, end: { x: bcx, y: bcy }, thickness, color, lineCap: LineCapStyle.Round });
        // Gefüllte Spitze via SVG-Pfad in Oben-Links-Koordinaten ({x:0,y:ph}-Idiom).
        page.drawSvgPath(`M ${ex} ${ph - ey} L ${c1x} ${ph - c1y} L ${c2x} ${ph - c2y} Z`, { x: 0, y: ph, color });
      }
    } else if (it.kind === "note") {
      const size = 9, pad = 6, lineH = size * 1.35;
      const cardW = Math.min(0.3 * pw, 220);
      const txt = stripMarkdown(it.text ?? "");
      const lines = (txt ? wrapText(font, txt, size, cardW - 2 * pad) : ["(Notiz)"]).slice(0, 14);
      const cardH = pad * 2 + lines.length * lineH;
      let x = clampNum((it.x ?? 0) * pw, 2, Math.max(2, pw - cardW - 2));
      let yTop = clampNum((it.y ?? 0) * ph, 2, Math.max(2, ph - cardH - 2));
      const yBl = ph - yTop - cardH;
      page.drawRectangle({ x, y: yBl, width: cardW, height: cardH, color, opacity: 0.92, borderColor: rgb(0, 0, 0), borderWidth: 0.5, borderOpacity: 0.25 });
      lines.forEach((ln, i) => {
        page.drawText(ln, { x: x + pad, y: yBl + cardH - pad - size - i * lineH, size, font, color: rgb(0.12, 0.12, 0.12) });
      });
    } else if (it.kind === "text") {
      // Freitext/Datum-Stempel: Klartext an Top-Left-Position, Zeilen via \n.
      // Kein Hintergrund-Karton wie bei Notizen — der Text steht direkt auf
      // der Seite (Edge-Reader-Verhalten).
      const size = Math.max(4, (it.fontSize ?? 0.02) * ph);
      const lineH = size * 1.25;
      const rawLines = (it.text ?? "").split("\n");
      const x = clampNum((it.x ?? 0) * pw, 0, pw);
      // Start-y klemmen (wie im note-Zweig), damit mindestens die erste Zeile
      // auf der Seite liegt — sonst wird y = ph - yTopPt - size negativ und
      // pdf-lib zeichnet unterhalb der MediaBox (im Export unsichtbar). Folge-
      // zeilen dürfen weiterhin unten hinauslaufen und abgeschnitten werden.
      const yTopPt = clampNum((it.y ?? 0) * ph, 0, Math.max(0, ph - size));
      rawLines.forEach((rawLine, i) => {
        // Tabs sind nicht WinAnsi-kodierbar → durch Space ersetzen, damit die
        // Zeile normal gezeichnet wird statt in den Fallback zu fallen.
        const ln = rawLine.replace(/\t/g, " ");
        if (!ln.trim()) return;
        const y = ph - yTopPt - size - i * lineH;
        try {
          page.drawText(ln, { x, y, size, font, color });
        } catch {
          // Helvetica (WinAnsi) kann ein Zeichen nicht encoden → Fallback auf
          // die WinAnsi-kodierbare Teilmenge: Steuerzeichen (< 0x20) und den
          // C1-Bereich (0x7f–0x9f, dort u.a. 0x81/0x8d/0x8f/0x90/0x9d nicht
          // kodierbar) sowie alles > 0xff entfernen. Der zweite drawText steht
          // in eigenem try/catch (wie der signature-Zweig) — sonst reißt ein
          // weiterhin nicht-kodierbares Zeichen das gesamte Flatten ab.
          const safe = Array.from(ln)
            .filter((c) => {
              const code = c.charCodeAt(0);
              return code >= 0x20 && code <= 0xff && !(code >= 0x7f && code <= 0x9f);
            })
            .join("");
          if (safe) {
            try {
              page.drawText(safe, { x, y, size, font, color });
            } catch (e) {
              console.warn("[pagebound] flatten: Textzeile nicht kodierbar, übersprungen:", e);
            }
          }
        }
      });
    } else if (it.kind === "signature" && it.imageBase64) {
      try {
        const img = await doc.embedPng(base64ToBytes(it.imageBase64));
        page.drawImage(img, {
          x: (it.x ?? 0) * pw,
          y: ph - ((it.y ?? 0) + (it.height ?? 0)) * ph,
          width: (it.width ?? 0) * pw,
          height: (it.height ?? 0) * ph,
        });
      } catch (e) {
        console.warn("[pagebound] flatten: Signatur-Bild nicht einbettbar:", e);
      }
    }
  }

  doc.setProducer("Pagebound Flatten");
  return await doc.save({ updateMetadata: false });
}

// ============================================================================
// Inline-Text-Bearbeitung („Text bearbeiten") — Cover + Redraw
// ----------------------------------------------------------------------------
// Übermalt eine alte Textregion mit einer opaken Hintergrundfarbe und zeichnet
// den neuen Text darüber. Gleiches Muster wie flattenAnnotations/RedactAsync:
// PDF-Bytes rein, neue Bytes raus, Original unberührt. WICHTIG (Ehrlichkeit):
// die alten Zeichen bleiben im Content-Stream (weiterhin extrahierbar) — für
// garantierte Entfernung ist das Schwärzen-Werkzeug (redactPdf, rastert) da.
// Kein Reflow. x/y/w/h sind 0..1 (oben-links), fontSize ist Anteil Seitenhöhe.
// ============================================================================
export interface TextEditDto {
  pageNumber: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  color?: string | null;
  bgColor?: string | null;
}

/** WinAnsi-sichere Teilmenge (wie im flatten-text-Zweig): nicht kodierbare Zeichen raus. */
function winAnsiSafe(s: string): string {
  return Array.from(s)
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x20 && code <= 0xff && !(code >= 0x7f && code <= 0x9f);
    })
    .join("");
}

export async function applyTextEdits(pdfBytes: Uint8Array, edits: TextEditDto[]): Promise<Uint8Array> {
  if (!edits || edits.length === 0) return pdfBytes;
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const ed of edits) {
    const page = pages[ed.pageNumber - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const bg = hexToRgbColor(ed.bgColor, rgb(1, 1, 1)); // Default: weiß
    const fg = hexToRgbColor(ed.color, rgb(0.07, 0.07, 0.07)); // Default: fast-schwarz

    // 1) Alte Region übermalen (opak, kein Rahmen). Leichter Rand deckt Anti-
    //    Aliasing-Kanten / Ober-/Unterlängen der alten Glyphen mit ab.
    const size = Math.max(4, (ed.fontSize ?? 0.02) * ph);
    const pad = Math.max(1, size * 0.15);
    const rx = clampNum(ed.x * pw - pad, 0, pw);
    const rTop = ed.y * ph - pad;
    const rw = Math.min(ed.w * pw + 2 * pad, pw - rx);
    const rh = ed.h * ph + 2 * pad;
    page.drawRectangle({
      x: rx,
      y: ph - rTop - rh,
      width: Math.max(0, rw),
      height: Math.max(0, rh),
      color: bg,
      opacity: 1,
    });

    // 2) Neuen Text darüber (mehrzeilig via \n, wie der flatten-text-Zweig).
    const lineH = size * 1.25;
    const rawLines = (ed.text ?? "").split("\n");
    const x = clampNum(ed.x * pw, 0, pw);
    const yTopPt = clampNum(ed.y * ph, 0, Math.max(0, ph - size));
    rawLines.forEach((rawLine, i) => {
      const ln = rawLine.replace(/\t/g, " ");
      if (!ln.trim()) return;
      const y = ph - yTopPt - size - i * lineH;
      try {
        page.drawText(ln, { x, y, size, font, color: fg });
      } catch {
        const safe = winAnsiSafe(ln);
        if (safe) {
          try {
            page.drawText(safe, { x, y, size, font, color: fg });
          } catch (e) {
            console.warn("[pagebound] edit: Textzeile nicht kodierbar, übersprungen:", e);
          }
        }
      }
    });
  }

  doc.setProducer("Pagebound Edit");
  return await doc.save({ updateMetadata: false });
}

// ============================================================================
// AES-256-Krypto (ISO 32000-2 /V5 /R6) über WebCrypto (FA-027)
// ----------------------------------------------------------------------------
// Portierung von Pagebound.Infrastructure.Pdf.Encryption.AesR6 nach WebCrypto:
// hardware-beschleunigtes AES (managed AES fror den WASM-Thread ~30s ein).
// Nur SHA-256/384/512 + AES, kein MD5. WebCrypto-AES-CBC padded immer (PKCS7);
// für Algorithm 2.B (no-padding) verschlüsseln wir block-aligned und schneiden
// den angehängten Padding-Block ab — die ersten n Blöcke sind bei CBC identisch.
// AES-256-ECB (für /Perms) = AES-256-CBC mit IV=0 für einen einzelnen Block.
// ============================================================================

const EMPTY = new Uint8Array(0);

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// TS ≥5.7 tippt Uint8Array als Uint8Array<ArrayBufferLike> (inkl. SharedArrayBuffer);
// die WebCrypto-API verlangt aber Uint8Array<ArrayBuffer> (BufferSource). Diese App
// nutzt NIE SharedArrayBuffer, daher ist der eng begrenzte Cast sicher und ändert
// kein Laufzeitverhalten — vermeidet flächige any-Casts an jeder Aufrufstelle.
function toBufferSource(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  const algo = bits === 256 ? "SHA-256" : bits === 384 ? "SHA-384" : "SHA-512";
  return new Uint8Array(await crypto.subtle.digest(algo, toBufferSource(data)));
}

/** AES-CBC ohne Padding: verschlüsselt block-alignte Daten, schneidet den PKCS7-Extra-Block ab. */
async function aesCbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", toBufferSource(key), { name: "AES-CBC" }, false, ["encrypt"]);
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: toBufferSource(iv) }, k, toBufferSource(data)));
  return enc.slice(0, data.length);
}

/** AES-256-CBC mit zufälligem IV + PKCS7 (für Stream-/String-Daten, /CFM AESV3). IV wird vorangestellt. */
async function aesCbcEncrypt(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const k = await crypto.subtle.importKey("raw", toBufferSource(key), { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, k, toBufferSource(plaintext)));
  return concatBytes(iv, ct);
}

/** Algorithm 2.B — iterierter Hardening-Hash. */
async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await sha(256, concatBytes(password, salt, udata));
  let e: Uint8Array = new Uint8Array(0);
  for (let round = 0; round < 64 || e[e.length - 1] > round - 32; round++) {
    const block = concatBytes(password, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    e = await aesCbcNoPad(k.slice(0, 16), k.slice(16, 32), k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    const mod = sum % 3;
    k = await sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
  }
  return k.slice(0, 32);
}

interface R6Keys { u: Uint8Array; ue: Uint8Array; o: Uint8Array; oe: Uint8Array; perms: Uint8Array; }

/** Algorithmen 8–10: /U /UE /O /OE /Perms aus File-Key + Passwörtern. */
async function deriveR6Keys(
  ownerPw: Uint8Array, userPw: Uint8Array, fileKey: Uint8Array, permissions: number, encryptMetadata: boolean
): Promise<R6Keys> {
  const rnd = () => crypto.getRandomValues(new Uint8Array(8));
  // User
  const uVal = rnd(), uKey = rnd();
  const uHash = await hash2B(userPw, uVal, EMPTY);
  const u = concatBytes(uHash, uVal, uKey);
  const uInter = await hash2B(userPw, uKey, EMPTY);
  const ue = await aesCbcNoPad(uInter, new Uint8Array(16), fileKey);
  // Owner (über /U)
  const oVal = rnd(), oKey = rnd();
  const oHash = await hash2B(ownerPw, oVal, u);
  const o = concatBytes(oHash, oVal, oKey);
  const oInter = await hash2B(ownerPw, oKey, u);
  const oe = await aesCbcNoPad(oInter, new Uint8Array(16), fileKey);
  // /Perms (16-Byte-Block, AES-256-ECB = CBC/IV0 für einen Block)
  const block = new Uint8Array(16);
  block[0] = permissions & 0xff; block[1] = (permissions >> 8) & 0xff;
  block[2] = (permissions >> 16) & 0xff; block[3] = (permissions >> 24) & 0xff;
  block[4] = block[5] = block[6] = block[7] = 0xff;
  block[8] = encryptMetadata ? 0x54 : 0x46; // 'T' / 'F'
  block[9] = 0x61; block[10] = 0x64; block[11] = 0x62; // 'a','d','b'
  block.set(crypto.getRandomValues(new Uint8Array(4)), 12);
  const perms = await aesCbcNoPad(fileKey, new Uint8Array(16), block);
  return { u, ue, o, oe, perms };
}

/** Auth-Pfad (User): prüft Passwort gegen /U, rekonstruiert File-Key aus /UE. Für Tests. */
async function recoverFileKeyFromUser(password: Uint8Array, u: Uint8Array, ue: Uint8Array): Promise<Uint8Array | null> {
  if (u.length !== 48 || ue.length !== 32) return null;
  const vSalt = u.slice(32, 40), kSalt = u.slice(40, 48);
  const hash = await hash2B(password, vSalt, EMPTY);
  for (let i = 0; i < 32; i++) if (hash[i] !== u[i]) return null;
  const inter = await hash2B(password, kSalt, EMPTY);
  // UE entschlüsseln (AES-256-CBC no-pad, IV=0): liefert den 32-Byte File-Key.
  const k = await crypto.subtle.importKey("raw", toBufferSource(inter), { name: "AES-CBC" }, false, ["decrypt"]);
  // no-pad-Decrypt: ue um einen Block (IV0-CBC) „verlängern" geht nicht direkt; wir
  // entschlüsseln manuell, indem wir AES-CBC mit padding umgehen → eigener Decrypt:
  // CBC-Decrypt von 32 Byte (2 Blöcke) ohne Padding-Erwartung.
  return await aesCbcDecryptNoPad(inter, new Uint8Array(16), ue);
}

/** AES-CBC-Decrypt ohne Padding-Annahme (WebCrypto erzwingt PKCS7 beim Decrypt → eigener Weg über encrypt-Trick entfällt; wir nutzen AES-CTR-Äquivalent nicht, sondern raw ECB-Ketten). */
async function aesCbcDecryptNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // WebCrypto AES-CBC-Decrypt verlangt gültiges PKCS7. Trick: an die Ciphertext-
  // Blöcke einen selbst erzeugten Padding-Block anhängen, dessen Klartext 0x10×16
  // ist, damit der Decrypt das Padding akzeptiert. Dazu C_{n+1} = E(K, 0x10..0x10 XOR C_n).
  const kEnc = await crypto.subtle.importKey("raw", toBufferSource(key), { name: "AES-CBC" }, false, ["encrypt"]);
  const lastBlock = data.slice(data.length - 16);
  const padPlain = new Uint8Array(16).fill(0x10);
  const xored = new Uint8Array(16);
  for (let i = 0; i < 16; i++) xored[i] = padPlain[i] ^ lastBlock[i];
  // E(K, xored) mit IV=0, ein Block, padding abschneiden:
  const eBlock = (new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, kEnc, xored))).slice(0, 16);
  const withPad = concatBytes(data, eBlock);
  const kDec = await crypto.subtle.importKey("raw", toBufferSource(key), { name: "AES-CBC" }, false, ["decrypt"]);
  const dec = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: toBufferSource(iv) }, kDec, toBufferSource(withPad)));
  return dec;
}

/** Self-Test des Krypto-Kerns (gegen die C#-AesR6-Semantik): Round-Trips + Auth. */
export async function encryptSelfTest(): Promise<Record<string, boolean>> {
  const enc = new TextEncoder();
  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  const pw = enc.encode("öffnen-123");
  const wrong = enc.encode("nope");
  const vSalt = crypto.getRandomValues(new Uint8Array(8));
  const kSalt = crypto.getRandomValues(new Uint8Array(8));

  // Hash2B deterministisch?
  const h1 = await hash2B(pw, vSalt, EMPTY);
  const h2 = await hash2B(pw, vSalt, EMPTY);
  const deterministic = h1.length === 32 && h1.every((b, i) => b === h2[i]);

  // User-Key Round-Trip
  const keys = await deriveR6Keys(pw, pw, fileKey, -1, true);
  const rec = await recoverFileKeyFromUser(pw, keys.u, keys.ue);
  const roundTrip = !!rec && rec.length === 32 && rec.every((b, i) => b === fileKey[i]);
  const wrongFails = (await recoverFileKeyFromUser(wrong, keys.u, keys.ue)) === null;

  // Daten-Round-Trip (AES-256-CBC + IV-Prefix)
  const plain = enc.encode("Hallo Welt — ümläüte!");
  const ct = await aesCbcEncrypt(fileKey, plain);
  const kDec = await crypto.subtle.importKey("raw", fileKey, { name: "AES-CBC" }, false, ["decrypt"]);
  const back = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ct.slice(0, 16) }, kDec, ct.slice(16)));
  const dataRoundTrip = back.length === plain.length && back.every((b, i) => b === plain[i]);

  return {
    deterministic,
    lengthsOk: keys.u.length === 48 && keys.ue.length === 32 && keys.o.length === 48 && keys.oe.length === 32 && keys.perms.length === 16,
    roundTrip,
    wrongFails,
    dataRoundTrip,
  };
}

// ============================================================================
// PDF-Verschlüsselung (FA-027) — Port von PdfAesEncryptor.cs nach TS
// ----------------------------------------------------------------------------
// Normalisiert (pdf-lib, klassische Struktur), parst die Objekte byte-genau
// über die xref-Tabelle, verschlüsselt jeden Stream (AES-256-CBC + IV-Prefix,
// /CFM AESV3) und schreibt /Encrypt + xref + Trailer neu. MVP: nur Streams
// (/StmF StdCF), Strings /Identity.
// ============================================================================

function latin1Decode(b: Uint8Array): string { return new TextDecoder("latin1").decode(b); }
function latin1Encode(s: string): Uint8Array { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff; return o; }
function toHex(b: Uint8Array): string { let s = ""; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0"); return s.toUpperCase(); }
function preparePassword(pw: string): Uint8Array { const b = new TextEncoder().encode(pw || ""); return b.length <= 127 ? b : b.slice(0, 127); }

interface PdfObjEntry { num: number; gen: number; isStream: boolean; objBytes?: Uint8Array; dictText?: string; streamData?: Uint8Array; }

function indexOfStreamKw(text: string, from: number, end: number): number {
  let i = from;
  while (i < end) {
    const idx = text.indexOf("stream", i);
    if (idx < 0 || idx >= end) return -1;
    const prevD = idx > 0 && text[idx - 1] === "d";
    const after = idx + 6;
    const eol = after < text.length && (text[after] === "\r" || text[after] === "\n");
    if (!prevD && eol) return idx;
    i = idx + 6;
  }
  return -1;
}

function parsePdfStructure(pdf: Uint8Array): { header: Uint8Array; objects: PdfObjEntry[]; maxObj: number; rootRef: string; infoRef: string | null } {
  const text = latin1Decode(pdf);
  const isD = (c: string) => c >= "0" && c <= "9";
  const isWs = (c: string) => c === " " || c === "\r" || c === "\n" || c === "\t" || c === "\f" || c === "\0";

  const sx = text.lastIndexOf("startxref");
  if (sx < 0) throw new Error("kein startxref — PDF nicht klassisch");
  let p = sx + 9;
  while (p < text.length && !isD(text[p])) p++;
  let s = p; while (p < text.length && isD(text[p])) p++;
  const xrefOffset = parseInt(text.slice(s, p), 10);

  const offsets = new Map<number, number>();
  let xp = xrefOffset;
  while (xp < text.length && isWs(text[xp])) xp++;
  if (text.slice(xp, xp + 4) !== "xref") throw new Error("kein klassisches xref (evtl. xref-Stream)");
  xp += 4;
  while (true) {
    while (xp < text.length && isWs(text[xp])) xp++;
    if (xp >= text.length || !isD(text[xp])) break;
    s = xp; while (isD(text[xp])) xp++; const start = parseInt(text.slice(s, xp), 10);
    while (isWs(text[xp])) xp++;
    s = xp; while (isD(text[xp])) xp++; const count = parseInt(text.slice(s, xp), 10);
    while (xp < text.length && text[xp] !== "\n") xp++; xp++;
    for (let i = 0; i < count; i++) {
      const entry = text.slice(xp, xp + 20);
      const off = parseInt(entry.slice(0, 10), 10);
      if (entry[17] === "n") offsets.set(start + i, off);
      xp += 20;
    }
  }
  if (offsets.size === 0) throw new Error("xref ohne In-Use-Objekte");

  const tp = text.indexOf("trailer", xrefOffset);
  const trailer = tp >= 0 ? text.slice(tp, Math.min(text.length, tp + 4000)) : "";
  const rootM = trailer.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
  if (!rootM) throw new Error("kein /Root im Trailer");
  const infoM = trailer.match(/\/Info\s+(\d+)\s+(\d+)\s+R/);

  const maxObj = Math.max(...offsets.keys());
  const sorted = [...offsets.entries()].sort((a, b) => a[1] - b[1]);
  const header = pdf.slice(0, sorted[0][1]);

  const objects: PdfObjEntry[] = [];
  for (let idx = 0; idx < sorted.length; idx++) {
    const start = sorted[idx][1];
    const end = idx + 1 < sorted.length ? sorted[idx + 1][1] : xrefOffset;
    let q = start;
    while (isWs(text[q])) q++;
    let a = q; while (isD(text[q])) q++; const num = parseInt(text.slice(a, q), 10);
    while (isWs(text[q])) q++;
    a = q; while (isD(text[q])) q++; const gen = parseInt(text.slice(a, q), 10);
    while (isWs(text[q])) q++;
    q += 3; // "obj"
    const bodyStart = q;
    const kw = indexOfStreamKw(text, bodyStart, end);
    if (kw < 0) {
      const eo = text.indexOf("endobj", bodyStart);
      const sliceEnd = eo >= 0 && eo < end ? eo + 6 : end;
      objects.push({ num, gen, isStream: false, objBytes: pdf.slice(start, sliceEnd) });
    } else {
      const dictText = text.slice(bodyStart, kw);
      let dataStart = kw + 6;
      if (text[dataStart] === "\r") dataStart++;
      if (text[dataStart] === "\n") dataStart++;
      let dataEnd: number;
      const lenM = dictText.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      const len = lenM ? parseInt(lenM[1], 10) : -1;
      if (len >= 0 && dataStart + len <= end) dataEnd = dataStart + len;
      else { let es = text.indexOf("endstream", dataStart); dataEnd = es < 0 || es > end ? end : es; if (text[dataEnd - 1] === "\n") dataEnd--; if (text[dataEnd - 1] === "\r") dataEnd--; }
      objects.push({ num, gen, isStream: true, dictText, streamData: pdf.slice(dataStart, dataEnd) });
    }
  }
  return { header, objects, maxObj, rootRef: `${rootM[1]} ${rootM[2]} R`, infoRef: infoM ? `${infoM[1]} ${infoM[2]} R` : null };
}

function bumpVersion(header: Uint8Array): Uint8Array {
  const h = header.slice();
  for (let i = 0; i + 7 < h.length; i++) {
    if (h[i] === 0x25 && h[i + 1] === 0x50 && h[i + 2] === 0x44 && h[i + 3] === 0x46 && h[i + 4] === 0x2d && h[i + 5] === 0x31 && h[i + 6] === 0x2e) {
      if (h[i + 7] < 0x37) h[i + 7] = 0x37;
      break;
    }
  }
  return h;
}

function withFreshLength(dict: string, len: number): string {
  const stripped = dict.replace(/\/Length\s+\d+(\s+\d+\s+R)?/, "");
  const open = stripped.indexOf("<<");
  const at = open >= 0 ? open + 2 : 0;
  return stripped.slice(0, at) + ` /Length ${len}` + stripped.slice(at).replace(/\s+$/, "");
}

function buildEncryptDict(keys: R6Keys, permissions: number, encryptMetadata: boolean): string {
  return "<< /Filter /Standard /V 5 /R 6 /Length 256 " +
    `/P ${permissions} /EncryptMetadata ${encryptMetadata ? "true" : "false"} ` +
    "/CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> " +
    "/StmF /StdCF /StrF /Identity " +
    `/U <${toHex(keys.u)}> /UE <${toHex(keys.ue)}> /O <${toHex(keys.o)}> /OE <${toHex(keys.oe)}> /Perms <${toHex(keys.perms)}> >>`;
}

export async function encryptPdf(
  pdfBytes: Uint8Array, ownerPassword: string, userPassword: string,
  permissions = -1, encryptMetadata = true
): Promise<Uint8Array> {
  const normDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const normalized = await normDoc.save({ useObjectStreams: false });
  const struct = parsePdfStructure(normalized);

  const owner = preparePassword(ownerPassword);
  const user = preparePassword(userPassword && userPassword.length ? userPassword : ownerPassword);
  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  const keys = await deriveR6Keys(owner, user, fileKey, permissions, encryptMetadata);

  const encNum = struct.maxObj + 1;
  const size = encNum + 1;
  const parts: Uint8Array[] = [];
  let pos = 0;
  const offsets = new Map<number, number>();
  const pushBytes = (b: Uint8Array) => { parts.push(b); pos += b.length; };
  const pushStr = (s: string) => pushBytes(latin1Encode(s));

  pushBytes(bumpVersion(struct.header));

  for (const o of struct.objects.slice().sort((a, b) => a.num - b.num)) {
    offsets.set(o.num, pos);
    if (!o.isStream) {
      pushBytes(o.objBytes!);
      if (o.objBytes!.length === 0 || o.objBytes![o.objBytes!.length - 1] !== 0x0a) pushStr("\n");
    } else {
      const enc = await aesCbcEncrypt(fileKey, o.streamData!);
      pushStr(`${o.num} ${o.gen} obj\n`);
      pushStr(withFreshLength(o.dictText!, enc.length));
      pushStr("\nstream\n");
      pushBytes(enc);
      pushStr("\nendstream\nendobj\n");
    }
  }

  offsets.set(encNum, pos);
  pushStr(`${encNum} 0 obj\n`);
  pushStr(buildEncryptDict(keys, permissions, encryptMetadata));
  pushStr("\nendobj\n");

  const xrefOffset = pos;
  pushStr(`xref\n0 ${size}\n`);
  pushStr("0000000000 65535 f \n");
  for (let n = 1; n < size; n++) {
    const off = offsets.get(n);
    pushStr(`${(off ?? 0).toString().padStart(10, "0")} 00000 ${off !== undefined ? "n" : "f"} \n`);
  }
  const id = toHex(crypto.getRandomValues(new Uint8Array(16)));
  pushStr("trailer\n<< ");
  pushStr(`/Size ${size} /Root ${struct.rootRef}`);
  if (struct.infoRef) pushStr(` /Info ${struct.infoRef}`);
  pushStr(` /Encrypt ${encNum} 0 R /ID [<${id}><${id}>] >>\n`);
  pushStr(`startxref\n${xrefOffset}\n%%EOF\n`);

  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Verifikation: erzeugt eine Test-PDF, verschlüsselt sie, öffnet das Ergebnis mit PDF.js (Fremd-Reader). */
export async function encryptVerify(): Promise<any> {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const src = await imagesToPdf([{ base64: b64, mime: "image/png" }, { base64: b64, mime: "image/png" }], { pageSize: "a4", marginPt: 18 });
  const t0 = performance.now();
  const enc = await encryptPdf(src, "open-me", "open-me", -1);
  const ms = Math.round(performance.now() - t0);
  const txt = latin1Decode(enc);
  const encLen = enc.length;
  let pages = -1, opensWithPw = false, openError: string | null = null, wrongRejected = false;
  try { const d = await pdfjsLib.getDocument({ data: enc.slice(), password: "open-me" }).promise; pages = d.numPages; opensWithPw = true; await d.loadingTask.destroy(); }
  catch (e: any) { openError = (e && e.name ? e.name : "?") + ": " + (e && e.message ? e.message : String(e)); }
  try { const d = await pdfjsLib.getDocument({ data: enc.slice(), password: "falsch" }).promise; await d.loadingTask.destroy(); }
  catch (e: any) { wrongRejected = !!e && e.name === "PasswordException"; }
  const di = txt.indexOf("/Filter /Standard");
  return { ms, encLen, pages, opensWithPw, openError, wrongRejected, encryptDict: di >= 0 ? txt.slice(di, di + 360) : null };
}
