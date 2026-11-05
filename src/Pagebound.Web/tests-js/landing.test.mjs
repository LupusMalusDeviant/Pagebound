// =============================================================================
// Aufgaben-Landingpages (wwwroot/<slug>/index.html, erzeugt von
// tools/gen-landing.py). Sie liegen außerhalb dessen, was tools/privacy-check.mjs
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

const pages = readdirSync(wwwroot)
  .filter((d) => d.startsWith("pdf-") && statSync(join(wwwroot, d)).isDirectory())
  .map((slug) => ({ slug, html: readFileSync(join(wwwroot, slug, "index.html"), "utf8") }));

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

test("es gibt Landingpages", () => {
  assert.ok(pages.length >= 4, `nur ${pages.length} gefunden`);
});

for (const { slug, html } of pages) {
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
    assert.match(html, /<html lang="de">/);
    assert.match(html, /<title>[^<]{20,}<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{60,}"/);
    assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}/${slug}/" />`), "canonical fehlt/falsch");
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(block[1]);
  });

  test(`${slug}: CTA zeigt auf eine echte App-Route`, () => {
    const cta = /<a class="cta" href="([^"]+)"/.exec(html);
    assert.ok(cta, "kein CTA");
    const path = cta[1].split("?")[0];
    assert.ok(routes.has(path), `CTA-Ziel ${path} ist keine @page-Route (${[...routes].join(", ")})`);
  });

  test(`${slug}: interne Links führen zu existierenden Seiten`, () => {
    for (const m of html.matchAll(/<a\b[^>]*href="(\/pdf-[^"]*)"/g)) {
      assert.ok(existsSync(join(wwwroot, m[1], "index.html")), `toter Link ${m[1]}`);
    }
  });
}

test("sitemap.xml listet genau die Startseite und alle Landingpages", () => {
  const xml = readFileSync(join(wwwroot, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const expected = [`${ORIGIN}/`, ...pages.map((p) => `${ORIGIN}/${p.slug}/`)].sort();
  assert.deepEqual(locs, expected);
  assert.match(readFileSync(join(wwwroot, "robots.txt"), "utf8"), new RegExp(`Sitemap: ${ORIGIN}/sitemap.xml`));
});
