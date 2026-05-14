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
