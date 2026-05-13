# ADR-002: Blazor WebAssembly als Frontend-Framework

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Pagebound ist als Progressive Web App geplant (FA-001 ff., NFA-010). Plattformweit soll später Desktop und Mobile via .NET MAUI Blazor Hybrid bedient werden. Der Auftraggeber bringt C#-/.NET-Erfahrung mit und bevorzugt diesen Stack ausdrücklich.

## Entscheidung

**Frontend: Blazor WebAssembly auf .NET 10.**

Begleitend:
- TypeScript wird nur für notwendige JS-Interop-Module verwendet (`wwwroot/js/*.ts`), nicht für UI.
- C# bleibt die Hauptsprache für UI-Logik, Domain, Services.
- Späterer Wechsel auf .NET MAUI Blazor Hybrid wird durch saubere Interface-First-Schnitte vorbereitet.

## Konsequenzen

**Positiv:**
- Eine Sprache (C#) über Web und spätere Native-Targets.
- Hochwertiges Tooling (Visual Studio, Rider).
- Dependency Injection out-of-the-box.
- Spätere MAUI-Portierung erleichtert.

**Negativ:**
- **Bundle-Größe**: Initialer WASM-Download (.NET-Runtime + Assemblies) ist trotz AOT realistisch 3–5 MB. Erste-Besucher-Latenz ist spürbar.
- **iOS Safari**: WASM-Performance ist auf iOS niedriger als in Chromium; bei sehr großen PDFs (>500 MB) spürbar.
- **Doppelter Stack**: PDF.js (JavaScript) bleibt eine notwendige Abhängigkeit (siehe ADR-003), das Versprechen „kein JavaScript" wird nicht gehalten — nur die UI-Logik ist JS-frei.

**Mitigation:**
- AOT-Compilation (`<RunAOTCompilation>true</RunAOTCompilation>`) für Produktions-Builds.
- Lazy-Loading von schweren Modulen (OCR, Batch-Processor) via Blazor Lazy-Loaded Assemblies.
- Loading-Splash bei erstem Besuch, danach Service-Worker-Caching.
- Pre-rendering der Landing-Page (statisch generierte HTML) für SEO und gefühlte Schnelligkeit.

## Alternativen erwogen

- **React + TypeScript + PDF.js**: bessere Bundle-Größe, größere JS-Community, aber: keine C#-Synergie, kein direkter MAUI-Pfad, anderes Tooling. Verworfen wegen Stack-Konsistenz mit MAUI-Plan.
- **Svelte/SolidJS**: ähnliche Argumente wie React.
- **Blazor Server**: braucht permanenten Server, kein Offline, passt nicht zu „kein Backend"-Anforderung (NFA-010). Verworfen.
- **.NET MAUI nativ ohne Web**: schließt PWA-Erstrelease aus. Verworfen wegen MVP-Plattformwahl „Web zuerst".

## Referenz

- Lastenheft TEC-01
- Pflichtenheft Abschnitt 2.3
