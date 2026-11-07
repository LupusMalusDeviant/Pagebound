// =============================================================================
// Web-Manifest (wwwroot/manifest.webmanifest) — die Grundlage für die App-Stores
// (docs/distribution/app-stores.md). Microsoft Store und Google Play lesen Name,
// Icons und Screenshots daraus; ein maskierbares Icon verhindert, dass Android
// das Logo in den runden Rahmen falsch zuschneidet.
//
// Geprüft wird hier, was eine Datei im Repo belegen kann: dass jede referenzierte
// Datei existiert, dass die angegebenen Maße zu den echten Bildern passen und
// dass nichts von einer fremden Origin kommt. Dass sie auch AUSGELIEFERT werden,
// prüft infra/docker/smoke.sh am laufenden Abbild — genau dort fehlten schon
// einmal Dateien, die im Repo lagen (boot.js, c4b7bfb).
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wwwroot = resolve(here, "..", "wwwroot");
const manifest = JSON.parse(readFileSync(join(wwwroot, "manifest.webmanifest"), "utf8"));

/** Maße aus dem PNG-Kopf (IHDR): Breite und Höhe stehen als 32-Bit-Werte ab Byte 16. */
function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.subarray(1, 4).toString("latin1"), "PNG", `${path}: kein PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

const assets = [
  ...manifest.icons.map((i) => ({ ...i, kind: "icon" })),
  ...(manifest.screenshots ?? []).map((s) => ({ ...s, kind: "screenshot" })),
];

test("Manifest: jede referenzierte Datei liegt im wwwroot", () => {
  assert.ok(assets.length >= 3, "zu wenige Icons/Screenshots im Manifest");
  for (const a of assets) {
    assert.ok(!/^https?:|^\/\//.test(a.src), `${a.src}: externe Origin — die Datenschutzzusage verlangt self-hosted`);
    assert.ok(existsSync(join(wwwroot, a.src)), `${a.src} (${a.kind}) fehlt im wwwroot`);
  }
});

test("Manifest: die angegebenen Maße stimmen mit den Bildern überein", () => {
  for (const a of assets) {
    assert.equal(pngSize(join(wwwroot, a.src)), a.sizes, `${a.src}: sizes im Manifest passt nicht zum Bild`);
  }
});

test("Manifest: ein maskierbares Icon ist vorhanden und mindestens 512 px groß", () => {
  // Ohne purpose "maskable" schneidet Android das normale Icon in die Maske —
  // beim aktuellen Logo wäre der Schriftzug „Pagebound" angeschnitten.
  const maskable = manifest.icons.filter((i) => (i.purpose ?? "").split(/\s+/).includes("maskable"));
  assert.equal(maskable.length, 1, "genau ein maskierbares Icon erwartet");
  const [w, h] = maskable[0].sizes.split("x").map(Number);
  assert.ok(w >= 512 && h >= 512, `maskierbares Icon ist ${maskable[0].sizes}, erwartet mindestens 512x512`);
});

test("Manifest: Store-Pflichtfelder sind gesetzt", () => {
  for (const key of ["name", "short_name", "description", "lang", "dir", "id", "start_url", "display", "categories"]) {
    assert.ok(manifest[key], `${key} fehlt im Manifest`);
  }
  assert.ok(manifest.name.length <= 45, "name ist länger als 45 Zeichen (Play kürzt)");
  assert.ok(manifest.short_name.length <= 12, "short_name ist länger als 12 Zeichen (Startbildschirm kürzt)");
  assert.ok(!/Pagebound\.Web/.test(manifest.name + manifest.short_name), "Projektvorlagen-Name steht noch im Manifest");
});

test("Manifest: je ein Screenshot für breite und schmale Darstellung", () => {
  // Der Installationsdialog von Play und MS Store zeigt sie; fehlt die schmale
  // Variante, zeigt Play gar keine.
  const forms = (manifest.screenshots ?? []).map((s) => s.form_factor);
  for (const f of ["wide", "narrow"]) assert.ok(forms.includes(f), `kein Screenshot mit form_factor "${f}"`);
  for (const s of manifest.screenshots ?? []) assert.ok(s.label, `${s.src}: label fehlt`);
});
