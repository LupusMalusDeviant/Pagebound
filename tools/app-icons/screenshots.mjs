#!/usr/bin/env node
// Erzeugt die Store-Screenshots (wwwroot/screenshots/*.png) aus der laufenden App.
//
// Ausführen (Repo-Wurzel), Standardziel ist die Live-Seite:
//   PLAYWRIGHT_MODULE=tests/Pagebound.E2ETests/bin/Release/net10.0/.playwright/package \
//   node tools/app-icons/screenshots.mjs [basis-url]
// Gegen das Auslieferungs-Abbild:  … screenshots.mjs http://localhost:5000
//
// Google Play und der Microsoft Store zeigen Screenshots im Installationsdialog;
// das Web-Manifest verweist mit form_factor "wide"/"narrow" darauf. Aufgenommen
// wird die echte App, nicht ein Entwurf — was hier zu sehen ist, bekommt der
// Nutzer auch.
//
// Keine Ausnahme von der Datenschutzzusage: das ist ein Entwickler-Werkzeug,
// kein ausgelieferter Code. Es laedt genau eine Seite — die eigene.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const www = resolve(root, "src/Pagebound.Web/wwwroot");
const out = resolve(www, "screenshots");
const base = (process.argv[2] || "https://pagebound.app.lupusmalus.dev").replace(/\/$/, "");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require(resolve(root, process.env.PLAYWRIGHT_MODULE || "playwright"))); }

// Breite Darstellung fuer Desktop-Stores, schmale fuer Play. Die Maße sind die
// von den Stores erwarteten Seitenverhaeltnisse (16:10 bzw. 9:19,5).
const SHOTS = [
  { file: "wide-start.png", width: 1280, height: 800, form: "wide", path: "/" },
  { file: "narrow-start.png", width: 390, height: 844, form: "narrow", path: "/" },
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const made = [];

for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    locale: "de-DE",
    isMobile: shot.form === "narrow",
    hasTouch: shot.form === "narrow",
  });
  const page = await context.newPage();
  const failed = [];
  page.on("requestfailed", (r) => failed.push(`${r.url()} (${r.failure()?.errorText})`));
  await page.goto(base + shot.path, { waitUntil: "load", timeout: 120_000 });
  // Auf die App warten, nicht auf einen Zeitwert: ohne das zeigt der Screenshot
  // je nach Netz den halb gestarteten Boot-Bildschirm.
  await page.locator("main h1").first().waitFor({ timeout: 120_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(1500);
  if (failed.length) throw new Error(`${shot.file}: Ressourcen fehlgeschlagen:\n  ${failed.join("\n  ")}`);
  writeFileSync(resolve(out, shot.file), await page.screenshot({ type: "png" }));
  made.push(`${shot.file} (${shot.width}x${shot.height} @2x, ${shot.form})`);
  await context.close();
}

await browser.close();
console.log("ok " + made.join("\n   "));
