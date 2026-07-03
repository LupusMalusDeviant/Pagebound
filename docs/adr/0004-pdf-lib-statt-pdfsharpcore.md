# ADR-0004: pdf-lib/PDF.js statt PdfSharpCore für PDF-Operationen

- Status: **Akzeptiert**
- Bezug: `src/Pagebound.Web/Program.cs`, `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs`, [Blueprint: PDF-Werkzeuge](../blueprints/pdf-werkzeuge.md)

> Nachträglich dokumentiert (F-19) — hält die im Code bereits umgesetzte
> Entscheidung fest.

## Kontext

Für PDF-Manipulation (Zusammenführen, Splitten, Stempeln, Verschlüsseln,
Signaturen einbetten) stand zunächst das managed .NET-Paket **PdfSharpCore** zur
Wahl. Pagebound läuft aber als **Blazor WASM** im Browser-Sandbox.

Problem: PdfSharpCores Security-/Save-Pfad ruft intern `MD5.Create()` auf. MD5 ist
in der WASM-Krypto-Umgebung nicht verfügbar bzw. **crasht** dort. Zudem zieht
PdfSharpCore transitiv **ImageSharp** (inkl. dessen CVEs) mit.

## Entscheidung

Alle PDF-Operationen laufen über **pdf-lib** bzw. **PDF.js** via JS-Interop-Bridges
(`pdf-manipulator-bridge`, `pdfjs-bridge`). PdfSharpCore ist seit M1 vollständig
aus dem Code entfernt. Die Verschlüsselung (ISO 32000-2 /V5 /R6) läuft über einen
eigenen managed AES-Pfad, der **nur SHA-256/384/512 + AES** nutzt — **kein MD5**
(FA-027).

## Konsequenzen

- **+** Läuft zuverlässig in WASM; kein MD5-Crash.
- **+** Die transitive ImageSharp-Abhängigkeit (und deren CVEs) entfällt.
- **+** WebCrypto liefert hardware-beschleunigtes AES/SHA (managed AES fror den
  WASM-Thread ein).
- **−** PDF-Logik lebt teils in TypeScript-Bridges statt in typsicherem C#;
  Bündelung via esbuild nötig (`npm run build:js`).
- **−** Abhängigkeit von den JS-Bibliotheken pdf-lib/PDF.js (rein clientseitig,
  keine externen Requests — vgl. Produktversprechen „100 % lokal").
