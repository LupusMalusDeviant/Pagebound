#!/usr/bin/env node
// ============================================================================
// Pagebound Privacy-Guard (F-20)
// ----------------------------------------------------------------------------
// Automatischer Wächter für das zentrale Produktversprechen „100 % lokal,
// keine externen Requests, keine Telemetrie". Läuft rein OFFLINE (ruft selbst
// KEINE externen Dienste auf) und schlägt mit Exit-Code 1 fehl, wenn eine der
// folgenden Regeln verletzt ist:
//
//   1. Keine http(s)://-Referenzen auf FREMDE Hosts in index.html / *.razor /
//      *.ts (Allowlist unten: eigene Origin, XML-/PDF-Namespace-URIs, Repo-Link).
//   2. Kein <script src=…> / <link href=…> auf eine externe Origin in index.html.
//   3. Program.cs registriert weiterhin NoOpTelemetryService für ITelemetryService.
//   4. Keine unreviewten Laufzeit-Dependencies: jede Abweichung der package.json-
//      `dependencies` von der geprüften Baseline wird als Review-Hinweis gemeldet.
//
// Ausführen:  node tools/privacy-check.mjs
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // tools/ → Repo-Root
const rel = (p) => relative(ROOT, p).split(sep).join('/');

// --- Allowlists (bewusst explizit, siehe F-20) ------------------------------

// Hosts, die KEINE externen Requests darstellen: eigene Origin, XML-/PDF-/XMP-
// Namespace-URIs (reine Bezeichner, kein Netz-Zugriff) und der Projekt-Repo-Link.
const ALLOWED_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0',
  'www.w3.org',          // SVG-/XML-Namespaces (xmlns)
  'ns.adobe.com',        // XMP-Namespaces (PDF-Metadaten)
  'purl.org',            // Dublin-Core-Namespace (XMP)
  'www.aiim.org',        // PDF/A- & PDF/UA-Namespaces
  'www.color.org',       // ICC-Profil-RegistryName (PDF/A)
  'github.com',          // Projekt-Repo-Link + Quellen-Kommentare
]);

// Baseline der ERLAUBTEN Laufzeit-Dependencies. Wird eine neue hinzugefügt,
// meldet der Check das — nach Prüfung auf Phone-Home hier ergänzen.
const ALLOWED_DEPENDENCIES = new Set([
  '@fontsource-variable/hanken-grotesk',
  '@fontsource-variable/jetbrains-mono',
  '@fontsource-variable/newsreader',
  '@pdf-lib/fontkit',
  'd3-hierarchy', 'd3-selection', 'd3-shape', 'd3-transition', 'd3-zoom',
  'fflate', 'node-forge', 'pdf-lib', 'qrcode', 'tesseract.js',
]);

const problems = [];
const hints = [];

// --- Dateisammlung ----------------------------------------------------------

function walk(dir, exts, acc) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'bin' || name === 'obj' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, acc);
    else if (exts.some((e) => name.endsWith(e))) acc.push(full);
  }
}

const INDEX_HTML = join(ROOT, 'src/Pagebound.Web/wwwroot/index.html');
const scanFiles = [];
if (existsSync(INDEX_HTML)) scanFiles.push(INDEX_HTML);
walk(join(ROOT, 'src'), ['.razor', '.ts'], scanFiles);

// --- Check 1: fremde http(s)-Hosts -----------------------------------------

const URL_RE = /https?:\/\/([a-zA-Z0-9.\-_]+)/g;
for (const file of scanFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(URL_RE)) {
      const host = m[1].toLowerCase();
      if (!ALLOWED_HOSTS.has(host)) {
        problems.push(`[extern-host] ${rel(file)}:${i + 1} → ${m[0]} (Host „${host}" nicht in der Allowlist)`);
      }
    }
  });
}

// --- Check 2: externe <script src> / <link href> in index.html -------------

if (existsSync(INDEX_HTML)) {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const TAG_RE = /<(script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(TAG_RE)) {
    const url = m[2].trim();
    const ext = url.match(/^https?:\/\/([a-zA-Z0-9.\-_]+)/i);
    if (ext && !ALLOWED_HOSTS.has(ext[1].toLowerCase())) {
      problems.push(`[extern-asset] index.html → <${m[1]} …="${url}"> lädt von externer Origin`);
    }
  }
}

// --- Check 3: NoOpTelemetryService bleibt registriert ----------------------

const PROGRAM_CS = join(ROOT, 'src/Pagebound.Web/Program.cs');
if (!existsSync(PROGRAM_CS)) {
  problems.push('[telemetry] src/Pagebound.Web/Program.cs nicht gefunden.');
} else {
  const prog = readFileSync(PROGRAM_CS, 'utf8');
  // ITelemetryService MUSS auf NoOpTelemetryService gemappt bleiben.
  const registered = /ITelemetryService\s*,\s*NoOpTelemetryService/.test(prog);
  if (!registered) {
    problems.push('[telemetry] Program.cs registriert ITelemetryService NICHT (mehr) als NoOpTelemetryService.');
  }
}

// --- Check 4: Laufzeit-Dependencies gegen Baseline -------------------------

const PKG = join(ROOT, 'src/Pagebound.Web/package.json');
if (existsSync(PKG)) {
  const deps = Object.keys(JSON.parse(readFileSync(PKG, 'utf8')).dependencies ?? {});
  const added = deps.filter((d) => !ALLOWED_DEPENDENCIES.has(d));
  const removed = [...ALLOWED_DEPENDENCIES].filter((d) => !deps.includes(d));
  for (const d of added) {
    problems.push(`[dependency] Neue/unreviewte Laufzeit-Dependency „${d}" — auf Phone-Home prüfen und ggf. in ALLOWED_DEPENDENCIES aufnehmen.`);
  }
  for (const d of removed) {
    hints.push(`Laufzeit-Dependency „${d}" wurde entfernt (Baseline in tools/privacy-check.mjs aktualisieren).`);
  }
}

// --- Report -----------------------------------------------------------------

console.log(`Pagebound Privacy-Guard — ${scanFiles.length} Datei(en) geprüft.`);
for (const h of hints) console.log(`  Hinweis: ${h}`);

if (problems.length > 0) {
  console.error(`\n✖ ${problems.length} Verstoß/Verstöße gegen die Privacy-Regeln:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSiehe tools/privacy-check.mjs (Allowlists) für Details.');
  process.exit(1);
}

console.log('✓ Keine externen Requests, keine CDN-Assets, Telemetrie deaktiviert, Dependencies unverändert.');
process.exit(0);
