// Worker-Shim für PDF.js (pdfjs-dist 5.7+).
// pdfjs nutzt Math.sumPrecise (sehr neues JS-API); ältere Browser/Engines kennen
// es nicht und der PDF.js-Worker crasht mit "Math.sumPrecise is not a function".
// Wir polyfillen es im Worker-Scope, bevor der echte Worker geladen wird.
if (typeof Math.sumPrecise !== "function") {
  // einfache Summe; für PDF.js' Verwendung (ganzzahlige Offsets/Counts) ausreichend.
  Math.sumPrecise = (iterable) => {
    let sum = 0;
    for (const x of iterable) sum += x;
    return sum;
  };
}
await import("./pdf.worker.min.mjs");
