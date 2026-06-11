// Smoke test for the PDF operations (run after `npm run build`: `node dist/smoke.js`).
// Bytes-in/bytes-out — no temp files; exercises every operation end-to-end.
import { PDFBool, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import forge from "node-forge";
import * as pdf from "./pdf.js";
import * as design from "./design.js";
import * as pdfa from "./pdfa.js";
import * as pdfua from "./pdfua.js";
import * as sign from "./sign.js";
import { encryptPdf } from "./encrypt.js";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures++;
    process.stdout.write(`  ✗ ${name} ${detail}\n`);
  }
}

async function makeSample(pageCount: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const p = doc.addPage([400, 600]);
    p.drawText(`${label} Seite ${i} Pagebound Test`, { x: 40, y: 540, size: 18, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

async function makeFormSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const form = doc.getForm();
  const name = form.createTextField("applicant.name");
  name.addToPage(page, { x: 40, y: 520, width: 200, height: 20 });
  const agree = form.createCheckBox("applicant.agree");
  agree.addToPage(page, { x: 40, y: 480, width: 14, height: 14 });
  return doc.save();
}

// Mini-Tabelle: 2 Spalten (x=40, x=240), 2 Zeilen (y=150, y=120).
async function makeTableSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 200]);
  p.drawText("Name", { x: 40, y: 150, size: 12, font, color: rgb(0, 0, 0) });
  p.drawText("Preis", { x: 240, y: 150, size: 12, font, color: rgb(0, 0, 0) });
  p.drawText("Apfel", { x: 40, y: 120, size: 12, font, color: rgb(0, 0, 0) });
  p.drawText("1.50", { x: 240, y: 120, size: 12, font, color: rgb(0, 0, 0) });
  return doc.save();
}

// 1x1 transparent PNG
const PNG_1x1 = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

async function main() {
  const a = await makeSample(3, "A");
  const b = await makeSample(2, "B");

  process.stdout.write("pagebound-pdf-mcp smoke\n");

  const info = await pdf.getInfo(a);
  check("pdf_info pageCount=3", info.pageCount === 3, JSON.stringify(info.pageCount));
  check("pdf_info size 400x600", info.pages[0].widthPt === 400 && info.pages[0].heightPt === 600);

  const m = await pdf.merge([a, b]);
  check("pdf_merge 3+2=5", m.pageCount === 5, JSON.stringify(m.pageCount));
  check("pdf_merge returns bytes", m.bytes instanceof Uint8Array && m.bytes.length > 0);

  const e = await pdf.extractPages(a, "3,1");
  check("pdf_extract_pages '3,1' → 2", e.pageCount === 2, JSON.stringify(e.pageCount));

  const d = await pdf.deletePages(a, "2");
  check("pdf_delete_pages '2' → 2 left, 1 deleted", d.pageCount === 2 && d.deleted === 1);

  const r = await pdf.rotatePages(a, "1-2", 90);
  check("pdf_rotate_pages '1-2' 90° → rotated 2", r.rotated === 2);

  const ro = await pdf.reorderPages(a, [3, 2, 1]);
  check("pdf_reorder_pages [3,2,1] → 3", ro.pageCount === 3);

  const ip = await pdf.imagesToPdf([PNG_1x1, PNG_1x1], "a4");
  check("images_to_pdf 2 PNG → 2 pages", ip.pageCount === 2);

  // round-trip: merge output is itself a valid PDF
  const reparse = await pdf.getInfo(m.bytes);
  check("merge output re-parses → 5 pages", reparse.pageCount === 5, JSON.stringify(reparse.pageCount));

  // page-spec edge cases
  try { pdf.parsePageSpec("1-3,5", 5); check("parsePageSpec valid", true); } catch { check("parsePageSpec valid", false); }
  try { pdf.parsePageSpec("9", 5); check("parsePageSpec out-of-range throws", false); } catch { check("parsePageSpec out-of-range throws", true); }

  // text extraction (pdfjs) — the trickiest path in Node
  try {
    const t = await pdf.extractText(a, "1");
    const has = /Pagebound Test/.test(t.pages[0]?.text ?? "");
    check("pdf_extract_text finds drawn text", has, JSON.stringify(t.pages[0]?.text?.slice(0, 60)));
  } catch (err) {
    check("pdf_extract_text runs without throwing", false, String(err));
  }

  // table extraction (Best-Effort-Heuristik) — fresh sample (pdfjs detaches buffers)
  try {
    const tbl = await pdf.extractTablesCsv(await makeTableSample(), "1");
    const lines = tbl.csv.split("\n");
    check("pdf_extract_tables → 2 rows", lines.length === 2, JSON.stringify(tbl.csv));
    check("pdf_extract_tables header row 'Name,Preis'", lines[0] === "Name,Preis", JSON.stringify(lines[0]));
    check("pdf_extract_tables data row 'Apfel,1.50'", lines[1] === "Apfel,1.50", JSON.stringify(lines[1]));
  } catch (err) {
    check("pdf_extract_tables runs without throwing", false, String(err));
  }

  // NB: pdfjs (extractText above) detaches its input buffer, so reuse a fresh sample.
  const s3 = await makeSample(3, "S");

  // split
  const sp = await pdf.split(s3, "1");
  check("pdf_split '1' → 2 parts [1,2]", sp.parts.length === 2 && sp.pageCounts[0] === 1 && sp.pageCounts[1] === 2, JSON.stringify(sp.pageCounts));
  check("pdf_split parts re-parse", (await pdf.getInfo(sp.parts[0])).pageCount === 1);

  // stamp
  const st = await pdf.stamp(s3, { watermarkText: "ENTWURF", pageNumbers: true });
  check("pdf_stamp → 3 pages, bytes grow", st.pageCount === 3 && st.bytes.length > s3.length);
  check("pdf_stamp output re-parses", (await pdf.getInfo(st.bytes)).pageCount === 3);

  // forms
  const fp = await makeFormSample();
  const fields = await pdf.getFormFields(fp);
  const nameField = fields.find((f) => f.name === "applicant.name");
  const agreeField = fields.find((f) => f.name === "applicant.agree");
  check("pdf_form_fields finds 2 fields", fields.length === 2 && !!nameField && !!agreeField, JSON.stringify(fields.map((f) => f.name)));
  check("pdf_form_fields types Text/Checkbox", nameField?.type === "Text" && agreeField?.type === "Checkbox");
  const filled = await pdf.fillForm(fp, [
    { name: "applicant.name", value: ["Ada Lovelace"] },
    { name: "applicant.agree", value: ["true"] },
    { name: "does.not.exist", value: ["x"] },
  ], false);
  check("pdf_fill_form filled 2, skipped 1", filled.filled === 2 && filled.skipped.length === 1 && filled.skipped[0] === "does.not.exist");
  const reread = await pdf.getFormFields(filled.bytes);
  const rn = reread.find((f) => f.name === "applicant.name");
  const ra = reread.find((f) => f.name === "applicant.agree");
  check("pdf_fill_form values persisted", rn?.value[0] === "Ada Lovelace" && ra?.value[0] === "true", JSON.stringify({ n: rn?.value, a: ra?.value }));
  const flat = await pdf.fillForm(fp, [{ name: "applicant.name", value: ["Flat"] }], true);
  check("pdf_fill_form flatten removes fields", (await pdf.getFormFields(flat.bytes)).length === 0);

  // encrypt (AES-256 R6) — verify it opens with the password via pdfjs
  const enc = await encryptPdf(s3, "open-me");
  const encText = Buffer.from(enc).toString("latin1");
  check("pdf_encrypt writes /Filter /Standard /AESV3", encText.includes("/Filter /Standard") && encText.includes("/AESV3"));
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const okDoc = await pdfjs.getDocument({ data: enc.slice(), password: "open-me", verbosity: 0 }).promise;
    check("pdf_encrypt opens with correct password → 3 pages", okDoc.numPages === 3, JSON.stringify(okDoc.numPages));
    await okDoc.loadingTask.destroy();
    let wrongRejected = false;
    try { await pdfjs.getDocument({ data: enc.slice(), password: "wrong", verbosity: 0 }).promise; }
    catch (e: any) { wrongRejected = e?.name === "PasswordException"; }
    check("pdf_encrypt rejects wrong password", wrongRejected);
  } catch (err) {
    check("pdf_encrypt verification ran", false, String(err));
  }

  // diff (text comparison between two PDFs)
  const diffA = await makeSample(2, "Alpha");
  const diffB = await makeSample(2, "Beta");
  const diff = await pdf.diffText(diffA, diffB);
  check("pdf_diff detects changes on both pages", diff.changed && diff.pages.length === 2, JSON.stringify({ changed: diff.changed, pages: diff.pages.length }));
  check("pdf_diff counts added+removed lines", diff.addedLines === 2 && diff.removedLines === 2, JSON.stringify({ a: diff.addedLines, r: diff.removedLines }));
  const same = await pdf.diffText(await makeSample(2, "Same"), await makeSample(2, "Same"));
  check("pdf_diff reports no change for identical text", same.changed === false && same.pages.length === 0, JSON.stringify(same.changed));

  // set_metadata
  const metaIn = await makeSample(1, "Meta");
  const meta = await pdf.setMetadata(metaIn, { title: "Vertrag v2", author: "Ada", keywords: ["pdf", "test"] });
  check("pdf_set_metadata applies title+author+keywords", meta.applied.includes("title") && meta.applied.includes("author") && meta.applied.includes("keywords"));
  const metaInfo = await pdf.getInfo(meta.bytes);
  check("pdf_set_metadata persists (info reads title/author)", metaInfo.title === "Vertrag v2" && metaInfo.author === "Ada", JSON.stringify({ t: metaInfo.title, a: metaInfo.author }));

  // create_field
  const cf = await pdf.createFields(await makeSample(1, "Form"), [
    { name: "fullName", type: "text", page: 1, x: 40, y: 500, width: 200, height: 18, value: "Ada Lovelace" },
    { name: "agree", type: "checkbox", page: 1, x: 40, y: 470, width: 14, height: 14, value: "true" },
  ]);
  check("pdf_create_field created 2 fields", cf.created === 2);
  const cfFields = await pdf.getFormFields(cf.bytes);
  const tf = cfFields.find((f) => f.name === "fullName");
  const cb = cfFields.find((f) => f.name === "agree");
  check("pdf_create_field fields readable + typed", tf?.type === "Text" && cb?.type === "Checkbox", JSON.stringify(cfFields.map((f) => `${f.name}:${f.type}`)));
  check("pdf_create_field text value set", tf?.value[0] === "Ada Lovelace", JSON.stringify(tf?.value));

  // --- PDF → PDF/A (Best Effort) -----------------------------------------------
  // Sample mit Standard-14-Font (Helvetica, nicht eingebettet), OpenAction + Formularfeld.
  {
    const srcDoc = await PDFDocument.load(await makeFormSample());
    srcDoc.catalog.set(PDFName.of("OpenAction"), srcDoc.context.obj({}));
    const srcBytes = await srcDoc.save();

    // embedFonts:false — der klassische Pfad: Helvetica bleibt nicht eingebettet → Warnung.
    const conv = await pdfa.toPdfA(srcBytes, true, false);
    const reDoc = await PDFDocument.load(conv.bytes);
    check("pdf_to_pdfa output re-parses (1 page)", reDoc.getPageCount() === 1);
    check("pdf_to_pdfa sets Catalog /Metadata", reDoc.catalog.has(PDFName.of("Metadata")));
    check("pdf_to_pdfa sets /OutputIntents", reDoc.catalog.has(PDFName.of("OutputIntents")));
    check("pdf_to_pdfa removes /OpenAction", !reDoc.catalog.has(PDFName.of("OpenAction")));
    const raw = Buffer.from(conv.bytes).toString("latin1");
    check("pdf_to_pdfa XMP declares pdfaid part=2/B",
      raw.includes("<pdfaid:part>2</pdfaid:part>") && raw.includes("<pdfaid:conformance>B</pdfaid:conformance>"));
    check("pdf_to_pdfa embeds GTS_PDFA1 + ICC ('acsp')", raw.includes("/GTS_PDFA1") && raw.includes("acsp"));
    check("pdf_to_pdfa writes trailer /ID", /\/ID\s*\[/.test(raw));
    check("pdf_to_pdfa flattens form fields", (await pdf.getFormFields(conv.bytes)).length === 0);
    const fontWarn = conv.warnings.some((w) => w.includes("Helvetica") && w.includes("nicht eingebettet"));
    check("pdf_to_pdfa warns about non-embedded Helvetica", fontWarn, JSON.stringify(conv.warnings));
    const openActionWarn = conv.warnings.some((w) => w.includes("/OpenAction"));
    check("pdf_to_pdfa reports /OpenAction removal", openActionWarn, JSON.stringify(conv.warnings));

    // XMP übernimmt dc:title aus dem Info-Dict.
    const metaSrc = await pdf.setMetadata(await makeSample(1, "PdfA"), { title: "Archiv & Co", author: "Ada" });
    const conv2 = await pdfa.toPdfA(metaSrc.bytes, true);
    const raw2 = Buffer.from(conv2.bytes).toString("latin1");
    check("pdf_to_pdfa XMP carries dc:title (xml-escaped)", raw2.includes("Archiv &amp; Co"));
    check("pdf_to_pdfa XMP carries dc:creator", raw2.includes("<rdf:li>Ada</rdf:li>"));

    // --- Font-Härtung (embedFonts:true, Default): Helvetica → Liberation Sans ---
    const convEmbed = await pdfa.toPdfA(await makeSample(1, "FontEmbed"), true, true);
    const rawEmbed = Buffer.from(convEmbed.bytes).toString("latin1");
    check("pdf_to_pdfa embedFonts embeds FontFile2", rawEmbed.includes("/FontFile2"));
    check("pdf_to_pdfa embedFonts: no 'nicht eingebettet' warning for Helvetica",
      !convEmbed.warnings.some((w) => w.includes("Helvetica") && w.includes("nicht eingebettet")), JSON.stringify(convEmbed.warnings));
    check("pdf_to_pdfa embedFonts reports Liberation Sans replacement",
      convEmbed.warnings.some((w) => w.includes("Helvetica") && w.includes("Liberation Sans")), JSON.stringify(convEmbed.warnings));
    const reEmbed = await PDFDocument.load(convEmbed.bytes);
    check("pdf_to_pdfa embedFonts output re-parses (1 page)", reEmbed.getPageCount() === 1);
    check("pdf_to_pdfa embedFonts switches dict to TrueType+WinAnsi",
      rawEmbed.includes("/TrueType") && rawEmbed.includes("/WinAnsiEncoding"));
    try {
      const reText = await pdf.extractText(convEmbed.bytes.slice(), "1");
      check("pdf_to_pdfa embedFonts keeps text extractable",
        /Pagebound Test/.test(reText.pages[0]?.text ?? ""), JSON.stringify(reText.pages[0]?.text?.slice(0, 60)));
    } catch (err) {
      check("pdf_to_pdfa embedFonts text extraction runs", false, String(err));
    }
  }

  // --- pdf_ua_prepare (PDF/UA-Vorbereitung + Bericht) ----------------------------
  {
    const uaSrc = await makeSample(1, "Ua");
    const prep = await pdfua.preparePdfUa(uaSrc, { lang: "de-DE" });
    const reDoc = await PDFDocument.load(prep.bytes);
    const markInfo = reDoc.catalog.lookupMaybe(PDFName.of("MarkInfo"), PDFDict);
    check("pdf_ua_prepare sets /MarkInfo Marked true",
      markInfo?.get(PDFName.of("Marked")) === PDFBool.True);
    const langStr = reDoc.catalog.lookupMaybe(PDFName.of("Lang"), PDFString)?.decodeText();
    check("pdf_ua_prepare sets Catalog /Lang de-DE", langStr === "de-DE", JSON.stringify(langStr));
    const vp = reDoc.catalog.lookupMaybe(PDFName.of("ViewerPreferences"), PDFDict);
    check("pdf_ua_prepare sets /DisplayDocTitle true",
      vp?.get(PDFName.of("DisplayDocTitle")) === PDFBool.True);
    const rawUa = Buffer.from(prep.bytes).toString("latin1");
    check("pdf_ua_prepare XMP declares pdfuaid:part=1", rawUa.includes("<pdfuaid:part>1</pdfuaid:part>"));
    check("pdf_ua_prepare reports missing StructTreeRoot (not tagged)",
      prep.report.some((r) => r.includes("StructTreeRoot")), JSON.stringify(prep.report));
    check("pdf_ua_prepare reports missing title",
      prep.report.some((r) => r.includes("Dokumenttitel")), JSON.stringify(prep.report));
    let badLang = false;
    try { await pdfua.preparePdfUa(await makeSample(1, "UaBad"), { lang: "kein gültiger code" }); }
    catch (e) { badLang = e instanceof pdf.ToolError && /Sprachcode/.test(e.message); }
    check("pdf_ua_prepare rejects invalid lang", badLang);
  }

  // --- pdf_sign (Zertifikatssignatur) -------------------------------------------
  // Self-Signed-Zertifikat + P12 IM TEST erzeugen, signieren, dann verifizieren:
  // /ByteRange + /Contents aus den Bytes parsen, Digest über die ByteRange-Teile
  // neu rechnen, CMS laden, messageDigest-Attribut vergleichen + Signatur prüfen.
  {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const certAttrs = [
      { name: "commonName", value: "Pagebound Smoke" },
      { name: "countryName", value: "DE" },
    ];
    cert.setSubject(certAttrs);
    cert.setIssuer(certAttrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "smoke-pass", { algorithm: "3des" });
    const p12Bytes = new Uint8Array(Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary"));

    const signed = await sign.signPdf(await makeSample(2, "Sig"), p12Bytes, "smoke-pass", {
      reason: "Smoke-Test",
      location: "Node",
    });
    check("pdf_sign signerSubject has CN", signed.signerSubject.includes("CN=Pagebound Smoke"), signed.signerSubject);
    check("pdf_sign no warnings for fresh self-signed cert", signed.warnings.length === 0, JSON.stringify(signed.warnings));
    check("pdf_sign output re-parses (2 pages)", (await pdf.getInfo(signed.bytes)).pageCount === 2);

    const raw = Buffer.from(signed.bytes).toString("latin1");
    check("pdf_sign writes Sig dict markers", raw.includes("/Adobe.PPKLite") && raw.includes("/adbe.pkcs7.detached") && raw.includes("/SigFlags 3"));

    // 1) /ByteRange aus den Bytes parsen und auf Konsistenz prüfen
    const brMatch = raw.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    check("pdf_sign writes concrete /ByteRange", !!brMatch, raw.match(/\/ByteRange[^\]]*\]/)?.[0] ?? "(none)");
    const [b0, b1, b2, b3] = brMatch ? brMatch.slice(1, 5).map(Number) : [0, 0, 0, 0];
    check("pdf_sign ByteRange covers file minus /Contents",
      b0 === 0 && b2 > b1 && b2 + b3 === signed.bytes.length && raw[b1] === "<" && raw[b2 - 1] === ">",
      JSON.stringify({ b0, b1, b2, b3, total: signed.bytes.length }));

    // 2) Digest über die ByteRange-Teile neu rechnen
    const part1 = raw.slice(b0, b0 + b1);
    const part2 = raw.slice(b2, b2 + b3);
    const contentMd = forge.md.sha256.create();
    contentMd.update(part1 + part2);
    const expectedDigest = contentMd.digest().getBytes();

    // 3) CMS aus der /Contents-Lücke laden (DER; 0-Padding über die im
    //    DER-Header deklarierte Gesamtlänge abschneiden)
    const contentsHex = raw.slice(b1 + 1, b2 - 1);
    const padded = forge.util.hexToBytes(contentsHex);
    const lenByte = padded.charCodeAt(1);
    const lenOfLen = lenByte < 0x80 ? 0 : lenByte & 0x7f;
    let derLen = lenByte < 0x80 ? lenByte : 0;
    for (let i = 0; i < lenOfLen; i++) derLen = derLen * 256 + padded.charCodeAt(2 + i);
    const contentsDer = padded.slice(0, 2 + lenOfLen + derLen);
    check("pdf_sign /Contents DER shorter than reserved gap", contentsDer.length < padded.length && contentsDer.length > 0);
    const p7: any = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(contentsDer)));

    // 4) messageDigest-Attribut vergleichen
    const authAttrs: any[] = p7.rawCapture?.authenticatedAttributes ?? [];
    check("pdf_sign CMS has authenticatedAttributes", authAttrs.length >= 3, String(authAttrs.length));
    let messageDigestAttr: string | null = null;
    let hasContentType = false;
    let hasSigningTime = false;
    for (const attr of authAttrs) {
      const oid = forge.asn1.derToOid(attr.value[0].value);
      if (oid === forge.pki.oids.messageDigest) messageDigestAttr = attr.value[1].value[0].value as string;
      if (oid === forge.pki.oids.contentType) hasContentType = true;
      if (oid === forge.pki.oids.signingTime) hasSigningTime = true;
    }
    check("pdf_sign signed attrs: contentType + signingTime present", hasContentType && hasSigningTime);
    check("pdf_sign messageDigest equals recomputed SHA-256 of ByteRange parts",
      messageDigestAttr !== null && messageDigestAttr === expectedDigest);

    // 5) Signatur mit dem Zertifikat prüfen (RSASSA-PKCS1-v1_5 über DER(SET der Attribute))
    const attrSet = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, authAttrs);
    const attrMd = forge.md.sha256.create();
    attrMd.update(forge.asn1.toDer(attrSet).getBytes());
    const p7Cert: forge.pki.Certificate | undefined = p7.certificates?.[0];
    check("pdf_sign CMS embeds the certificate", !!p7Cert
      && p7Cert.subject.getField("CN")?.value === "Pagebound Smoke");
    let sigVerified = false;
    try {
      sigVerified = !!p7Cert && (p7Cert.publicKey as forge.pki.rsa.PublicKey)
        .verify(attrMd.digest().getBytes(), p7.rawCapture.signature as string);
    } catch { sigVerified = false; }
    check("pdf_sign CMS signature verifies against certificate", sigVerified);

    // Fehlerpfade: bereits signierte PDF + falsches Passwort werden abgelehnt
    let rejectedSigned = false;
    try { await sign.signPdf(signed.bytes, p12Bytes, "smoke-pass"); }
    catch (e) { rejectedSigned = e instanceof pdf.ToolError && /bereits eine Signatur/.test(e.message); }
    check("pdf_sign rejects already-signed PDF", rejectedSigned);
    let rejectedPassword = false;
    try { await sign.signPdf(await makeSample(1, "Sig2"), p12Bytes, "falsch"); }
    catch (e) { rejectedPassword = e instanceof pdf.ToolError && /Passwort/.test(e.message); }
    check("pdf_sign rejects wrong P12 password", rejectedPassword);
  }

  // --- Designer-Tools ---------------------------------------------------------
  const cat = design.catalog();
  check("design_catalog lists 6 themes", cat.themes.length === 6, String(cat.themes.length));
  check("design_catalog lists 7 layouts", cat.layouts.length === 7, String(cat.layouts.length));
  check("design_catalog lists >= 10 designs", cat.designs.length >= 10, String(cat.designs.length));

  const created = design.createDesign("party-flyer-dunkel", { title: "Smoke-Party", layout: "DinLong" });
  check("design_create applies overrides", created.title === "Smoke-Party" && created.layout === "DinLong" && created.theme?.name === "Dunkel");
  check("design_create uses PascalCase block types", created.pages[0].blocks.every((b) => /^[A-Z]/.test(b.type)));

  const roundtrip = design.validateDesign(JSON.stringify(created));
  check("design_validate roundtrip is clean", roundtrip.issues.length === 0, JSON.stringify(roundtrip.issues));

  const hostile = design.validateDesign(JSON.stringify({
    title: "Böse",
    layout: "Quark",
    pages: [{
      background: "url(javascript:1)",
      backgroundImage: "https://evil/bg.png",
      blocks: [
        { type: "paragraph", text: "<b>ok</b><script>alert(1)</script>", align: "diagonal" },
        { type: "Image", src: "https://evil/x.png", widthPercent: 999 },
        { type: "Raumschiff" },
      ],
    }],
    theme: { name: "X", headingFont: "comic", headingColor: "red", bodyColor: "#111827", accentColor: "#abc", bodyFont: "georgia" },
  }));
  const hostileDoc = hostile.doc;
  check("design_validate fixes layout+align+colors", hostileDoc.layout === "A4Portrait" && hostileDoc.pages[0].blocks[0].align === "left" && hostileDoc.pages[0].background === "#ffffff",
    JSON.stringify({ layout: hostileDoc.layout, align: hostileDoc.pages[0].blocks[0].align, bg: hostileDoc.pages[0].background }));
  check("design_validate strips script html", !(hostileDoc.pages[0].blocks[0].text ?? "").includes("script"), hostileDoc.pages[0].blocks[0].text ?? "");
  check("design_validate drops non-data image src", hostileDoc.pages[0].blocks[1].src === undefined && hostileDoc.pages[0].blocks[1].widthPercent === 100);
  check("design_validate removes unknown block type", hostileDoc.pages[0].blocks.length === 2, String(hostileDoc.pages[0].blocks.length));
  check("design_validate sanitizes theme", hostileDoc.theme?.headingFont === "georgia" && hostileDoc.theme?.headingColor === "#111827" && hostileDoc.theme?.accentColor === "#abc");
  check("design_validate reports issues", hostile.issues.length >= 4, JSON.stringify(hostile.issues));

  const extended = design.validateDesign(JSON.stringify({
    title: "Erweitert", layout: "A4Portrait",
    pages: [{
      blocks: [
        { type: "Columns", columnsHtml: ["<b>links</b>", "rechts", "c3", "c4", "c5-zuviel"], columnGapPx: 999 },
        { type: "QrCode", src: "data:image/png;base64,AAA", widthPercent: 30 },
        { type: "Image", src: "data:image/png;base64,AAA", cornerRadiusPx: 99, borderWidthPx: 5, borderColor: "#ff0000", shadowEnabled: true },
      ],
      overlays: [
        { type: "text", text: "Hi<script>x</script>", xPercent: 500, rotationDeg: 9999 },
        { type: "Shape", shape: "ellipse", color: "#f59e0b" },
        { type: "Raumschiff" },
      ],
    }],
  }));
  const extDoc = extended.doc;
  check("design_validate clamps columns+gap", extDoc.pages[0].blocks[0].columnsHtml!.length === 4 && extDoc.pages[0].blocks[0].columnGapPx === 64);
  check("design_validate clamps overlay geometry + strips html", extDoc.pages[0].overlays!.length === 2
    && extDoc.pages[0].overlays![0].xPercent === 98 && extDoc.pages[0].overlays![0].rotationDeg === 180
    && !(extDoc.pages[0].overlays![0].text ?? "").includes("script"));
  const extHtml = design.renderHtml(extDoc);
  check("design_render_html renders cols+qr+overlays", extHtml.includes("pb-cols") && extHtml.includes("pb-overlay") && extHtml.includes("is-ellipse") && extHtml.includes("border-radius:48px"));

  const html = design.renderHtml(roundtrip.doc);
  check("design_render_html contains @page size", html.includes("@page{size:105mm 210mm"), html.slice(0, 120));
  check("design_render_html applies theme vars", html.includes("--doc-color-accent:#f59e0b"));
  check("design_render_html renders filled rect + pages", html.includes("is-filled") && html.split("pb-page\"").length - 1 === created.pages.length);
  check("design_render_html escapes title", design.renderHtml(design.validateDesign(JSON.stringify({ title: "<x>&", layout: "A4Portrait", pages: [{ blocks: [] }] })).doc).includes("<title>&lt;x&gt;&amp;</title>"));

  process.stdout.write(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write("smoke crashed: " + String(e) + "\n");
  process.exit(1);
});
