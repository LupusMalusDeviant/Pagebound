# ADR-009: GitHub Actions für CI/CD

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Pagebound braucht eine CI-Pipeline für:
- Build-Verifikation bei jedem Push und PR.
- Unit- und Component-Tests (xUnit, bUnit).
- E2E-Tests (Playwright).
- A11y-Audit (Lighthouse, NFA-034: Score ≥ 90).
- Deploy auf statisches Hosting (eigene Domain via CNAME).

Open-Source-CI-Optionen:
- **GitHub Actions**: nativ in GitHub, kostenlos für Public Repos.
- **GitLab CI**: setzt GitLab-Hosting voraus.
- **Azure DevOps**: passt zu .NET, aber separates System.
- **CircleCI / Travis CI / Drone**: möglich, aber zusätzlicher Anbieter.

## Entscheidung

**GitHub Actions als alleiniges CI/CD-System.**

Pipeline (siehe `.github/workflows/ci.yml`):

1. **Build & Test** (Ubuntu): `dotnet restore` → Tailwind-CSS → `dotnet build` → `dotnet test` mit Coverage-Sammlung.
2. **E2E-Tests** (Ubuntu): Playwright-Browser-Install + E2E-Suite.
3. **Lighthouse A11y Audit** (Ubuntu): statischer Build → Lighthouse-CI mit Assertion `accessibility >= 0.90`.
4. **Deploy** (optional, später): Push zu Cloudflare/GitHub Pages bei Tag-Push.

## Konsequenzen

**Positiv:**
- **Kostenlos** für Public Repos (Open-Source).
- **Tiefe GitHub-Integration**: PRs, Issues, Status-Checks, automatische Cancellation bei neuen Pushes.
- **Großes Marketplace-Ökosystem**: Actions für Codecov, Lighthouse, Playwright, etc. fertig verfügbar.
- **Matrix-Builds** für Cross-Plattform-Tests (Linux + macOS + Windows) später leicht erweiterbar.

**Negativ:**
- **Vendor-Lock-in** an GitHub. Wechsel zu GitLab/Forgejo wäre eine Migration.
- **Runner-Minuten begrenzt** in Free-Tier (2000 min/Monat), aber für Pagebound-Größe ausreichend.
- **Self-hosted Runners** möglich, aber initial unnötig.

**Mitigation:**
- Vendor-Lock-in wird als akzeptabler Trade-off gesehen, da GitHub das Repo-Hosting ohnehin stellt.
- Caching von npm- und NuGet-Packages reduziert Runner-Minuten merklich.

## Alternativen erwogen

- **Azure DevOps**: solide für .NET, aber separates System neben GitHub. Verworfen wegen Komplexität.
- **CircleCI**: gut, aber Anbieter-Doppelt. Verworfen.
- **Eigene Jenkins-Instanz**: Wartungslast für Solo-Entwickler zu hoch.

## Referenz

- Lastenheft NFA-034 (A11y-Gate)
- Pflichtenheft Abschnitt 8.4 (CI-Pipeline-Skizze)
- `.github/workflows/ci.yml` (konkrete Implementation)
