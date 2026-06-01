// Smoke test for the PDF operations (run after `npm run build`: `node dist/smoke.js`).
// Generates sample files in a temp dir and exercises every operation end-to-end.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pdf from "./pdf.js";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures++;
    process.stdout.write(`  ✗ ${name} ${detail}\n`);
  }
}

async function makeSample(path: string, pageCount: number, label: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const p = doc.addPage([400, 600]);
    p.drawText(`${label} Seite ${i} Pagebound Test`, { x: 40, y: 540, size: 18, font, color: rgb(0, 0, 0) });
  }
  await writeFile(path, await doc.save());
}

// 1x1 transparent PNG
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "pagebound-mcp-"));
  const a = join(dir, "a.pdf");
  const b = join(dir, "b.pdf");
  await makeSample(a, 3, "A");
  await makeSample(b, 2, "B");
  const png = join(dir, "x.png");
  await writeFile(png, PNG_1x1);

  process.stdout.write("pagebound-pdf-mcp smoke\n");

  const info = await pdf.getInfo(a);
  check("pdf_info pageCount=3", info.pageCount === 3, JSON.stringify(info.pageCount));
  check("pdf_info size 400x600", info.pages[0].widthPt === 400 && info.pages[0].heightPt === 600);

  const merged = join(dir, "merged.pdf");
  const m = await pdf.merge([a, b], merged);
  check("pdf_merge 3+2=5", m.pageCount === 5, JSON.stringify(m.pageCount));

  const ext = join(dir, "ext.pdf");
  const e = await pdf.extractPages(a, "3,1", ext);
  check("pdf_extract_pages '3,1' → 2", e.pageCount === 2, JSON.stringify(e.pageCount));

  const del = join(dir, "del.pdf");
  const d = await pdf.deletePages(a, "2", del);
  check("pdf_delete_pages '2' → 2 left, 1 deleted", d.pageCount === 2 && d.deleted === 1);

  const rot = join(dir, "rot.pdf");
  const r = await pdf.rotatePages(a, "1-2", 90, rot);
  check("pdf_rotate_pages '1-2' 90° → rotated 2", r.rotated === 2);

  const reo = join(dir, "reo.pdf");
  const ro = await pdf.reorderPages(a, [3, 2, 1], reo);
  check("pdf_reorder_pages [3,2,1] → 3", ro.pageCount === 3);

  const img = join(dir, "img.pdf");
  const ip = await pdf.imagesToPdf([png, png], img, "a4");
  check("images_to_pdf 2 PNG → 2 pages", ip.pageCount === 2);

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

  process.stdout.write(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write("smoke crashed: " + String(e) + "\n");
  process.exit(1);
});
