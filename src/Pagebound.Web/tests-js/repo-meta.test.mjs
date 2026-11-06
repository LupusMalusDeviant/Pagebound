// =============================================================================
// Repo-Metadaten für Sichtbarkeit (MCP-Registry, README) — damit sie nicht still
// auseinanderlaufen: server.json muss zur MCP-Paketversion, zum Image-Tag und zum
// Docker-Label passen; README-Links müssen auf existierende Dateien zeigen.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(join(repo, p), "utf8");

test("server.json passt zu mcp/package.json, Image-Tag und Docker-Label", () => {
  const server = JSON.parse(read("server.json"));
  const pkg = JSON.parse(read("mcp/package.json"));
  assert.equal(server.version, pkg.version, "server.json.version ≠ mcp/package.json.version");
  const oci = server.packages.find((p) => p.registryType === "oci");
  assert.equal(oci.identifier, `ghcr.io/lupusmalusdeviant/pagebound-mcp:${pkg.version}`);
  const label = /LABEL io\.modelcontextprotocol\.server\.name="([^"]+)"/.exec(read("mcp/Dockerfile"))?.[1];
  assert.equal(label, server.name, "Docker-Label ≠ server.json.name");
  assert.ok(server.description.length <= 100, `description ${server.description.length} > 100 Zeichen (Registry-Limit)`);
  assert.ok(server.remotes.some((r) => r.url === "https://pagebound.app.lupusmalus.dev/mcp"));
  assert.match(read(".github/workflows/publish-image.yml"), /steps\.mcpver\.outputs\.version/, "Versions-Tag fürs MCP-Image fehlt");
});

for (const file of ["README.md", "README.de.md"]) {
  test(`${file}: relative Links zeigen auf existierende Dateien`, () => {
    const md = read(file);
    const links = [...md.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
    assert.ok(links.length > 3, "keine relativen Links gefunden — Muster kaputt?");
    for (const l of links) assert.ok(existsSync(join(repo, l)), `toter Link: ${l}`);
  });
}

test("README.md und README.de.md verweisen aufeinander", () => {
  assert.match(read("README.md"), /\]\(README\.de\.md\)/);
  assert.match(read("README.de.md"), /\]\(README\.md\)/);
});
