// =============================================================================
// Pagebound — esbuild build for JavaScript-interop modules
// ----------------------------------------------------------------------------
// Bundles TypeScript bridges (pdfjs, shortcuts, ...) for use from Blazor WASM
// via IJSRuntime, and copies the pdf.worker file into wwwroot/js/ so PDF.js
// can reach it at the same origin.
//
// Each bridge becomes its own IIFE bundle with a distinct global name so the
// JS-Interop calls on the C# side stay namespaced (e.g. pageboundPdf.loadPdf,
// pageboundShortcuts.register).
// =============================================================================

import { build, context } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const sharedOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  minify: !watch,
  logLevel: "info"
};

/** @type {Array<import('esbuild').BuildOptions>} */
const builds = [
  {
    ...sharedOptions,
    globalName: "pageboundPdf",
    entryPoints: [resolve(__dirname, "wwwroot/js/pdfjs-bridge.ts")],
    outfile: resolve(__dirname, "wwwroot/js/pdfjs-bridge.js")
  },
  {
    ...sharedOptions,
    globalName: "pageboundShortcuts",
    entryPoints: [resolve(__dirname, "wwwroot/js/shortcuts-bridge.ts")],
    outfile: resolve(__dirname, "wwwroot/js/shortcuts-bridge.js")
  },
  {
    ...sharedOptions,
    globalName: "pageboundStorage",
    entryPoints: [resolve(__dirname, "wwwroot/js/storage-bridge.ts")],
    outfile: resolve(__dirname, "wwwroot/js/storage-bridge.js")
  }
];

await mkdir(resolve(__dirname, "wwwroot/js"), { recursive: true });
const workerSrc = resolve(__dirname, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const workerDst = resolve(__dirname, "wwwroot/js/pdf.worker.min.mjs");
await copyFile(workerSrc, workerDst);
console.log(`copied ${workerSrc} -> ${workerDst}`);

if (watch) {
  for (const opts of builds) {
    const ctx = await context(opts);
    await ctx.watch();
  }
  console.log("watching JS bridges ...");
} else {
  await Promise.all(builds.map((opts) => build(opts)));
  console.log("JS bridges built.");
}
