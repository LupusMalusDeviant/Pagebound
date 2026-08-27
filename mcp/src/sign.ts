// =============================================================================
// Zertifikatsbasierte PDF-Signatur (P12/PFX) für den Pagebound MCP-Server.
//
// EHRLICHER SCOPE: PAdES-B-B (EN 319 142-1), SubFilter `ETSI.CAdES.detached`, mit
// SHA-256 und CMS/PKCS#7 inkl. authenticatedAttributes (contentType,
// messageDigest, signingTime, signingCertificateV2), die Attribute in
// DER-Reihenfolge sortiert (RFC 5652 §5.4) — damit auch für Prüfer, die neu
// kodieren (BouncyCastle, eIDAS-Validatoren), nicht nur für Adobe/Foxit.
// signingCertificateV2 (RFC 5035) bindet die Signatur an genau dieses
// Zertifikat; ohne dieses Attribut wäre es formal keine CAdES-Signatur.
// Was NICHT passiert:
//   • KEIN Zeitstempel (RFC 3161) — bewusst zurückgestellt: er wäre der erste
//     ausgehende Netzverkehr des Projekts überhaupt,
//   • KEIN LTV (keine Sperrlisten/OCSP eingebettet),
//   • KEIN B-T/B-LT/B-LTA — der SubFilter sagt ETSI.CAdES.detached und meint
//     damit die Grundstufe PAdES-B-B; alles darueber braucht Zeitstempel bzw.
//     eingebettete Sperrinformationen.
// Trägt die Eingabe bereits eine Signatur, wird die neue als INKREMENTELLES
// UPDATE angehängt: die Originalbytes bleiben unangetastet, die bestehende
// Signatur damit gültig. Voraussetzung ist eine klassische xref-Tabelle —
// Cross-Reference-Streams werden mit klarer Meldung abgelehnt.
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
// Bewusste Code-Duplikation mit der PWA-Bridge
// (src/Pagebound.Web/wwwroot/js/sign-bridge.ts) — gleiches Muster wie
// design.ts / pdfa.ts.
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
import forge from "node-forge";
import { NO_METADATA_BUMP, ToolError } from "./pdf.js";

/** Platzhalter je ByteRange-Zahl: /********** (10 Zeichen, wie node-signpdf). */
const BYTE_RANGE_PLACEHOLDER = "**********";
/** Reservierte /Contents-Länge in Hex-Zeichen (8 KB DER) — genug für 2–3 Zertifikate. */
const CONTENTS_HEX_LENGTH = 16384;

export interface SignOptions {
  reason?: string | null;
  location?: string | null;
  contactInfo?: string | null;
}

export interface SignResult {
  bytes: Uint8Array;
  signerSubject: string;
  warnings: string[];
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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

// --- CMS/PKCS#7 selbst gebaut ------------------------------------------------
// WARUM NICHT forge.pkcs7: dessen Attribut-Kodierer kennt nur contentType,
// messageDigest und signingTime — ein eigenes Attribut wie
// signingCertificateV2 kann er nicht schreiben. Und er sortiert die Attribute
// nicht, obwohl RFC 5652 §5.4 den Digest über die DER-Kodierung des
// SignedAttrs-SET bildet und DER (X.690 11.6) ein SET aufsteigend sortiert
// verlangt. Wer über die EMPFANGENEN Bytes prüft, merkt davon nichts — das
// gilt für Adobe ebenso wie für .NET SignedCms.CheckSignature (nachgemessen).
// Wer die Attribute vor der Prüfung NEU nach DER kodiert, und das tun
// BouncyCastle und eIDAS-Validatoren, bekommt einen anderen Digest und lehnt
// ab. Gegenprobe dazu: tools/cms-verify.
//
// Deshalb wird die SignedData-Struktur hier direkt aufgebaut. Die eigentliche
// Kryptographie bleibt bei forge (RSASSA-PKCS1-v1_5 über SHA-256) — gebaut
// wird nur ASN.1. Die Struktur ist bewusst byte-gleich zu dem, was forge vorher
// erzeugt hat (NULL-Parameter an den AlgorithmIdentifiern, Zertifikate als
// [0] IMPLICIT), damit sich gegenüber der bisherigen Ausgabe NUR die
// Attribut-Reihenfolge und das neue Attribut ändern.
const asn1 = forge.asn1;
const { Class: AsnClass, Type: AsnType } = asn1;

/** id-aa-signingCertificateV2 (RFC 5035 §3). */
const OID_SIGNING_CERTIFICATE_V2 = "1.2.840.113549.1.9.16.2.47";

const seq = (value: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
  asn1.create(AsnClass.UNIVERSAL, AsnType.SEQUENCE, true, value);
const set = (value: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
  asn1.create(AsnClass.UNIVERSAL, AsnType.SET, true, value);
const oid = (value: string): forge.asn1.Asn1 =>
  asn1.create(AsnClass.UNIVERSAL, AsnType.OID, false, asn1.oidToDer(value).getBytes());
const octets = (value: string): forge.asn1.Asn1 =>
  asn1.create(AsnClass.UNIVERSAL, AsnType.OCTETSTRING, false, value);
const nullValue = (): forge.asn1.Asn1 =>
  asn1.create(AsnClass.UNIVERSAL, AsnType.NULL, false, "");
const context = (tag: number, composed: boolean, value: forge.asn1.Asn1[] | string): forge.asn1.Asn1 =>
  asn1.create(AsnClass.CONTEXT_SPECIFIC, tag, composed, value as never);
/** AlgorithmIdentifier mit NULL-Parametern — wie bisher von forge erzeugt. */
const algorithm = (id: string): forge.asn1.Asn1 => seq([oid(id), nullValue()]);
const der = (node: forge.asn1.Asn1): string => asn1.toDer(node).getBytes();

/** Attribute ::= SEQUENCE { attrType OBJECT IDENTIFIER, attrValues SET OF ANY } */
function attributeToAsn1(type: string, value: forge.asn1.Asn1): forge.asn1.Asn1 {
  return seq([oid(type), set([value])]);
}

/** signingTime: UTCTime für 1950–2049, sonst GeneralizedTime (RFC 2985). */
function signingTimeValue(date: Date): forge.asn1.Asn1 {
  const inUtcRange = date >= new Date("1950-01-01T00:00:00Z") && date < new Date("2050-01-01T00:00:00Z");
  return inUtcRange
    ? asn1.create(AsnClass.UNIVERSAL, AsnType.UTCTIME, false, asn1.dateToUtcTime(date))
    : asn1.create(AsnClass.UNIVERSAL, AsnType.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(date));
}

/**
 * Holt Aussteller-Namen und Seriennummer AUS DEM ZERTIFIKAT selbst, statt sie
 * neu zu kodieren: IssuerSerial muss byte-genau zu dem passen, was im
 * eingebetteten Zertifikat steht.
 *
 * TBSCertificate ::= SEQUENCE { [0] version DEFAULT v1, serialNumber INTEGER,
 *                               signature AlgorithmIdentifier, issuer Name, … }
 */
function issuerAndSerial(certAsn1: forge.asn1.Asn1): { issuer: forge.asn1.Asn1; serial: forge.asn1.Asn1 } {
  const tbs = (certAsn1.value as forge.asn1.Asn1[])[0];
  const fields = tbs.value as forge.asn1.Asn1[];
  const hasVersion = fields[0].tagClass === AsnClass.CONTEXT_SPECIFIC && fields[0].type === 0;
  const base = hasVersion ? 1 : 0;
  const serial = fields[base];
  const issuer = fields[base + 2];
  if (!serial || !issuer) {
    throw new ToolError("Das Signatur-Zertifikat hat keine erwartbare Struktur (Seriennummer/Aussteller nicht gefunden).", "CERT_INVALID");
  }
  return { issuer, serial };
}

/**
 * signingCertificateV2 (RFC 5035): bindet die Signatur an genau dieses
 * Zertifikat. Ohne dieses Attribut ist es formal keine CAdES-/PAdES-Signatur,
 * sondern eine klassische PKCS#7-Signatur.
 *
 * SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
 * ESSCertIDv2 ::= SEQUENCE { hashAlgorithm AlgorithmIdentifier DEFAULT sha256,
 *                            certHash OCTET STRING, issuerSerial IssuerSerial OPTIONAL }
 *
 * hashAlgorithm wird WEGGELASSEN: der Vorgabewert ist sha256, und DER verbietet
 * die Kodierung von Vorgabewerten. Wer neu kodiert, käme sonst auf andere Bytes.
 */
function signingCertificateV2(certAsn1: forge.asn1.Asn1): forge.asn1.Asn1 {
  const certDer = der(certAsn1);
  const certHash = forge.md.sha256.create().update(certDer).digest().getBytes();
  const { issuer, serial } = issuerAndSerial(certAsn1);
  // GeneralName ::= CHOICE { … directoryName [4] Name … } — Name ist selbst eine
  // CHOICE, deshalb ist der Tag explizit (konstruiert, mit dem Namen darin).
  const generalNames = seq([context(4, true, [issuer])]);
  const essCertIdV2 = seq([octets(certHash), seq([generalNames, serial])]);
  return attributeToAsn1(OID_SIGNING_CERTIFICATE_V2, seq([seq([essCertIdV2])]));
}

/**
 * Baut den SignedAttrs-SET in DER-Reihenfolge: die Elemente werden einzeln
 * kodiert und oktettweise aufsteigend sortiert. forge liefert latin1-Strings,
 * deren Code-Units 0–255 den Bytes entsprechen — `<`/`>` ist damit die
 * lexikographische Ordnung über die Oktette (kürzeres Präfix zuerst, wie DER
 * es für SET OF verlangt).
 */
function signedAttributes(contentDigest: string, signingTime: Date, certAsn1: forge.asn1.Asn1): forge.asn1.Asn1[] {
  const attrs = [
    attributeToAsn1(forge.pki.oids.contentType, oid(forge.pki.oids.data)),
    attributeToAsn1(forge.pki.oids.messageDigest, octets(contentDigest)),
    attributeToAsn1(forge.pki.oids.signingTime, signingTimeValue(signingTime)),
    signingCertificateV2(certAsn1),
  ];
  return attrs
    .map((node) => ({ node, bytes: der(node) }))
    .sort((x, y) => (x.bytes < y.bytes ? -1 : x.bytes > y.bytes ? 1 : 0))
    .map((e) => e.node);
}

/**
 * Vollständige CMS-SignedData (detached) über den bereits berechneten
 * Inhalts-Digest. Signiert wird der DER des SignedAttrs-SET (Tag 0x31), nicht
 * dessen [0]-IMPLICIT-Fassung im SignerInfo — RFC 5652 §5.4.
 */
function buildCms(
  privateKey: forge.pki.rsa.PrivateKey,
  signerCert: forge.pki.Certificate,
  chain: forge.pki.Certificate[],
  contentDigest: string,
  signingTime: Date,
): string {
  const signerAsn1 = forge.pki.certificateToAsn1(signerCert);
  const attrs = signedAttributes(contentDigest, signingTime, signerAsn1);

  const md = forge.md.sha256.create();
  md.update(der(set(attrs)));
  const signature = privateKey.sign(md, "RSASSA-PKCS1-V1_5");

  const { issuer, serial } = issuerAndSerial(signerAsn1);
  const signerInfo = seq([
    asn1.create(AsnClass.UNIVERSAL, AsnType.INTEGER, false, asn1.integerToDer(1).getBytes()),
    seq([issuer, serial]),                       // sid: IssuerAndSerialNumber
    algorithm(forge.pki.oids.sha256),
    context(0, true, attrs),                     // signedAttrs [0] IMPLICIT
    algorithm(forge.pki.oids.rsaEncryption),
    octets(signature),
  ]);

  const certs = chain.map((c) => (c === signerCert ? signerAsn1 : forge.pki.certificateToAsn1(c)));
  const signedData = seq([
    asn1.create(AsnClass.UNIVERSAL, AsnType.INTEGER, false, asn1.integerToDer(1).getBytes()),
    set([algorithm(forge.pki.oids.sha256)]),
    seq([oid(forge.pki.oids.data)]),             // detached: kein eContent
    context(0, true, certs),                     // certificates [0] IMPLICIT
    set([signerInfo]),
  ]);

  return der(seq([oid(forge.pki.oids.signedData), context(0, true, [signedData])]));
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
    throw new ToolError(`P12/PFX konnte nicht geöffnet werden — Passwort falsch oder Datei beschädigt (${errMsg(e)}).`, "CERT_PASSWORD");
  }

  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  const keyBag = shrouded.find((b) => b.key) ?? plain.find((b) => b.key);
  if (!keyBag?.key) throw new ToolError("Die P12/PFX-Datei enthält keinen privaten Schlüssel.", "CERT_INVALID");
  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;
  if (!privateKey.n || !privateKey.d) {
    throw new ToolError("Der private Schlüssel in der P12/PFX ist kein RSA-Schlüssel — nur RSA wird unterstützt.", "CERT_INVALID");
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const chain = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  if (chain.length === 0) throw new ToolError("Die P12/PFX-Datei enthält kein Zertifikat.", "CERT_INVALID");

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

/** Trägt das Dokument bereits eine Signatur (oder einen DocTimeStamp)? */
function hasExistingSignature(doc: PDFDocument): boolean {
  const sigName = PDFName.of("Sig");
  const docTs = PDFName.of("DocTimeStamp");
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    const isSigValue = type === sigName || type === docTs;
    const isSignedField = obj.get(PDFName.of("FT")) === sigName && obj.has(PDFName.of("V"));
    if (isSigValue || isSignedField) return true;
  }
  return false;
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

// --- Inkrementelles Update ---------------------------------------------------
// Trägt ein Dokument bereits eine Signatur, darf es NICHT neu geschrieben
// werden: die alte Signatur deckt einen Byte-Bereich der Datei ab, und ein
// Voll-Speichern verschiebt jedes Byte. Stattdessen bleiben die
// Originalbytes unangetastet und die neuen Objekte werden angehängt — mit
// eigener Querverweistabelle, die per /Prev auf die vorherige zeigt
// (PDF 32000-1, 7.5.6).

/** Byte-Offset der letzten Querverweistabelle aus dem abschließenden startxref. */
function findPreviousStartXref(bytes: Uint8Array): number {
  const tail = bytesToBinaryString(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const idx = tail.lastIndexOf("startxref");
  if (idx < 0) throw new ToolError("Die PDF hat kein abschließendes 'startxref' — inkrementelles Signieren nicht möglich.", "PDF_CORRUPT");
  const m = /startxref\s+(\d+)/.exec(tail.slice(idx));
  if (!m) throw new ToolError("Der 'startxref'-Eintrag der PDF ist unlesbar.", "PDF_CORRUPT");
  return Number(m[1]);
}

/** Ein indirektes Objekt als Bytes: "N G obj … endobj". */
function serializeIndirect(ref: PDFRef, obj: PDFObject): Uint8Array {
  const header = `${ref.objectNumber} ${ref.generationNumber} obj\n`;
  const footer = "\nendobj\n";
  const buf = new Uint8Array(header.length + obj.sizeInBytes() + footer.length);
  let off = 0;
  for (let i = 0; i < header.length; i++) buf[off++] = header.charCodeAt(i);
  off += obj.copyBytesInto(buf, off);
  for (let i = 0; i < footer.length; i++) buf[off++] = footer.charCodeAt(i);
  return buf.subarray(0, off);
}

/** Zusammenhängende Objektnummern zu xref-Unterabschnitten gruppieren. */
function xrefSections(offsets: Map<number, number>): Array<{ start: number; entries: number[] }> {
  const numbers = [...offsets.keys()].sort((a, b) => a - b);
  const sections: Array<{ start: number; entries: number[] }> = [];
  for (const n of numbers) {
    const last = sections[sections.length - 1];
    if (last && n === last.start + last.entries.length) last.entries.push(offsets.get(n)!);
    else sections.push({ start: n, entries: [offsets.get(n)!] });
  }
  return sections;
}

/**
 * Hängt die geänderten und neuen Objekte als inkrementelles Update an. Die
 * Originalbytes bleiben Byte für Byte erhalten — nur so überlebt eine bereits
 * vorhandene Signatur.
 */
function appendIncrementalUpdate(original: Uint8Array, ctx: PDFDocument["context"], touched: PDFRef[]): Uint8Array {
  const prevStartXref = findPreviousStartXref(original);
  const atPrev = bytesToBinaryString(original.subarray(prevStartXref, prevStartXref + 20));
  if (!/^\s*xref\b/.test(atPrev)) {
    throw new ToolError(
      "Die PDF nutzt Cross-Reference-Streams (PDF 1.5+). Inkrementelles Signieren ist dafür nicht implementiert — " +
      "bitte das Dokument zuvor mit klassischer xref-Struktur speichern (jedes von Pagebound erzeugte PDF hat sie).",
      "UNSUPPORTED",
    );
  }

  const parts: Uint8Array[] = [original];
  let pos = original.length;
  const push = (chunk: Uint8Array): void => { parts.push(chunk); pos += chunk.length; };
  const pushText = (text: string): void => {
    const b = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
    push(b);
  };

  // Sauber getrennt anfangen, falls die Datei nicht auf einem Zeilenumbruch endet.
  if (original[original.length - 1] !== 0x0a) pushText("\n");

  const offsets = new Map<number, number>();
  // Nach Objektnummer sortiert schreiben — gleiche Eingabe, gleiche Ausgabe.
  const sorted = [...touched].sort((a, b) => a.objectNumber - b.objectNumber);
  for (const ref of sorted) {
    const obj = ctx.lookup(ref);
    if (!obj) continue;
    offsets.set(ref.objectNumber, pos);
    push(serializeIndirect(ref, obj));
  }

  const xrefOffset = pos;
  pushText("xref\n");
  for (const section of xrefSections(offsets)) {
    pushText(`${section.start} ${section.entries.length}\n`);
    for (const entry of section.entries) {
      pushText(`${String(entry).padStart(10, "0")} 00000 n\r\n`);
    }
  }

  const trailer = ctx.obj({});
  trailer.set(PDFName.of("Size"), PDFNumber.of(ctx.largestObjectNumber + 1));
  if (ctx.trailerInfo.Root) trailer.set(PDFName.of("Root"), ctx.trailerInfo.Root);
  if (ctx.trailerInfo.Info) trailer.set(PDFName.of("Info"), ctx.trailerInfo.Info);
  // Die /ID wird unverändert übernommen: sie identifiziert dasselbe Dokument.
  if (ctx.trailerInfo.ID) trailer.set(PDFName.of("ID"), ctx.trailerInfo.ID);
  trailer.set(PDFName.of("Prev"), PDFNumber.of(prevStartXref));
  const trailerBytes = new Uint8Array(trailer.sizeInBytes());
  trailer.copyBytesInto(trailerBytes, 0);
  pushText("trailer\n");
  push(trailerBytes);
  pushText(`\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let off = 0;
  for (const part of parts) { out.set(part, off); off += part.length; }
  return out;
}

/**
 * Signiert eine PDF mit einem P12/PFX-Zertifikat: PAdES-B-B
 * (ETSI.CAdES.detached), SHA-256, CMS mit signierten Attributen inkl.
 * signingCertificateV2. Unsichtbares Feld auf Seite 1. Trägt das Dokument
 * bereits eine Signatur, wird die neue als inkrementelles Update angehängt,
 * damit die bestehende gültig bleibt.
 */
export async function signPdf(
  pdfBytes: Uint8Array,
  p12Bytes: Uint8Array,
  password: string,
  opts: SignOptions = {}
): Promise<SignResult> {
  const { privateKey, signerCert, chain, warnings } = parseP12(p12Bytes, password);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, NO_METADATA_BUMP);
  } catch (e) {
    const m = errMsg(e);
    if (/encrypt/i.test(m)) {
      throw new ToolError(`PDF ist passwortgeschützt/verschlüsselt — bitte zuerst entschlüsseln. (${m})`, "PDF_ENCRYPTED");
    }
    throw new ToolError(`Keine gültige PDF oder beschädigt (${m}).`, "PDF_CORRUPT");
  }

  // Bereits signiert? Dann wird angehängt statt neu geschrieben (siehe unten).
  const incremental = hasExistingSignature(doc);
  // Geänderte und neue Objekte, die im inkrementellen Update landen müssen.
  const touched: PDFRef[] = [];

  const ctx = doc.context;
  const now = new Date();

  // --- 1) Sig-Dict mit ByteRange-/Contents-Platzhaltern ----------------------
  const sigDict = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    // ETSI.CAdES.detached: die Signatur erfuellt PAdES-B-B (EN 319 142-1) —
    // CAdES-Container mit signingCertificateV2 und DER-sortierten Attributen.
    // NICHT B-T: dafuer fehlt der Zeitstempel. Die Zeitangabe steht in /M und
    // im signingTime-Attribut, beide aus derselben Quelle, also widerspruchsfrei.
    SubFilter: "ETSI.CAdES.detached",
  });
  sigDict.set(PDFName.of("ByteRange"), ctx.obj([
    PDFNumber.of(0),
    PDFName.of(BYTE_RANGE_PLACEHOLDER),
    PDFName.of(BYTE_RANGE_PLACEHOLDER),
    PDFName.of(BYTE_RANGE_PLACEHOLDER),
  ]));
  sigDict.set(PDFName.of("Contents"), PDFHexString.of("0".repeat(CONTENTS_HEX_LENGTH)));
  sigDict.set(PDFName.of("M"), PDFString.of(toPdfDate(now)));
  if (opts.reason) sigDict.set(PDFName.of("Reason"), PDFString.of(opts.reason));
  if (opts.location) sigDict.set(PDFName.of("Location"), PDFString.of(opts.location));
  if (opts.contactInfo) sigDict.set(PDFName.of("ContactInfo"), PDFString.of(opts.contactInfo));
  const sigDictRef = ctx.register(sigDict);
  touched.push(sigDictRef);

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
  touched.push(widgetRef);

  // Beim Anhängen zählt, WELCHES Objekt sich ändert: liegt das Annots-Array
  // als eigenes Objekt vor, wird dieses neu geschrieben, sonst die Seite.
  const annotsRaw = page.node.get(PDFName.of("Annots"));
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) {
    annots.push(widgetRef);
    touched.push(annotsRaw instanceof PDFRef ? annotsRaw : page.ref);
  } else {
    page.node.set(PDFName.of("Annots"), ctx.obj([widgetRef]));
    touched.push(page.ref);
  }

  const acroFormRaw = doc.catalog.get(PDFName.of("AcroForm"));
  let acroForm = acroFormExisting;
  if (!acroForm) {
    acroForm = ctx.obj({}) as PDFDict;
    const acroRef = ctx.register(acroForm);
    doc.catalog.set(PDFName.of("AcroForm"), acroRef);
    touched.push(acroRef);
    // Der Katalog verweist jetzt auf ein neues Objekt und muss mit.
    if (ctx.trailerInfo.Root instanceof PDFRef) touched.push(ctx.trailerInfo.Root);
  } else if (acroFormRaw instanceof PDFRef) {
    touched.push(acroFormRaw);
  } else if (ctx.trailerInfo.Root instanceof PDFRef) {
    touched.push(ctx.trailerInfo.Root); // AcroForm steht direkt im Katalog
  }
  acroForm.set(PDFName.of("SigFlags"), PDFNumber.of(3)); // SignaturesExist + AppendOnly
  const fieldsRaw = acroForm.get(PDFName.of("Fields"));
  const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (fields) {
    fields.push(widgetRef);
    if (fieldsRaw instanceof PDFRef) touched.push(fieldsRaw);
  }
  else acroForm.set(PDFName.of("Fields"), ctx.obj([widgetRef]));

  // Ohne vorhandene Signatur wird normal gespeichert (klassische xref-Struktur,
  // damit Sig-Dict und Platzhalter als Klartext in der Datei liegen). Mit
  // vorhandener Signatur MUSS angehängt werden, sonst bricht die alte.
  const saved = incremental
    ? appendIncrementalUpdate(pdfBytes, ctx, touched)
    : await doc.save({ useObjectStreams: false });

  // --- 3) ByteRange berechnen und Platzhalter byte-genau überschreiben -------
  const pdfStr = bytesToBinaryString(saved);
  const contentsToken = "<" + "0".repeat(CONTENTS_HEX_LENGTH) + ">";
  const contentsStart = pdfStr.indexOf(contentsToken);
  if (contentsStart < 0 || pdfStr.indexOf(contentsToken, contentsStart + 1) >= 0) {
    throw new ToolError("Interner Fehler: /Contents-Platzhalter nicht eindeutig in den PDF-Bytes gefunden.", "INTERNAL");
  }
  const contentsEnd = contentsStart + contentsToken.length; // hinter '>'

  const brRegex = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/;
  const brMatch = brRegex.exec(pdfStr);
  if (!brMatch) {
    throw new ToolError("Interner Fehler: /ByteRange-Platzhalter nicht in den PDF-Bytes gefunden.", "INTERNAL");
  }
  const byteRange = [0, contentsStart, contentsEnd, saved.length - contentsEnd];
  const brActual = `/ByteRange [${byteRange.join(" ")}]`;
  if (brActual.length > brMatch[0].length) {
    throw new ToolError("Interner Fehler: ByteRange-Werte länger als der reservierte Platzhalter.", "INTERNAL");
  }
  const brPadded = brActual + " ".repeat(brMatch[0].length - brActual.length);
  for (let i = 0; i < brPadded.length; i++) saved[brMatch.index + i] = brPadded.charCodeAt(i);

  // --- 4) CMS/PKCS#7 (detached) über die ByteRange-Teile ---------------------
  const signedContent =
    bytesToBinaryString(saved.subarray(0, contentsStart)) +
    bytesToBinaryString(saved.subarray(contentsEnd));

  const contentDigest = forge.md.sha256.create().update(signedContent).digest().getBytes();
  let cms: string;
  try {
    cms = buildCms(privateKey, signerCert, chain, contentDigest, now);
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(`CMS-Signatur fehlgeschlagen (${errMsg(e)}).`, "PROCESSING_FAILED");
  }

  const hex = forge.util.bytesToHex(cms);
  if (hex.length > CONTENTS_HEX_LENGTH) {
    throw new ToolError(
      `Die CMS-Signatur (${hex.length / 2} Bytes) übersteigt den reservierten Platz von ${CONTENTS_HEX_LENGTH / 2} Bytes — Zertifikatskette zu groß.`
    , "UNSUPPORTED");
  }
  // Hex in die Contents-Lücke schreiben; der Rest bleibt mit '0' aufgefüllt.
  for (let i = 0; i < hex.length; i++) saved[contentsStart + 1 + i] = hex.charCodeAt(i);

  return { bytes: saved, signerSubject: subjectToString(signerCert), warnings };
}
