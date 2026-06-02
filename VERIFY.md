# Verifikations-Checkliste (vor dem Merge nach `main`)

Diese Branch-Änderungen wurden teils in einer Umgebung **ohne .NET-SDK/Browser**
erstellt. Die MCP-Seite (Node) ist dort automatisiert getestet; die Blazor-/Web-
Teile müssen lokal verifiziert werden. Diese Liste abhaken, dann ist der PR „grün".

## 1. Build & Tests (Pflicht)

```bash
# .NET — kompiliert v. a. den Multi-Page-Designer-Refactor + die neue /compare-Seite
dotnet build Pagebound.slnx -c Release
dotnet test  Pagebound.slnx --filter "FullyQualifiedName!~E2ETests"   # Unit-Tests

# Frontend-Assets
cd src/Pagebound.Web
npm ci && npm run build          # Tailwind + esbuild (alle Bridges)
npm run typecheck                # bekannte Vorbestands-Fehler in pdfjs/manipulator
                                 # sind ok; ocr-bridge & wysiwyg-editor müssen clean sein

# MCP-Server (in CI ohnehin grün)
cd ../../mcp
npm ci && npm run build && npm run smoke   # erwartet: ALL PASS (33 Checks)
```

- [ ] `dotnet build` ohne Fehler (besonders `EditorDocument`/`EditorPage`/`EditorTemplates`, `ComparePage.razor`, `Home.razor`).
- [ ] `dotnet test` grün.
- [ ] `npm run build` (Web) ohne esbuild-Fehler.
- [ ] `npm run smoke` (MCP) → `ALL PASS`.

## 2. WYSIWYG-Designer (`/editor`) — Multi-Page & Co.

- [ ] **Seiten:** hinzufügen / duplizieren / löschen / hoch-runter funktioniert; bei Layout „Folie 16:9" heißt der Button „+ Folie".
- [ ] **Flyer-Vorlage** erzeugt 2 Seiten (Vorder-/Rückseite); **Folien-Vorlage** 2 Folien.
- [ ] **Hintergrundbild** je Seite hochladen, cover/contain wirkt; Hintergrundfarbe zusätzlich.
- [ ] **Eigener Farbwähler** (Text + Hervorhebung): Auswahl bleibt erhalten, Farbe wird angewandt.
- [ ] **Abstand-Block** einfügen, Höhe per Schieberegler.
- [ ] **Export** PDF (alle Seiten je 1 Blatt), HTML (alle Seiten, je eigener Hintergrund, keine Werkzeug-Overlays), JSON.
- [ ] **Migration:** ein **vor** diesem Branch gespeicherter (einseitiger) Entwurf lädt korrekt als 1 Seite.

## 3. OCR — 100 % self-hosted (der „No-Telemetry"-Beweis)

- [ ] Reader öffnen → ein Scan/Designer-PDF ohne Text-Layer → **OCR** klicken.
- [ ] **Netzwerk-Tab (DevTools):** beim OCR **kein** externer Request (kein `cdn.jsdelivr.net`, kein `tessdata`-Host); nur `/tesseract/*` und `/tessdata/*` von **eigener Origin**.
- [ ] OCR erkennt Text (eng + deu).
- [ ] Offline-Test: Netzwerk trennen → OCR funktioniert weiterhin.
- [ ] (Optional) CSP-Header live prüfen: `connect-src 'self' data: blob:` (kein `https:`).

## 4. PDF-Vergleich (`/compare`, neu)

- [ ] Nav „Vergleich" unter „PDF" erscheint; Route lädt.
- [ ] Zwei Text-PDFs wählen → „Vergleichen": geänderte Seiten zeigen entfernte (rot) / hinzugefügte (grün) Wörter.
- [ ] Zwei identische PDFs → „keine Unterschiede".

## 5. Favicon / PWA

- [ ] Browser-Tab-Favicon = Pagebound-Logo (nicht das .NET-Blazor-Logo).
- [ ] PWA installieren → App-Icon (192/512) zeigt Pagebound-Branding.

## 6. Docker / Deploy (optional, empfohlen)

```bash
docker build -t pagebound-test .
docker run --rm -p 8080:80 pagebound-test
# → http://localhost:8080 öffnen, OCR testen (Network-Tab), CSP-Header prüfen
```

- [ ] `.wasm` wird als `application/wasm` ausgeliefert; `*.traineddata.gz` ohne doppeltes Gzip (Tesseract entpackt selbst).
- [ ] Nachbar-Sites/Deploy unverändert (Caddy-Block nur HSTS).

## 7. MCP (bereits automatisiert grün)

- [ ] `tools/list` liefert **16 Tools** (`node mcp/dist/index.js` Handshake).
- [ ] Neu seit Beta: `pdf_split`, `pdf_stamp`, `pdf_encrypt`, `pdf_form_fields`, `pdf_fill_form`, `pdf_diff`, `pdf_set_metadata`, `pdf_create_field`.
