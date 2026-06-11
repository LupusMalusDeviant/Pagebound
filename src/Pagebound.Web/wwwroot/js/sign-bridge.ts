// =============================================================================
// Pagebound — Zertifikatsbasierte PDF-Signatur (P12/PFX) Bridge
// ----------------------------------------------------------------------------
// EHRLICHER SCOPE: Klassische PDF-32000-Signatur `adbe.pkcs7.detached` mit
// SHA-256 und CMS/PKCS#7 inkl. authenticatedAttributes (contentType,
// messageDigest, signingTime) — in Adobe/Foxit prüfbar. Was NICHT passiert:
//   • KEIN PAdES-B-T (kein Zeitstempel-Server — die App ist offline-first),
//   • KEIN LTV (keine Sperrlisten/OCSP eingebettet),
//   • KEIN signingCertificateV2-Attribut (node-forge unterstützt keine
//     benutzerdefinierten authenticatedAttributes — bewusst weggelassen).
// Eingabe-PDFs mit vorhandener Signatur werden abgelehnt (ein erneutes
// Voll-Speichern würde die bestehende Signatur brechen; inkrementelles
// Update ist in v1 nicht enthalten). Zertifikat + Passwort werden
// ausschließlich lokal im Browser verarbeitet — nichts verlässt das Gerät.
//
// Technik (node-signpdf-Muster, selbst implementiert):
//   1. pdf-lib (low-level Context): unsichtbares Signaturfeld (AcroForm
//      /SigFlags 3, Widget Rect [0 0 0 0] auf Seite 1) mit Sig-Dict inkl.
//      /ByteRange-Platzhalter und /Contents-Platzhalter fixer Länge;
//      Save mit useObjectStreams:false.
//   2. In den gespeicherten Bytes ByteRange berechnen und byte-genau
//      überschreiben (Padding mit Spaces), SHA-256 über die ByteRange-Teile,
//      CMS mit node-forge (P12 parsen, Kette einbetten), DER → Hex → in die
//      /Contents-Lücke schreiben (Rest bleibt mit Nullen aufgefüllt).
//
// Bewusste Code-Duplikation mit dem MCP-Server (mcp/src/sign.ts) — gleiches
// Muster wie design.ts / pdfa.ts. Exposed als `pageboundSign` IIFE-Global
// (siehe esbuild.mjs).
// =============================================================================
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";
import forge from "node-forge";

/** Platzhalter je ByteRange-Zahl: /********** (10 Zeichen, wie node-signpdf). */
const BYTE_RANGE_PLACEHOLDER = "**********";
/** Reservierte /Contents-Länge in Hex-Zeichen (8 KB DER) — genug für 2–3 Zertifikate. */
const CONTENTS_HEX_LENGTH = 16384;

export interface SignBridgeOptions {
  reason?: string | null;
  location?: string | null;
  contactInfo?: string | null;
}

export interface SignBridgeResult {
  dataBase64: string;
  signerSubject: string;
  warnings: string[];
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}

/** Uint8Array → Binär-String (latin1) für forge, chunked gegen Stack-Limits. */
function bytesToBinaryString(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  return chunks.join("");
}

/** PDF-Datum (D:YYYYMMDDhhmmssZ, UTC) fürs /M-Feld. */
function toPdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Lesbarer Subject-String (CN=…, O=…, C=…) aus einem forge-Zertifikat. */
function subjectToString(cert: forge.pki.Certificate): string {
  return cert.subject.attributes
    .map((a) => `${a.shortName ?? a.name ?? a.type}=${String(a.value)}`)
    .join(", ");
}

interface ParsedP12 {
  privateKey: forge.pki.rsa.PrivateKey;
  signerCert: forge.pki.Certificate;
  chain: forge.pki.Certificate[];
  warnings: string[];
}

/** P12/PFX parsen: privater Schlüssel + Signer-Zertifikat + Kette. */
function parseP12(p12Bytes: Uint8Array, password: string): ParsedP12 {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(bytesToBinaryString(p12Bytes));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    throw new Error(`P12/PFX konnte nicht geöffnet werden — Passwort falsch oder Datei beschädigt (${errMsg(e)}).`);
  }

  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  const keyBag = shrouded.find((b) => b.key) ?? plain.find((b) => b.key);
  if (!keyBag?.key) throw new Error("Die P12/PFX-Datei enthält keinen privaten Schlüssel.");
  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;
  if (!privateKey.n || !privateKey.d) {
    throw new Error("Der private Schlüssel in der P12/PFX ist kein RSA-Schlüssel — nur RSA wird unterstützt.");
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const chain = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  if (chain.length === 0) throw new Error("Die P12/PFX-Datei enthält kein Zertifikat.");

  const warnings: string[] = [];
  const matching = chain.find((c) => {
    try {
      const pub = c.publicKey as forge.pki.rsa.PublicKey;
      return pub.n.compareTo(privateKey.n) === 0;
    } catch {
      return false;
    }
  });
  const signerCert = matching ?? chain[0];
  if (!matching) {
    warnings.push("Kein Zertifikat in der P12 passt eindeutig zum privaten Schlüssel — das erste wurde verwendet.");
  }

  const now = new Date();
  if (signerCert.validity.notAfter < now) {
    warnings.push(`Das Signatur-Zertifikat ist abgelaufen (gültig bis ${signerCert.validity.notAfter.toISOString()}).`);
  } else if (signerCert.validity.notBefore > now) {
    warnings.push(`Das Signatur-Zertifikat ist noch nicht gültig (gültig ab ${signerCert.validity.notBefore.toISOString()}).`);
  }

  return { privateKey, signerCert, chain, warnings };
}

/** Wirft, wenn das Dokument bereits eine Signatur (oder DocTimeStamp) trägt. */
function rejectExistingSignatures(doc: PDFDocument): void {
  const sigName = PDFName.of("Sig");
  const docTs = PDFName.of("DocTimeStamp");
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    const isSigValue = type === sigName || type === docTs;
    const isSignedField = obj.get(PDFName.of("FT")) === sigName && obj.has(PDFName.of("V"));
    if (isSigValue || isSignedField) {
      throw new Error(
        "Die PDF enthält bereits eine Signatur. Erneutes Signieren würde die bestehende Signatur ungültig machen " +
        "(inkrementelles Update wird nicht unterstützt) — bitte das unsignierte Original verwenden."
      );
    }
  }
}

/** Eindeutigen Feldnamen finden (falls 'Signature1' schon existiert). */
function uniqueFieldName(acroForm: PDFDict | undefined): string {
  const existing = new Set<string>();
  const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (fields) {
    for (let i = 0; i < fields.size(); i++) {
      const f = fields.lookup(i);
      if (f instanceof PDFDict) {
        const t = f.get(PDFName.of("T"));
        if (t instanceof PDFString || t instanceof PDFHexString) existing.add(t.decodeText());
      }
    }
  }
  let n = 1;
  while (existing.has(`Signature${n}`)) n++;
  return `Signature${n}`;
}

/**
 * Signiert eine PDF mit einem P12/PFX-Zertifikat: adbe.pkcs7.detached,
 * SHA-256, CMS mit signierten Attributen. Unsichtbares Feld auf Seite 1.
 * I/O als base64 (JS-Interop-freundlich); MCP-Pendant: Tool `pdf_sign`.
 */
export async function signPdf(
  pdfBase64: string,
  p12Base64: string,
  password: string,
  opts?: SignBridgeOptions | null
): Promise<SignBridgeResult> {
  const pdfBytes = base64ToBytes(pdfBase64);
  const p12Bytes = base64ToBytes(p12Base64);
  const options = opts ?? {};

  const { privateKey, signerCert, chain, warnings } = parseP12(p12Bytes, password);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes);
  } catch (e) {
    const m = errMsg(e);
    if (/encrypt/i.test(m)) {
      throw new Error(`PDF ist passwortgeschützt/verschlüsselt — bitte zuerst entschlüsseln. (${m})`);
    }
    throw new Error(`Keine gültige PDF oder beschädigt (${m}).`);
  }

  rejectExistingSignatures(doc);

  const ctx = doc.context;
  const now = new Date();

  // --- 1) Sig-Dict mit ByteRange-/Contents-Platzhaltern ----------------------
  const sigDict = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
  });
  sigDict.set(PDFName.of("ByteRange"), ctx.obj([
    PDFNumber.of(0),
    PDFName.of(BYTE_RANGE_PLACEHOLDER),
    PDFName.of(BYTE_RANGE_PLACEHOLDER),
    PDFName.of(BYTE_RANGE_PLACEHOLDER),
  ]));
  sigDict.set(PDFName.of("Contents"), PDFHexString.of("0".repeat(CONTENTS_HEX_LENGTH)));
  sigDict.set(PDFName.of("M"), PDFString.of(toPdfDate(now)));
  if (options.reason) sigDict.set(PDFName.of("Reason"), PDFString.of(options.reason));
  if (options.location) sigDict.set(PDFName.of("Location"), PDFString.of(options.location));
  if (options.contactInfo) sigDict.set(PDFName.of("ContactInfo"), PDFString.of(options.contactInfo));
  const sigDictRef = ctx.register(sigDict);

  // --- 2) Unsichtbares Signaturfeld (Widget Rect [0 0 0 0] auf Seite 1) ------
  const acroFormExisting = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const fieldName = uniqueFieldName(acroFormExisting);
  const page = doc.getPage(0);
  const widget = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: [0, 0, 0, 0],
    F: 4, // Print-Flag
  });
  widget.set(PDFName.of("T"), PDFString.of(fieldName));
  widget.set(PDFName.of("V"), sigDictRef);
  widget.set(PDFName.of("P"), page.ref);
  const widgetRef = ctx.register(widget);

  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(widgetRef);
  else page.node.set(PDFName.of("Annots"), ctx.obj([widgetRef]));

  let acroForm = acroFormExisting;
  if (!acroForm) {
    acroForm = ctx.obj({}) as PDFDict;
    doc.catalog.set(PDFName.of("AcroForm"), ctx.register(acroForm));
  }
  acroForm.set(PDFName.of("SigFlags"), PDFNumber.of(3)); // SignaturesExist + AppendOnly
  const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (fields) fields.push(widgetRef);
  else acroForm.set(PDFName.of("Fields"), ctx.obj([widgetRef]));

  // Klassische xref-Struktur, damit Sig-Dict/Platzhalter als Klartext im File liegen.
  const saved = await doc.save({ useObjectStreams: false });

  // --- 3) ByteRange berechnen und Platzhalter byte-genau überschreiben -------
  const pdfStr = bytesToBinaryString(saved);
  const contentsToken = "<" + "0".repeat(CONTENTS_HEX_LENGTH) + ">";
  const contentsStart = pdfStr.indexOf(contentsToken);
  if (contentsStart < 0 || pdfStr.indexOf(contentsToken, contentsStart + 1) >= 0) {
    throw new Error("Interner Fehler: /Contents-Platzhalter nicht eindeutig in den PDF-Bytes gefunden.");
  }
  const contentsEnd = contentsStart + contentsToken.length; // hinter '>'

  const brRegex = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/;
  const brMatch = brRegex.exec(pdfStr);
  if (!brMatch) {
    throw new Error("Interner Fehler: /ByteRange-Platzhalter nicht in den PDF-Bytes gefunden.");
  }
  const byteRange = [0, contentsStart, contentsEnd, saved.length - contentsEnd];
  const brActual = `/ByteRange [${byteRange.join(" ")}]`;
  if (brActual.length > brMatch[0].length) {
    throw new Error("Interner Fehler: ByteRange-Werte länger als der reservierte Platzhalter.");
  }
  const brPadded = brActual + " ".repeat(brMatch[0].length - brActual.length);
  for (let i = 0; i < brPadded.length; i++) saved[brMatch.index + i] = brPadded.charCodeAt(i);

  // --- 4) CMS/PKCS#7 (detached) über die ByteRange-Teile ---------------------
  const signedContent =
    bytesToBinaryString(saved.subarray(0, contentsStart)) +
    bytesToBinaryString(saved.subarray(contentsEnd));

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(signedContent);
  for (const cert of chain) p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest }, // wird von forge über p7.content berechnet
      { type: forge.pki.oids.signingTime, value: now as unknown as string },
    ],
  });
  try {
    p7.sign({ detached: true });
  } catch (e) {
    throw new Error(`CMS-Signatur fehlgeschlagen (${errMsg(e)}).`);
  }

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hex = forge.util.bytesToHex(der);
  if (hex.length > CONTENTS_HEX_LENGTH) {
    throw new Error(
      `Die CMS-Signatur (${hex.length / 2} Bytes) übersteigt den reservierten Platz von ${CONTENTS_HEX_LENGTH / 2} Bytes — Zertifikatskette zu groß.`
    );
  }
  // Hex in die Contents-Lücke schreiben; der Rest bleibt mit '0' aufgefüllt.
  for (let i = 0; i < hex.length; i++) saved[contentsStart + 1 + i] = hex.charCodeAt(i);

  return { dataBase64: bytesToBase64(saved), signerSubject: subjectToString(signerCert), warnings };
}
