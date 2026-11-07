// =============================================================================
// Aufgaben-Landingpages (wwwroot/<slug>/index.html, erzeugt von
// tools/gen-landing.mjs). Sie liegen außerhalb dessen, was tools/privacy-check.mjs
// scannt (index.html, *.razor, *.ts) — deshalb prüft dieser Test für sie das
// Kernversprechen selbst: keine Ressource von einer fremden Origin.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const wwwroot = join(webRoot, "wwwroot");
const ORIGIN = "https://pagebound.app.lupusmalus.dev";

// DE unter /pdf-…/, EN unter /en/…/ (tools/gen-landing.mjs). slug = Pfad ohne Schrägstriche.
const enDir = join(wwwroot, "en");
const load = (slug) => ({ slug, lang: slug.startsWith("en/") ? "en" : "de", html: readFileSync(join(wwwroot, slug, "index.html"), "utf8") });

// Infoseiten: dieselbe Hülle, aber kein Werkzeug — also kein CTA und keine
// Schritte. Pflicht für Google Play und den Microsoft Store
// (docs/distribution/app-stores.md), darum hier namentlich erwartet und nicht
// aus dem Verzeichnis geraten: verschwindet eine, wird der Test rot.
const INFO_SLUGS = ["datenschutz", "en/privacy"];
const infoPages = INFO_SLUGS.map(load);

const pages = [
  ...readdirSync(wwwroot).filter((d) => d.startsWith("pdf-") && statSync(join(wwwroot, d)).isDirectory()),
  ...(existsSync(enDir) ? readdirSync(enDir).filter((d) => statSync(join(enDir, d)).isDirectory()).map((d) => "en/" + d) : []),
].filter((slug) => !INFO_SLUGS.includes(slug)).map(load);

// Was für jede erzeugte Seite gilt, egal welcher Art.
const allPages = [...pages, ...infoPages];

// Routen der Blazor-App (@page "…") — CTA-Ziele müssen darauf zeigen.
function collectRoutes(dir, acc = new Set()) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (["bin", "obj", "node_modules", "wwwroot"].includes(name)) continue;
    if (statSync(full).isDirectory()) collectRoutes(full, acc);
    else if (name.endsWith(".razor")) {
      for (const m of readFileSync(full, "utf8").matchAll(/^\uFEFF?@page\s+"([^"{]+)"/gm)) acc.add(m[1]);
    }
  }
  return acc;
}
const routes = collectRoutes(webRoot);

test("es gibt Landingpages in beiden Sprachen", () => {
  assert.ok(pages.filter((p) => p.lang === "de").length >= 4, "zu wenige DE-Seiten");
  assert.equal(pages.filter((p) => p.lang === "en").length, pages.filter((p) => p.lang === "de").length, "nicht jede Seite hat ein EN-Gegenstück");
});

test("die Datenschutzseiten sind von jeder Landingpage aus erreichbar", () => {
  // Die Store-Einreichung nennt die URL; ein Besucher muss sie auch finden.
  for (const { slug, lang, html } of pages) {
    const want = lang === "de" ? "/datenschutz/" : "/en/privacy/";
    assert.ok(html.includes(`href="${want}"`), `${slug}: kein Link auf ${want}`);
  }
});

for (const { slug, lang, html } of allPages) {
  test(`${slug}: lädt nichts von fremden Origins`, () => {
    // Alles, was der Browser beim Anzeigen tatsächlich holt.
    const fetched = [
      ...html.matchAll(/<(?:script|img|iframe|source|audio|video|embed)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi),
      ...html.matchAll(/<link\b[^>]*\brel\s*=\s*["'](?:stylesheet|preload|prefetch|preconnect|dns-prefetch|icon|modulepreload|manifest)[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi),
      ...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["'](?:stylesheet|preload|prefetch|preconnect|dns-prefetch|icon|modulepreload|manifest)/gi),
      ...html.matchAll(/<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/gi),
      ...html.matchAll(/url\(\s*["']?([^"')]+)/gi),
    ].map((m) => m[1]);
    assert.ok(fetched.length > 0, "Prüfung sieht keine Ressourcen — Muster kaputt?");
    for (const u of fetched) {
      assert.ok(!/^(https?:)?\/\//i.test(u), `externe Ressource: ${u}`);
    }
    assert.ok(!/<script\b(?![^>]*type\s*=\s*["']application\/ld\+json["'])/i.test(html), "ausführbares <script> auf einer Landingpage");
  });

  test(`${slug}: Pflicht-Metadaten`, () => {
    assert.ok(html.includes(`<html lang="${lang}">`), "falsches lang-Attribut");
    assert.match(html, /<title>[^<]{20,}<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{60,}"/);
    assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}/${slug}/" />`), "canonical fehlt/falsch");
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(block[1]);
  });

  test(`${slug}: interne Links führen zu existierenden Seiten`, () => {
    // Jeder Link auf ein Verzeichnis dieser Seite, nicht nur die Werkzeugpfade:
    // so fällt auch eine fehlende Infoseite auf. "/" und "/reader?x" treffen
    // das Muster nicht (es verlangt einen Namen und einen Schrägstrich am Ende).
    for (const m of html.matchAll(/<a\b[^>]*href="(\/(?:en\/)?[a-z][a-z-]*\/)"/g)) {
      assert.ok(existsSync(join(wwwroot, m[1], "index.html")), `toter Link ${m[1]}`);
    }
  });

  test(`${slug}: hreflang-Paare sind gegenseitig und zeigen auf existierende Seiten`, () => {
    const alts = Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([a-z-]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));
    assert.deepEqual(Object.keys(alts).sort(), ["de", "en", "x-default"]);
    assert.equal(alts[lang], `${ORIGIN}/${slug}/`, "eigene Sprache muss auf sich selbst zeigen");
    for (const href of Object.values(alts)) {
      const path = href.replace(ORIGIN, "");
      assert.ok(existsSync(join(wwwroot, path, "index.html")), `Ziel fehlt: ${path}`);
      const other = readFileSync(join(wwwroot, path, "index.html"), "utf8");
      assert.ok(other.includes(`hreflang="${lang}" href="${ORIGIN}/${slug}/"`), `${path} verweist nicht zurück auf ${slug}`);
    }
  });

  test(`${slug}: Vorschaubild existiert und Karten sind vollständig`, () => {
    const img = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    assert.ok(img?.startsWith(ORIGIN + "/"), "og:image fehlt/nicht absolut");
    assert.ok(existsSync(join(wwwroot, img.replace(ORIGIN + "/", ""))), `Bild fehlt: ${img}`);
    for (const tag of ["twitter:card", "twitter:image", "og:title", "og:description", "og:url"])
      assert.ok(html.includes(`"${tag}"`), `${tag} fehlt`);
  });
}

// Nur die Werkzeugseiten führen zu einer Funktion der App; die Infoseiten nicht.
for (const { slug, html } of pages) {
  test(`${slug}: CTA zeigt auf eine echte App-Route`, () => {
    const cta = /<a class="cta" href="([^"]+)"/.exec(html);
    assert.ok(cta, "kein CTA");
    const path = cta[1].split("?")[0];
    assert.ok(routes.has(path), `CTA-Ziel ${path} ist keine @page-Route (${[...routes].join(", ")})`);
  });
}

test("index.html: canonical, Vorschaubild und Werkzeug-Links auf existierende Seiten", () => {
  const html = readFileSync(join(wwwroot, "index.html"), "utf8");
  assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}/" />`));
  const img = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(img && existsSync(join(wwwroot, img.replace(ORIGIN + "/", ""))), "og:image fehlt");
  const links = [...html.matchAll(/(?:href|data-en-href)="(\/(?:en\/)?[a-z-]+\/)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 8, `zu wenige Werkzeug-Links: ${links.length}`);
  for (const l of links) assert.ok(existsSync(join(wwwroot, l, "index.html")), `toter Link ${l}`);
});

test("llms.txt verlinkt nur existierende Seiten", () => {
  const txt = readFileSync(join(wwwroot, "llms.txt"), "utf8");
  assert.match(txt, /^# Pagebound/);
  for (const m of txt.matchAll(new RegExp(ORIGIN.replace(/\./g, "\\.") + "(\\/[a-z/-]*\\/)\\)", "g")))
    assert.ok(existsSync(join(wwwroot, m[1], "index.html")), `toter Link in llms.txt: ${m[1]}`);
});

test("sitemap.xml listet genau die Startseite, alle Landingpages und die Infoseiten", () => {
  const xml = readFileSync(join(wwwroot, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const expected = [`${ORIGIN}/`, ...allPages.map((p) => `${ORIGIN}/${p.slug}/`)].sort();
  assert.deepEqual(locs, expected);
  assert.match(readFileSync(join(wwwroot, "robots.txt"), "utf8"), new RegExp(`Sitemap: ${ORIGIN}/sitemap.xml`));
});
