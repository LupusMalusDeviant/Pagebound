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
  PDFOptionList
} from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";

// Eigene Worker-Konfig — diese Bridge ist ein separater IIFE-Bundle, der
// seinen eigenen pdfjs-Modulscope hat. Der Worker selbst (gleiche .mjs-Datei)
// kann shared sein, daher reicht der Pfad wie in pdfjs-bridge.ts.
pdfjsLib.GlobalWorkerOptions.workerSrc = "/js/pdf.worker.min.mjs";

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
