// Stub für pdfjs-dist im Node-Testbundle der Bridge (siehe geometry.test.mjs).
export const GlobalWorkerOptions = {};
export function getDocument() {
  throw new Error("pdfjs ist im Bridge-Test nicht verfügbar (Stub)");
}
