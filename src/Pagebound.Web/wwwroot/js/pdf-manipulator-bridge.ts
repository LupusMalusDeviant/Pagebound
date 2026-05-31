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
  PDFName,
  PDFString,
  PDFRef,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  degrees
} from "pdf-lib";
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

  const infoDict = doc.getInfoDict();
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
    srcDoc.destroy();
  }

  outDoc.setCreator("Pagebound");
  outDoc.setProducer("Pagebound Compress");
  return await outDoc.save({ updateMetadata: false });
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

async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  const algo = bits === 256 ? "SHA-256" : bits === 384 ? "SHA-384" : "SHA-512";
  return new Uint8Array(await crypto.subtle.digest(algo, data));
}

/** AES-CBC ohne Padding: verschlüsselt block-alignte Daten, schneidet den PKCS7-Extra-Block ab. */
async function aesCbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, k, data));
  return enc.slice(0, data.length);
}

/** AES-256-CBC mit zufälligem IV + PKCS7 (für Stream-/String-Daten, /CFM AESV3). IV wird vorangestellt. */
async function aesCbcEncrypt(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const k = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, k, plaintext));
  return concatBytes(iv, ct);
}

/** Algorithm 2.B — iterierter Hardening-Hash. */
async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await sha(256, concatBytes(password, salt, udata));
  let e = new Uint8Array(0);
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
  const k = await crypto.subtle.importKey("raw", inter, { name: "AES-CBC" }, false, ["decrypt"]);
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
  const kEnc = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const lastBlock = data.slice(data.length - 16);
  const padPlain = new Uint8Array(16).fill(0x10);
  const xored = new Uint8Array(16);
  for (let i = 0; i < 16; i++) xored[i] = padPlain[i] ^ lastBlock[i];
  // E(K, xored) mit IV=0, ein Block, padding abschneiden:
  const eBlock = (new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, kEnc, xored))).slice(0, 16);
  const withPad = concatBytes(data, eBlock);
  const kDec = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
  const dec = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, kDec, withPad));
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
  try { const d = await pdfjsLib.getDocument({ data: enc.slice(), password: "open-me" }).promise; pages = d.numPages; opensWithPw = true; await d.destroy(); }
  catch (e: any) { openError = (e && e.name ? e.name : "?") + ": " + (e && e.message ? e.message : String(e)); }
  try { const d = await pdfjsLib.getDocument({ data: enc.slice(), password: "falsch" }).promise; await d.destroy(); }
  catch (e: any) { wrongRejected = !!e && e.name === "PasswordException"; }
  const di = txt.indexOf("/Filter /Standard");
  return { ms, encLen, pages, opensWithPw, openError, wrongRejected, encryptDict: di >= 0 ? txt.slice(di, di + 360) : null };
}
