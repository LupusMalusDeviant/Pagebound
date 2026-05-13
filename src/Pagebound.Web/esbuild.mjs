// =============================================================================
// Pagebound — esbuild build for JavaScript-interop modules
// ----------------------------------------------------------------------------
// Bundles TypeScript bridges (pdfjs-bridge, ...) for use from Blazor WASM via
// IJSRuntime, and copies the pdf.worker file into wwwroot/js/ so PDF.js can
// reach it at the same origin.
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
  globalName: "pageboundPdf",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  minify: !watch,
  logLevel: "info"
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    ...sharedOptions,
    entryPoints: [resolve(__dirname, "wwwroot/js/pdfjs-bridge.ts")],
    outfile: resolve(__dirname, "wwwroot/js/pdfjs-bridge.js")
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
