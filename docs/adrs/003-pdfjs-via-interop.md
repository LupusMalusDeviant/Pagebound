# ADR-003: PDF.js via JS-Interop für Rendering

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Pagebound braucht eine reife PDF-Render-Engine im Browser. Anforderungen:
- PDF 1.4 bis 2.0 inkl. verschlüsselt (FA-008).
- Text-Extraktion für Suche und Highlight (FA-005, FA-010).
- Outline-Anzeige (FA-006).
- Apache-2.0-kompatible Lizenz (NFA-041).
- Funktioniert in WebAssembly-Umgebung.

Im .NET-Ökosystem gibt es **keine** vollständige PDF-Render-Library, die in Blazor WASM nativ läuft. PdfSharpCore kann manipulieren, aber nicht rendern. PdfPig ist Read-Only. Native PDFium-Wrapper laufen nicht im Browser.

## Entscheidung

**PDF.js (Mozilla, Apache 2.0) wird via JavaScript-Interop eingebunden.**

Konkret:
- PDF.js liegt unter `src/Pagebound.Web/wwwroot/js/` als esbuild-gebündeltes Modul.
- Ein TypeScript-Bridge-Modul (`pdfjs-bridge.ts`) kapselt PDF.js-Aufrufe als simple, stabile API.
- Die C#-Implementation `PdfJsRenderer` ruft den Bridge über `IJSRuntime.InvokeAsync` auf.
- Aufrufer kennen nur `IPdfRenderer`, nicht `PdfJsRenderer`. Damit ist auch dieser Renderer austauschbar (ADR-001).

## Konsequenzen

**Positiv:**
- Industrie-Standard-Renderer (selbe Engine wie Firefox-PDF-Viewer).
- Aktive Wartung, breite PDF-Kompatibilität.
- Apache-2.0-Lizenz, voll kompatibel zu unserer eigenen Lizenz.
- Worker-fähig (separate `pdf.worker.min.js`) — UI bleibt responsiv.

**Negativ:**
- Doppel-Bundle: Blazor WASM + PDF.js zusammen sind nicht klein.
- Bridge-Schicht muss gepflegt werden (Versionsänderungen in PDF.js können Anpassungen erzwingen).
- JS-Interop hat Overhead pro Aufruf (ca. 1–2 ms); für viele kleine Aufrufe relevant.

**Mitigation:**
- Bridge-Methoden bündeln Mehrfach-Operationen serverseitig in JS, statt einzeln aus C# zu rufen.
- PDF.js wird per Version-Pinning festgenagelt; Upgrades laufen über separate PRs mit Tests.
- E2E-Tests verifizieren, dass das Bridge-Modul mit aktueller PDF.js-Version arbeitet.

## Alternativen erwogen

- **Eigener Renderer in C#**: massiv unterschätzte Komplexität (PDF-Spec hat tausende Seiten). Verworfen.
- **PdfSharpCore-eigenes Rendering**: existiert nicht für komplexe PDFs.
- **PDFium via WASM-Port**: existiert in Forschungs-Stadien, nicht produktionsreif.
- **Server-Side-Rendering**: widerspricht „kein Backend"-Anforderung (NFA-010).

## Referenz

- Lastenheft TEC-02, FA-001 bis FA-008
- Pflichtenheft Abschnitt 4.1 (`IPdfRenderer`), Abschnitt 6.1
