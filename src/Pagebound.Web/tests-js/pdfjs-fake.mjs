// Attrappe für pdfjs-dist in der Prüfung der Blob-URL-Buchführung
// (page-images.test.mjs). Sie ersetzt NICHT das echte PDF.js für Fragen nach
// Rendern oder Geometrie — dafür gibt es annots.test.mjs und geometry.test.mjs
// mit dem Legacy-Build. Hier geht es allein darum, dass die Brücke jede
// erzeugte URL wiederfindet und wieder loswird.
export const GlobalWorkerOptions = {};

export function getDocument() {
  const page = {
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  const doc = {
    numPages: 50,
    getPage: async () => page,
    getMetadata: async () => ({ info: {} }),
    loadingTask: { destroy: async () => {} },
  };
  const task = { promise: Promise.resolve(doc), destroy: async () => {} };
  doc.loadingTask = task;
  return task;
}

/** Die Brücke importiert TextLayer für die Textschicht; hier nicht benutzt. */
export class TextLayer {
  constructor() { /* leer */ }
  render() { return Promise.resolve(); }
}
