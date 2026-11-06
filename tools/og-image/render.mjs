// Erzeugt die Social-Preview-Bilder (1200×630) für Open Graph / Twitter / GitHub.
// Ausführen (Repo-Wurzel):  node tools/og-image/render.mjs
// Braucht Playwright (Chromium). Schriften und Logo kommen aus wwwroot — keine
// externen Requests; Ergebnis: wwwroot/og-image.png und wwwroot/og-image-en.png.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const www = resolve(root, "src/Pagebound.Web/wwwroot");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")); }

const b64 = (p) => readFileSync(resolve(www, p)).toString("base64");
const fonts = `
@font-face { font-family: "Newsreader"; font-weight: 200 800; src: url(data:font/woff2;base64,${b64("fonts/newsreader-latin-wght-normal.woff2")}) format("woff2"); }
@font-face { font-family: "Hanken Grotesk"; font-weight: 100 900; src: url(data:font/woff2;base64,${b64("fonts/hanken-grotesk-latin-wght-normal.woff2")}) format("woff2"); }`;
const logo = `data:image/png;base64,${b64("icon-512.png")}`;

const TEXT = {
  de: {
    title: "Pagebound",
    claim: "PDFs lesen, unterschreiben, schwärzen und bearbeiten —",
    claim2: "komplett im Browser, ohne Upload.",
    chips: ["100 % lokal", "Open Source", "Keine Telemetrie", "Offline-fähig"],
  },
  en: {
    title: "Pagebound",
    claim: "Read, sign, redact and edit PDFs —",
    claim2: "entirely in your browser, no upload.",
    chips: ["100 % local", "Open source", "No telemetry", "Works offline"],
  },
};

const html = (t) => `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts}
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: radial-gradient(1200px 630px at 85% 0%, #1d3b37 0%, #12110f 55%); color: #f2eee6;
  font-family: "Hanken Grotesk", sans-serif; display: flex; align-items: center; padding: 0 72px; gap: 56px; }
.logo { width: 260px; height: 260px; border-radius: 48px; background: #ffffff; display: grid; place-items: center; flex: none; box-shadow: 0 30px 80px rgba(0,0,0,.45); }
.logo img { width: 220px; height: 220px; }
h1 { font-family: "Newsreader", serif; font-weight: 500; font-size: 104px; letter-spacing: -0.02em; line-height: 1; }
p { margin-top: 26px; font-size: 30px; line-height: 1.3; color: #d8d1c5; }
.chips { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 34px; }
.chip { border: 2px solid #2dd4bf; color: #2dd4bf; border-radius: 999px; padding: 8px 18px; font-size: 22px; font-weight: 600; }
.url { position: absolute; right: 84px; bottom: 40px; font-size: 22px; color: #a39b8f; }
</style></head><body>
<div class="logo"><img src="${logo}" alt=""></div>
<div><h1>${t.title}</h1><p>${t.claim}<br>${t.claim2}</p>
<div class="chips">${t.chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div></div>
<div class="url">pagebound.app.lupusmalus.dev</div>
</body></html>`;

const browser = await chromium.launch(process.env.PAGEBOUND_CHROMIUM ? { executablePath: process.env.PAGEBOUND_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [lang, file] of [["de", "og-image.png"], ["en", "og-image-en.png"]]) {
  await page.setContent(html(TEXT[lang]), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(resolve(www, file), await page.screenshot({ type: "png" }));
  console.log("geschrieben:", file);
}
await browser.close();
