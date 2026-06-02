// Smoke test for the PDF operations (run after `npm run build`: `node dist/smoke.js`).
// Bytes-in/bytes-out — no temp files; exercises every operation end-to-end.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdf from "./pdf.js";
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
    await okDoc.destroy();
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

  process.stdout.write(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write("smoke crashed: " + String(e) + "\n");
  process.exit(1);
});
