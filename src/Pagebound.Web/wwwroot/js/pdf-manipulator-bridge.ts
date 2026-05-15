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

import { PDFDocument, PDFName, PDFString } from "pdf-lib";
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
