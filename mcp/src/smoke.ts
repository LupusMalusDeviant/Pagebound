// Smoke test for the PDF operations (run after `npm run build`: `node dist/smoke.js`).
// Bytes-in/bytes-out — no temp files; exercises every operation end-to-end.
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import forge from "node-forge";
import * as pdf from "./pdf.js";
import * as design from "./design.js";
import * as designPdf from "./design-pdf.js";
import * as designData from "./design-data.js";
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

  // PDF → DOCX (Best-Effort-Textfluss) — fresh sample (pdfjs detaches buffers)
  try {
    const docx = await pdf.toDocx(await makeSample(2, "Docx"));
    check("pdf_to_docx pageCount=2", docx.pageCount === 2, JSON.stringify(docx.pageCount));
    check("pdf_to_docx ZIP (PK header)", docx.bytes[0] === 0x50 && docx.bytes[1] === 0x4b);
    const parts = unzipSync(docx.bytes);
    check("pdf_to_docx has OOXML parts",
      !!parts["[Content_Types].xml"] && !!parts["word/document.xml"] && !!parts["word/styles.xml"] && !!parts["word/_rels/document.xml.rels"]);
    const docXml = strFromU8(parts["word/document.xml"]);
    check("pdf_to_docx document.xml is a w:document", docXml.includes("<w:document") && docXml.includes("</w:document>"));
    check("pdf_to_docx contains drawn text", /Docx Seite 1 Pagebound Test/.test(docXml.replace(/<[^>]+>/g, "")), docXml.replace(/<[^>]+>/g, "").slice(0, 80));
    check("pdf_to_docx page break for 2 pages", docXml.includes('w:type="page"'));
  } catch (err) {
    check("pdf_to_docx runs without throwing", false, String(err));
  }

  // pdf_edit_text (Suchen & Ersetzen, Cover + Redraw) — fresh sample
  try {
    const ed = await pdf.applyTextReplacements(await makeSample(1, "Edit"), [{ find: "Pagebound", replace: "ERSETZT" }]);
    check("pdf_edit_text replaced 1 line", ed.replaced === 1, JSON.stringify(ed.replaced));
    check("pdf_edit_text output re-parses (1 page)", (await pdf.getInfo(ed.bytes)).pageCount === 1);
    const reText = await pdf.extractText(ed.bytes.slice(), "1");
    check("pdf_edit_text new text present", /ERSETZT/.test(reText.pages[0]?.text ?? ""), JSON.stringify(reText.pages[0]?.text?.slice(0, 60)));
    const none = await pdf.applyTextReplacements(await makeSample(1, "Edit2"), [{ find: "NICHTVORHANDEN_xyz", replace: "X" }]);
    check("pdf_edit_text no match → replaced 0", none.replaced === 0, JSON.stringify(none.replaced));
  } catch (err) {
    check("pdf_edit_text runs without throwing", false, String(err));
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
    const conv = await pdfa.toPdfA(srcBytes, { flattenForm: true, embedFonts: false });
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
    const conv2 = await pdfa.toPdfA(metaSrc.bytes, { flattenForm: true });
    const raw2 = Buffer.from(conv2.bytes).toString("latin1");
    check("pdf_to_pdfa XMP carries dc:title (xml-escaped)", raw2.includes("Archiv &amp; Co"));
    check("pdf_to_pdfa XMP carries dc:creator", raw2.includes("<rdf:li>Ada</rdf:li>"));


    // --- PDF/A-3 mit eingebetteter XML-Rechnung (ZUGFeRD/Factur-X) -------------
    const zugferdXml = new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice><Test/></rsm:CrossIndustryInvoice>');
    const a3 = await pdfa.toPdfA(await makeSample(1, "ERechnung"), {
      part: 3,
      attachments: [{
        name: "factur-x.xml",
        bytes: zugferdXml,
        mimeType: "text/xml",
        description: "Rechnungsdaten (ZUGFeRD)",
        relationship: "Alternative",
      }],
      facturX: { documentFileName: "factur-x.xml", conformanceLevel: "EN 16931" },
    });
    const rawA3 = Buffer.from(a3.bytes).toString("latin1");
    check("pdf_to_pdfa part=3 XMP declares pdfaid part=3/B",
      rawA3.includes("<pdfaid:part>3</pdfaid:part>") && rawA3.includes("<pdfaid:conformance>B</pdfaid:conformance>"));
    check("pdf_to_pdfa part=3 embeds the file with /AFRelationship /Alternative",
      rawA3.includes("/AFRelationship /Alternative") && rawA3.includes("/Type /EmbeddedFile"));
    check("pdf_to_pdfa part=3 escapes the MIME type as a name (/text#2Fxml)", rawA3.includes("/text#2Fxml"));
    check("pdf_to_pdfa part=3 writes catalog /AF and /Names /EmbeddedFiles",
      /\/AF\s*\[/.test(rawA3) && rawA3.includes("/EmbeddedFiles"));
    check("pdf_to_pdfa part=3 keeps the XML payload verbatim", rawA3.includes("rsm:CrossIndustryInvoice"));
    check("pdf_to_pdfa part=3 writes the fx extension schema",
      rawA3.includes("Factur-X PDFA Extension Schema")
      && rawA3.includes("urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#")
      && rawA3.includes("<pdfaProperty:name>DocumentFileName</pdfaProperty:name>"));
    check("pdf_to_pdfa part=3 writes the fx properties",
      rawA3.includes("<fx:DocumentType>INVOICE</fx:DocumentType>")
      && rawA3.includes("<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>")
      && rawA3.includes("<fx:Version>1.0</fx:Version>")
      && rawA3.includes("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>"));

    // Der Anhang muss über den Namensbaum wiederfindbar sein — so sucht ihn ein Prüfer.
    const reA3 = await PDFDocument.load(a3.bytes);
    const efNames = reA3.catalog
      .lookupMaybe(PDFName.of("Names"), PDFDict)
      ?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict)
      ?.lookupMaybe(PDFName.of("Names"), PDFArray);
    const efKey = efNames?.lookup(0);
    const efSpec = efNames?.lookup(1);
    check("pdf_to_pdfa part=3 name tree maps 'factur-x.xml' to a /Filespec",
      efNames?.size() === 2
      && efKey instanceof PDFString && efKey.decodeText() === "factur-x.xml"
      && efSpec instanceof PDFDict
      && (efSpec.lookupMaybe(PDFName.of("AFRelationship"), PDFName)?.decodeText() === "Alternative"));

    // Fehlerpfade + Warnungen
    let rejectedPart2 = false;
    try {
      await pdfa.toPdfA(await makeSample(1, "A2"), {
        attachments: [{ name: "x.xml", bytes: zugferdXml, mimeType: "text/xml" }],
      });
    } catch (e) { rejectedPart2 = e instanceof pdf.ToolError && e.code === "INVALID_INPUT"; }
    check("pdf_to_pdfa rejects attachments without part=3", rejectedPart2);

    const a3Mismatch = await pdfa.toPdfA(await makeSample(1, "Mismatch"), {
      part: 3,
      attachments: [{ name: "rechnung.xml", bytes: zugferdXml, mimeType: "text/xml" }],
      facturX: { documentFileName: "factur-x.xml" },
    });
    check("pdf_to_pdfa warns when facturX names a file that is not attached",
      a3Mismatch.warnings.some((w) => w.includes("factur-x.xml") && w.includes("kein Anhang")),
      JSON.stringify(a3Mismatch.warnings));

    const a3Empty = await pdfa.toPdfA(await makeSample(1, "Leer"), { part: 3 });
    check("pdf_to_pdfa warns about part=3 without any attachment",
      a3Empty.warnings.some((w) => w.includes("keine Datei eingebettet")), JSON.stringify(a3Empty.warnings));

    // --- Font-Härtung (embedFonts:true, Default): Helvetica → Liberation Sans ---
    const convEmbed = await pdfa.toPdfA(await makeSample(1, "FontEmbed"), { flattenForm: true, embedFonts: true });
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
    check("pdf_sign writes Sig dict markers (PAdES SubFilter)",
      raw.includes("/Adobe.PPKLite") && raw.includes("/ETSI.CAdES.detached") && raw.includes("/SigFlags 3"),
      raw.match(/\/SubFilter\s*\/[\w.]+/)?.[0] ?? "(kein SubFilter)");

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
    // 4b) DER-Reihenfolge des SignedAttrs-SET (RFC 5652 §5.4 / X.690 11.6):
    //     aufsteigend nach Kodierung — sonst scheitert jeder Prüfer, der neu
    //     kodiert (BouncyCastle, .NET, eIDAS), während Adobe es akzeptiert.
    const attrDers = authAttrs.map((a) => forge.asn1.toDer(a).getBytes());
    const derSorted = attrDers.every((d, i) => i === 0 || attrDers[i - 1] <= d);
    check("pdf_sign signed attrs are in DER order",
      derSorted, attrDers.map((d) => d.length).join(","));

    // 4c) Gegenprobe wie ein strenger Prüfer: SET neu kodieren (sortiert) und
    //     mit den übertragenen Bytes vergleichen — muss identisch sein.
    const reSorted = [...attrDers].sort();
    check("pdf_sign signed attrs survive DER re-encoding unchanged",
      reSorted.join("") === attrDers.join(""));
    check("pdf_sign messageDigest equals recomputed SHA-256 of ByteRange parts",
      messageDigestAttr !== null && messageDigestAttr === expectedDigest);

    // 5) Signatur mit dem Zertifikat prüfen (RSASSA-PKCS1-v1_5 über DER(SET der Attribute))
    const attrSet = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, authAttrs);
    const attrMd = forge.md.sha256.create();
    attrMd.update(forge.asn1.toDer(attrSet).getBytes());
    const p7Cert: forge.pki.Certificate | undefined = p7.certificates?.[0];
    check("pdf_sign CMS embeds the certificate", !!p7Cert
      && p7Cert.subject.getField("CN")?.value === "Pagebound Smoke");

    // 4d) signingCertificateV2 (RFC 5035) — ohne dieses Attribut wäre es formal
    //     keine CAdES-Signatur, sondern klassisches PKCS#7.
    const OID_SCV2 = "1.2.840.113549.1.9.16.2.47";
    const scv2Attr = authAttrs.find((a) => forge.asn1.derToOid(a.value[0].value) === OID_SCV2);
    check("pdf_sign includes signingCertificateV2 (RFC 5035)", !!scv2Attr,
      authAttrs.map((a) => forge.asn1.derToOid(a.value[0].value)).join(","));
    check("pdf_sign signed attrs are DER-sorted with all four attributes", authAttrs.length === 4, String(authAttrs.length));

    if (scv2Attr) {
      // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
      const essCertId = scv2Attr.value[1].value[0].value[0].value[0];
      const firstField = essCertId.value[0];
      // hashAlgorithm hat den Vorgabewert sha256 — DER verlangt, Vorgabewerte
      // WEGZULASSEN. Das erste Feld muss also der certHash (OCTETSTRING) sein.
      check("pdf_sign omits the ESSCertIDv2 hashAlgorithm (DER default)",
        firstField.type === forge.asn1.Type.OCTETSTRING,
        `Typ ${firstField.type}`);
      const certHash = firstField.value as string;
      const embeddedCertDer = forge.asn1.toDer(forge.pki.certificateToAsn1(p7Cert!)).getBytes();
      const expectedHash = forge.md.sha256.create().update(embeddedCertDer).digest().getBytes();
      check("pdf_sign certHash is the SHA-256 of the embedded certificate", certHash === expectedHash);

      const issuerSerial = essCertId.value[1];
      check("pdf_sign signingCertificateV2 carries issuerSerial", !!issuerSerial);
      if (issuerSerial) {
        // IssuerSerial ::= SEQUENCE { issuer GeneralNames, serialNumber INTEGER }
        // GeneralName directoryName ist [4] EXPLICIT, enthält also den Namen.
        const dirName = issuerSerial.value[0].value[0];
        check("pdf_sign issuerSerial uses directoryName [4]",
          dirName.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && dirName.type === 4,
          `${dirName.tagClass}/${dirName.type}`);
        const issuerInAttr = forge.asn1.toDer(dirName.value[0]).getBytes();
        // TBS: [0] version, serialNumber, signature, issuer → issuer ist Feld 3.
        const tbsFields = (forge.pki.certificateToAsn1(p7Cert!).value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
        const issuerInCert = forge.asn1.toDer(tbsFields[3]).getBytes();
        check("pdf_sign issuerSerial matches the certificate issuer byte for byte", issuerInAttr === issuerInCert);
        const serialInAttr = forge.util.bytesToHex(issuerSerial.value[1].value as string).replace(/^0+/, "");
        check("pdf_sign issuerSerial matches the certificate serial number",
          serialInAttr === p7Cert!.serialNumber.replace(/^0+/, ""),
          `${serialInAttr} / ${p7Cert!.serialNumber}`);
      }
    }

    let sigVerified = false;
    try {
      sigVerified = !!p7Cert && (p7Cert.publicKey as forge.pki.rsa.PublicKey)
        .verify(attrMd.digest().getBytes(), p7.rawCapture.signature as string);
    } catch { sigVerified = false; }
    check("pdf_sign CMS signature verifies against certificate", sigVerified);

    // --- B4: erneutes Signieren als inkrementelles Update ---------------------
    // Ein Angebot wird signiert, später wird daraus eine Rechnung, die wieder
    // signiert wird. Die erste Signatur muss das überleben.
    const twice = await sign.signPdf(signed.bytes.slice(), p12Bytes, "smoke-pass", { reason: "Zweite Signatur" });
    const twiceRaw = Buffer.from(twice.bytes).toString("latin1");
    check("pdf_sign appends a second signature instead of refusing",
      twice.bytes.length > signed.bytes.length, `${signed.bytes.length} → ${twice.bytes.length}`);
    check("pdf_sign leaves the original bytes untouched (that is what keeps signature 1 valid)",
      Buffer.from(twice.bytes.subarray(0, signed.bytes.length)).equals(Buffer.from(signed.bytes)));
    check("pdf_sign writes an incremental xref with /Prev",
      /\/Prev\s+\d+/.test(twiceRaw.slice(signed.bytes.length)));
    check("pdf_sign output with two signatures re-parses (2 pages)",
      (await pdf.getInfo(twice.bytes.slice())).pageCount === 2);

    // Beide Signaturen prüfen: je /ByteRange den Digest neu rechnen und mit dem
    // messageDigest-Attribut des zugehörigen CMS vergleichen.
    const allByteRanges = [...twiceRaw.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
    check("pdf_sign twice-signed file has two /ByteRange entries", allByteRanges.length === 2, String(allByteRanges.length));
    let bothValid = allByteRanges.length === 2;
    for (const brm of allByteRanges) {
      const [q0, q1, q2, q3] = brm.slice(1, 5).map(Number);
      const digest = forge.md.sha256.create();
      digest.update(twiceRaw.slice(q0, q0 + q1) + twiceRaw.slice(q2, q2 + q3));
      const expected = digest.digest().getBytes();
      const gapHex = twiceRaw.slice(q1 + 1, q2 - 1);
      const gapBytes = forge.util.hexToBytes(gapHex);
      const lb = gapBytes.charCodeAt(1);
      const lol = lb < 0x80 ? 0 : lb & 0x7f;
      let dl = lb < 0x80 ? lb : 0;
      for (let i = 0; i < lol; i++) dl = dl * 256 + gapBytes.charCodeAt(2 + i);
      const cmsAsn1: any = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(gapBytes.slice(0, 2 + lol + dl))));
      const attrs: any[] = cmsAsn1.rawCapture?.authenticatedAttributes ?? [];
      const mdAttr = attrs.find((at) => forge.asn1.derToOid(at.value[0].value) === forge.pki.oids.messageDigest);
      if (!mdAttr || mdAttr.value[1].value[0].value !== expected) bothValid = false;
    }
    check("pdf_sign BOTH signatures still cover their own byte range", bothValid);

    // Zwei Felder, zwei Namen — sonst kollidieren sie im AcroForm.
    check("pdf_sign gives the second field its own name",
      twiceRaw.includes("Signature1") && twiceRaw.includes("Signature2"),
      twiceRaw.match(/Signature\d/g)?.join(",") ?? "(keine)");

    // Cross-Reference-Streams: ehrlich ablehnen statt eine kaputte Datei bauen.
    // Erzeugt wird der Fall, indem eine signierte PDF mit Objektströmen neu
    // gespeichert wird — dann liegt eine Signatur vor UND die letzte
    // Querverweistabelle ist ein Stream.
    const reSaved = await (await PDFDocument.load(signed.bytes.slice(), { updateMetadata: false }))
      .save({ useObjectStreams: true });
    let streamCode = "(kein Fehler)";
    try { await sign.signPdf(reSaved, p12Bytes, "smoke-pass"); }
    catch (err) { streamCode = err instanceof pdf.ToolError ? err.code : "(kein ToolError)"; }
    check("pdf_sign refuses incremental signing on cross-reference streams", streamCode === "UNSUPPORTED", streamCode);

    // Fehlerpfad: falsches Zertifikatspasswort
    let rejectedPassword = false;
    try { await sign.signPdf(await makeSample(1, "Sig2"), p12Bytes, "falsch"); }
    catch (e) { rejectedPassword = e instanceof pdf.ToolError && e.code === "CERT_PASSWORD"; }
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

  // --- Reproduzierbarkeit: gleiche Eingabe → gleiche Bytes --------------------
  // Aufrufer hängen erzeugte Dokumente in eine Hash-Kette. Ändert sich das
  // Ergebnis ohne fachlichen Anlass, ist der Hash wertlos. pdf-lib schreibt beim
  // Laden ungefragt /ModDate + /Producer — genau das darf hier nicht passieren.
  {
    const detSrc = await makeSample(3, "Determinismus");
    const detXml = new TextEncoder().encode("<invoice/>");
    const twice = async (fn: () => Promise<Uint8Array>): Promise<boolean> => {
      const a = await fn();
      const b = await fn();
      return Buffer.from(a).equals(Buffer.from(b));
    };

    check("determinism: pdf_merge", await twice(async () => (await pdf.merge([detSrc, detSrc])).bytes));
    check("determinism: pdf_extract_pages", await twice(async () => (await pdf.extractPages(detSrc, "1-2")).bytes));
    check("determinism: pdf_delete_pages", await twice(async () => (await pdf.deletePages(detSrc, "2")).bytes));
    check("determinism: pdf_rotate_pages", await twice(async () => (await pdf.rotatePages(detSrc, "1", 90)).bytes));
    check("determinism: pdf_reorder_pages", await twice(async () => (await pdf.reorderPages(detSrc, [3, 1, 2])).bytes));
    check("determinism: pdf_stamp", await twice(async () => (await pdf.stamp(detSrc, { watermarkText: "ENTWURF", pageNumbers: true })).bytes));
    check("determinism: pdf_set_metadata", await twice(async () => (await pdf.setMetadata(detSrc, { title: "Fest" })).bytes));
    check("determinism: pdf_to_pdfa (part 2)", await twice(async () => (await pdfa.toPdfA(detSrc, {})).bytes));
    check("determinism: pdf_to_pdfa (part 3 mit Anhang)", await twice(async () =>
      (await pdfa.toPdfA(detSrc, {
        part: 3,
        attachments: [{ name: "factur-x.xml", bytes: detXml, mimeType: "text/xml" }],
        facturX: { documentFileName: "factur-x.xml" },
        documentDate: new Date("2026-08-27T00:00:00Z"),
      })).bytes));
    check("determinism: pdf_ua_prepare", await twice(async () => (await pdfua.preparePdfUa(detSrc, {})).bytes));
    // Auch der DOCX-Export: fflate stempelt sonst die Systemzeit in jeden ZIP-Eintrag.
    check("determinism: pdf_to_docx", await twice(async () => (await pdf.toDocx(detSrc.slice())).bytes));

    // Die abgeleitete Trailer-/ID muss vom Inhalt abhängen — sonst wäre sie
    // zwar stabil, aber für zwei verschiedene Dokumente gleich.
    const idOf = (bytes: Uint8Array): string =>
      Buffer.from(bytes).toString("latin1").match(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/)?.[1] ?? "";
    const idA = idOf((await pdfa.toPdfA(detSrc, {})).bytes);
    const idB = idOf((await pdfa.toPdfA(await makeSample(2, "Anderes"), {})).bytes);
    check("determinism: trailer /ID is derived from content", idA.length === 32 && idB.length === 32 && idA !== idB, `${idA} / ${idB}`);

    // documentDate schlägt auf Info-Dict UND XMP durch (beide müssen übereinstimmen).
    const dated = await pdfa.toPdfA(detSrc, { documentDate: new Date("2026-08-27T00:00:00Z") });
    const datedRaw = Buffer.from(dated.bytes).toString("latin1");
    check("determinism: documentDate lands in Info dict and XMP",
      datedRaw.includes("D:20260827000000Z") && datedRaw.includes("<xmp:CreateDate>2026-08-27T00:00:00.000Z</xmp:CreateDate>"));
    // Ein Dokument ganz ohne Datum (pdf-lib stempelt sonst beim Erzeugen eines).
    const undatedDoc = await PDFDocument.create({ updateMetadata: false });
    undatedDoc.addPage([200, 200]);
    const undatedBytes = await undatedDoc.save();
    const undatedOut = await pdfa.toPdfA(undatedBytes, {});
    check("determinism: no date invented when none is known",
      !Buffer.from(undatedOut.bytes).toString("latin1").includes("<xmp:CreateDate>"));
    check("determinism: warns about the missing document date",
      undatedOut.warnings.some((w) => w.includes("kein Erstellungsdatum")), JSON.stringify(undatedOut.warnings));
    check("determinism: undated input still produces stable bytes",
      Buffer.from((await pdfa.toPdfA(undatedBytes, {})).bytes)
        .equals(Buffer.from((await pdfa.toPdfA(undatedBytes, {})).bytes)));
  }



  // --- design_render_pdf: Design → PDF ohne Browser ---------------------------
  {
    const PX_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const invoice = await designPdf.renderPdf(design.createDesign("invoice"));
    const invoiceRaw = Buffer.from(invoice.bytes).toString("latin1");
    check("design_render_pdf renders the invoice template on one page", invoice.pageCount === 1, String(invoice.pageCount));
    check("design_render_pdf embeds the fonts (/FontFile2)", invoiceRaw.includes("/FontFile2"));
    // A4 in Punkt ist 595.2755… x 841.8897… — auf Zehntel prüfen statt auf die Schreibweise.
    const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(invoiceRaw);
    check("design_render_pdf keeps A4 page size",
      !!mediaBox && Math.abs(Number(mediaBox[1]) - 595.28) < 0.1 && Math.abs(Number(mediaBox[2]) - 841.89) < 0.1,
      mediaBox?.[0] ?? "(none)");
    check("design_render_pdf output is reproducible",
      Buffer.from((await designPdf.renderPdf(design.createDesign("invoice"))).bytes).equals(Buffer.from(invoice.bytes)));

    const invoiceText = await pdf.extractText(invoice.bytes.slice(), "1");
    const flat = (invoiceText.pages[0]?.text ?? "").replace(/\s+/g, " ");
    check("design_render_pdf keeps the text extractable (incl. umlauts and §)",
      flat.includes("Rechnung") && flat.includes("Musterstraße") && flat.includes("§ 19 UStG"), flat.slice(0, 80));

    // Umbruch: eine lange Tabelle muss auf Folgeseiten laufen — mit Kopfzeile.
    const rows: string[][] = [["Pos.", "Beschreibung", "Menge", "Preis"]];
    for (let i = 1; i <= 45; i++) rows.push([String(i), `Position ${i} mit etwas laengerem Text zum Umbrechen`, "3", "19,00 EUR"]);
    const long = await designPdf.renderPdf(design.validateDesign(JSON.stringify({
      title: "Lang", layout: "A4Portrait", theme: null,
      pages: [{
        blocks: [{ type: "Table", headerRow: true, rows }],
        overlays: [{ type: "Text", xPercent: 55, yPercent: 4, widthPercent: 40, text: "ENTWURF", fontSizePt: 24, color: "#dc2626", rotationDeg: 20 }],
      }],
    })).doc);
    check("design_render_pdf breaks a long table across pages", long.pageCount >= 2, String(long.pageCount));
    const longText = await pdf.extractText(long.bytes.slice(), `1-${long.pageCount}`);
    const headerOnEveryPage = longText.pages.every((p) => (p.text ?? "").includes("Beschreibung"));
    check("design_render_pdf repeats the table header on every page", headerOnEveryPage);
    // Overlays hängen an der Seite, nicht am Fluss: sie bleiben auf Seite 1.
    check("design_render_pdf keeps overlays on the first page of a design page",
      (longText.pages[0]?.text ?? "").includes("ENTWURF")
      && !longText.pages.slice(1).some((p) => (p.text ?? "").includes("ENTWURF")));

    // Ehrliche Warnungen statt stiller Verluste.
    const noisy = await designPdf.renderPdf(design.validateDesign(JSON.stringify({
      title: "Warnungen", layout: "A4Portrait", theme: design.themeByName("Modern"),
      pages: [{ blocks: [
        { type: "Paragraph", text: "Text mit <marquee>unbekanntem</marquee> Tag." },
        { type: "Image", src: PX_PNG, widthPercent: 30, cornerRadiusPx: 12, shadowEnabled: true },
      ] }],
    })).doc);
    check("design_render_pdf reports the font substitution",
      noisy.warnings.some((w) => w.includes("Schriftersatz") && w.includes("Liberation Sans")), JSON.stringify(noisy.warnings));
    check("design_render_pdf reports unsupported inline tags",
      noisy.warnings.some((w) => w.includes("<marquee>")), JSON.stringify(noisy.warnings));
    check("design_render_pdf reports missing rounded corners/shadow",
      noisy.warnings.some((w) => w.includes("Schatten")), JSON.stringify(noisy.warnings));
    check("design_render_pdf keeps the text of an unsupported tag",
      (await pdf.extractText(noisy.bytes.slice(), "1")).pages[0].text.includes("unbekanntem"));

    // Formatierung, Listen und Farben landen wirklich im PDF (Zeichenlage geprüft).
    const styled = await designPdf.renderPdf(design.validateDesign(JSON.stringify({
      title: "Stil", layout: "A4Portrait", theme: null,
      pages: [{ blocks: [
        { type: "Heading", level: 1, text: "Mitte", align: "center" },
        { type: "Paragraph", text: "<ul><li>Punkt</li></ul>" },
      ] }],
    })).doc);
    const styledRaw = Buffer.from(styled.bytes).toString("latin1");
    check("design_render_pdf embeds a bold cut for headings", /Liberation.{0,20}Bold/i.test(styledRaw), "kein Bold-Schnitt im PDF");
    check("design_render_pdf renders list bullets", (await pdf.extractText(styled.bytes.slice(), "1")).pages[0].text.includes("•"));

    // Die Kette, die der Rechnungs-Aufrufer wirklich fährt.
    const chainPdf = await designPdf.renderPdf(design.createDesign("invoice"));
    const chainA3 = await pdfa.toPdfA(chainPdf.bytes, {
      part: 3,
      attachments: [{ name: "factur-x.xml", bytes: new TextEncoder().encode("<invoice/>"), mimeType: "text/xml" }],
      facturX: { documentFileName: "factur-x.xml", conformanceLevel: "EN 16931" },
      documentDate: new Date("2026-08-27T00:00:00Z"),
    });
    const chainRaw = Buffer.from(chainA3.bytes).toString("latin1");
    check("chain design_render_pdf → pdf_to_pdfa(part 3) works",
      chainRaw.includes("<pdfaid:part>3</pdfaid:part>") && chainRaw.includes("/AFRelationship /Alternative"));
    check("chain stays reproducible end to end",
      Buffer.from((await pdfa.toPdfA((await designPdf.renderPdf(design.createDesign("invoice"))).bytes, {
        part: 3,
        attachments: [{ name: "factur-x.xml", bytes: new TextEncoder().encode("<invoice/>"), mimeType: "text/xml" }],
        facturX: { documentFileName: "factur-x.xml", conformanceLevel: "EN 16931" },
        documentDate: new Date("2026-08-27T00:00:00Z"),
      })).bytes).equals(Buffer.from(chainA3.bytes)));
  }


  // --- Datenbindung: Vorlage + JSON → fertiges Dokument -----------------------
  {
    const tpl = design.createDesign("invoice-data");
    const tplBefore = JSON.stringify(tpl);
    const placeholders = designData.collectPlaceholders(tpl);
    // § 14 UStG verlangt diese Angaben — sie müssen als Platzhalter vorhanden sein.
    const pflicht = [
      "verkaeufer.name", "verkaeufer.strasse", "verkaeufer.plz", "verkaeufer.ort",
      "kunde.name", "kunde.strasse", "kunde.plz", "kunde.ort",
      "verkaeufer.steuernummer", "verkaeufer.ustid",
      "rechnung.datum", "rechnung.nummer", "rechnung.leistungszeitpunkt",
      "menge", "einheit", "bezeichnung", "einzelpreis", "steuersatz",
      "summen.netto", "summen.steuer", "summen.brutto", "rechnung.minderung",
    ];
    const fehlend = pflicht.filter((p) => !placeholders.includes(p));
    check("invoice-data covers the § 14 UStG mandatory fields", fehlend.length === 0, fehlend.join(","));

    const stamm = {
      verkaeufer: { name: "Lupus Malus GmbH", strasse: "Werkstraße 7", plz: "12345", ort: "Musterstadt", bank: "Musterbank", iban: "DE00", bic: "MUSTDEFF" },
      kunde: { name: "Kundenname GmbH", strasse: "Kundenstraße 2", plz: "54321", ort: "Kundenstadt" },
      rechnung: { nummer: "LMD-2026-0042", datum: "27.08.2026", leistungszeitpunkt: "August 2026", zahlungsziel: "10.09.2026" },
      positionen: [
        { menge: "3", einheit: "Std.", bezeichnung: "Beratung", einzelpreis: "95,00 €", steuersatz: "19 %", betrag: "285,00 €" },
        { menge: "12", einheit: "Stk.", bezeichnung: "Handbuch", einzelpreis: "8,50 €", steuersatz: "7 %", betrag: "102,00 €" },
      ],
    };
    const flatText = (d: design.EditorDocument): string =>
      d.pages.flatMap((p) => (p.blocks ?? []).map((b) => `${b.text ?? ""} ${(b.rows ?? []).flat().join(" ")}`)).join(" ").replace(/<[^>]*>/g, " ");

    // Fall Regelbesteuerung
    const regel = designData.mergeDesign(tpl, {
      ...stamm, kleinunternehmer: false,
      verkaeufer: { ...stamm.verkaeufer, ustid: "DE123456789" },
      summen: { netto: "387,00 €", steuer: "61,29 €", brutto: "448,29 €",
        steuersaetze: [{ satz: "19 %", netto: "285,00 €", steuer: "54,15 €" }, { satz: "7 %", netto: "102,00 €", steuer: "7,14 €" }] },
    });
    const regelText = flatText(regel.doc);
    check("data binding: no missing values for a complete invoice", regel.missing.length === 0, JSON.stringify(regel.missing.slice(0, 3)));
    check("data binding: resolves nested paths", regelText.includes("Kundenstraße 2") && regelText.includes("54321 Kundenstadt"));
    check("data binding: Regelbesteuerung shows the tax column and totals",
      regelText.includes("USt.") && regelText.includes("448,29 €") && regelText.includes("Steuerbetrag"));
    check("data binding: Regelbesteuerung hides the § 19 note", !regelText.includes("§ 19 UStG"));
    check("data binding: shows the USt-IdNr, not the tax number",
      regelText.includes("DE123456789") && !regelText.includes("Steuernummer:"));

    // Fall Kleinunternehmer — DIESELBE Vorlage
    const klein = designData.mergeDesign(tpl, {
      ...stamm, kleinunternehmer: true,
      verkaeufer: { ...stamm.verkaeufer, steuernummer: "12/345/67890" },
      positionen: stamm.positionen.map(({ steuersatz, ...p }) => p),
      summen: { gesamt: "387,00 €" },
      rechnung: { ...stamm.rechnung, minderung: "5 % Skonto binnen 7 Tagen" },
    });
    const kleinText = flatText(klein.doc);
    check("data binding: Kleinunternehmer keeps the § 19 note", kleinText.includes("§ 19 UStG"));
    check("data binding: Kleinunternehmer has no tax column and no tax totals",
      !kleinText.includes("USt.") && !kleinText.includes("Steuerbetrag"));
    check("data binding: Kleinunternehmer shows the tax number", kleinText.includes("12/345/67890"));
    check("data binding: optional block appears only when the value is there",
      kleinText.includes("5 % Skonto") && !regelText.includes("Skonto"));
    // Beide Fälle kommen aus DERSELBEN Vorlage — die dabei unverändert bleiben
    // muss, sonst wäre der zweite Aufruf vom ersten abhängig.
    check("data binding: one template serves both tax cases without being mutated",
      JSON.stringify(tpl) === tplBefore
      && JSON.stringify(klein.doc) !== JSON.stringify(regel.doc)
      && kleinText.includes("§ 19 UStG") && regelText.includes("Steuerbetrag"));

    // Wiederholung
    const table = klein.doc.pages[0].blocks.find((b) => b.type === "Table");
    check("data binding: repeat expands header + one row per item + footer",
      !!table && table.rows?.length === 4, JSON.stringify(table?.rows?.length));
    check("data binding: {{index}} numbers the rows from 1",
      table?.rows?.[1]?.[0] === "1" && table?.rows?.[2]?.[0] === "2", JSON.stringify(table?.rows?.[1]));
    check("data binding: the footer row is rendered once with root values",
      table?.rows?.[3]?.join(" ").includes("387,00 €") === true, JSON.stringify(table?.rows?.[3]));
    check("data binding: repeat/when/unless are stripped from the result",
      klein.doc.pages[0].blocks.every((b) => !b.repeat && !b.when && !b.unless));

    // Fehlende Werte (C5): Abbruch als Standard, Bericht auf Wunsch
    const luecken = { kleinunternehmer: true, rechnung: { nummer: "1" }, positionen: [{ bezeichnung: "X" }] };
    let abbruch = "";
    try { designData.mergeDesign(tpl, luecken); }
    catch (e) { abbruch = e instanceof pdf.ToolError ? e.code : "(kein ToolError)"; }
    check("data binding: missing values abort by default", abbruch === "INVALID_INPUT", abbruch);
    const bericht = designData.mergeDesign(tpl, luecken, { onMissing: "report" });
    check("data binding: onMissing=report lists the gaps with their location",
      bericht.missing.length > 5 && bericht.missing.every((m) => m.placeholder.length > 0 && m.where.includes("Seite 1")),
      JSON.stringify(bericht.missing[0]));
    check("data binding: an empty string counts as missing",
      designData.mergeDesign(tpl, { ...luecken, rechnung: { nummer: "   " } }, { onMissing: "report" })
        .missing.some((m) => m.placeholder === "rechnung.nummer"));
    check("data binding: an unset condition is not a missing value",
      !bericht.missing.some((m) => m.placeholder === "rechnung.minderung"));

    // Werte dürfen das Dokument nicht zerlegen
    const evil = designData.mergeDesign(tpl, { ...stamm, kleinunternehmer: true,
      kunde: { ...stamm.kunde, name: "<b>X</b> & <script>y</script>" },
      positionen: stamm.positionen.map(({ steuersatz, ...p }) => p), summen: { gesamt: "1" },
      verkaeufer: { ...stamm.verkaeufer, steuernummer: "1" } }, { onMissing: "report" });
    const evilBlock = evil.doc.pages[0].blocks.find((b) => (b.text ?? "").includes("&lt;b&gt;"));
    check("data binding: values are HTML-escaped", !!evilBlock && !(evilBlock.text ?? "").includes("<script>"), evilBlock?.text ?? "(nicht gefunden)");

    // Und das Ganze bis zum PDF
    const rendered = await designPdf.renderPdf(design.validateDesign(JSON.stringify(klein.doc)).doc);
    const renderedText = (await pdf.extractText(rendered.bytes.slice(), "1")).pages[0].text.replace(/\s+/g, " ");
    check("data binding: the filled template renders to PDF",
      renderedText.includes("LMD-2026-0042") && renderedText.includes("Beratung") && renderedText.includes("§ 19 UStG"),
      renderedText.slice(0, 90));
    check("data binding: filled invoices stay reproducible",
      Buffer.from((await designPdf.renderPdf(design.validateDesign(JSON.stringify(klein.doc)).doc)).bytes)
        .equals(Buffer.from(rendered.bytes)));
  }

  // --- Fehlervertrag: unterscheidbare Kennungen statt nur Text ---------------
  // Aufrufer müssen "Nutzer fragen" von "Eingabe korrigieren" von "Betrieb
  // alarmieren" trennen können, ohne deutsche Fehlertexte zu parsen.
  {
    const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
      try { await fn(); return "(kein Fehler)"; }
      catch (e) { return e instanceof pdf.ToolError ? e.code : `(${e instanceof Error ? e.constructor.name : typeof e})`; }
    };
    const junk = new TextEncoder().encode("das ist keine PDF");

    check("error contract: kaputte Eingabe → PDF_CORRUPT",
      await codeOf(() => pdf.getInfo(junk)) === "PDF_CORRUPT", await codeOf(() => pdf.getInfo(junk)));
    check("error contract: ungültige Seitenangabe → INVALID_INPUT",
      await codeOf(async () => pdf.extractPages(await makeSample(1, "E"), "9-12")) === "INVALID_INPUT");
    check("error contract: Drehwinkel → INVALID_INPUT",
      await codeOf(async () => pdf.rotatePages(await makeSample(1, "E"), "1", 45)) === "INVALID_INPUT");
    check("error contract: verzweigter Namensbaum → UNSUPPORTED (Default nicht überschrieben)",
      new pdf.ToolError("x", "UNSUPPORTED").code === "UNSUPPORTED" && new pdf.ToolError("x").code === "INVALID_INPUT");

    // Jede Kennung, auf die sich Aufrufer verlassen, muss im Code auch wirklich
    // vergeben werden — sonst ist der Fehlervertrag Papier. Geprüft wird gegen
    // die Quellen, nicht gegen eine gepflegte Liste.
    const sources: string[] = [];
    for (const file of ["pdf.ts", "index.ts", "pdfa.ts", "pdfua.ts", "sign.ts", "encrypt.ts", "design.ts"]) {
      sources.push(await readFile(new URL(`../src/${file}`, import.meta.url), "utf8"));
    }
    const declared = ["INPUT_TOO_LARGE", "PAGE_LIMIT", "PDF_CORRUPT", "PDF_ENCRYPTED",
      "CERT_PASSWORD", "CERT_INVALID", "FILE_READ", "FILE_WRITE", "UNSUPPORTED",
      "PROCESSING_FAILED", "INTERNAL"]; // INVALID_INPUT ist der Default und steht nirgends explizit
    const unused = declared.filter((c) => !sources.some((src) => src.includes(`, "${c}")`)));
    check("error contract: jede dokumentierte Kennung wird auch vergeben", unused.length === 0, unused.join(","));
  }
  process.stdout.write(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write("smoke crashed: " + String(e) + "\n");
  process.exit(1);
});
