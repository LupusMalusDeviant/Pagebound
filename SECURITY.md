# Security

Pagebound is a **fully client-side, static PWA** — no backend, no accounts, no
telemetry. Everything (PDF parsing, rendering, encryption, OCR, storage) runs in
the user's browser. This file records the threat model and the M6 security review.

## Reporting a vulnerability

Please open a **private security advisory** on GitHub (Security → Report a
vulnerability) rather than a public issue. Include reproduction steps and the
affected version/commit. We aim to acknowledge within a few days.

## Threat model

| Asset | Threat | Control |
|---|---|---|
| The user's machine/browser | Malicious/untrusted PDF triggering code execution | PDF.js runs with `isEvalSupported: false`; pdf-lib parses structurally; everything is sandboxed in the browser, no native/server execution |
| Annotations / notes | Stored XSS via sticky-note Markdown | Markdig pipeline with **`.DisableHtml()`** — raw HTML never reaches the DOM; the only `MarkupString` sink renders this sanitized output |
| Encrypted PDFs | Weak encryption / predictable keys | AES-256 (ISO 32000-2 `/V5 /R6`) via WebCrypto; all key material from `crypto.getRandomValues` (CSPRNG) |
| User documents | Exfiltration / tracking | No backend, no cookies, no telemetry, **no request to any third party** — OCR worker, WASM core and language models are self-hosted (`/tesseract`, `/tessdata`); CSP is `connect-src 'self'` and `tools/privacy-check.mjs` fails the build on any external reference. The only requests go to this origin: the service-worker update check and `resources/{lang}.json` |
| Document text (read aloud) | Text leaving the device through a cloud TTS voice | The Web Speech API is **not** local by itself — Chrome's "Google …" voices synthesise server-side, and neither the CSP nor `privacy-check.mjs` can see it (the browser opens that connection, and no foreign address appears in the source). `tts-bridge.ts` therefore offers and uses **only** voices reporting `localService === true`, always sets `utterance.voice` explicitly (the engine's default may be a network voice), and refuses to speak when no local voice exists. Guarded by `tests-js/tts.test.mjs` |
| The app shell | Clickjacking / MIME-sniffing / injection | HTTP security headers (CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) via nginx |
| The share target (`POST /share-target`) | A foreign website submitting a form to `/share-target`, so a file of the attacker's choosing — under a file name of their choosing — is parked and opened in the user's reader | **Partially mitigated, and the gap is deliberate.** The service worker treats a share as legitimate only when `request.referrer` is absent, `about:client`, this origin over http(s), or carries the scheme `android-app:` — the referrer Chrome gives a Trusted Web Activity, whose `URL.origin` is the string `"null"`, so a check on origin alone would reject every share in the Play build. Everything else — a foreign http(s) origin, any other scheme, a referrer that cannot be parsed — is answered with `/reader?share=rejected` and nothing is stored. A further delivery channel (iOS, Microsoft Store) has its scheme measured and added, not waved through. The file is then validated like any other input — `pageboundBoot.offer()` checks MIME **and** magic bytes, and a non-PDF is refused. <br>**What this does not catch:** a foreign page can suppress the referrer with `referrerpolicy="no-referrer"`. `request.referrer` is then empty and the share passes the origin check. `Sec-Fetch-Site` is no help, because the browser sets it after the service worker and it is not reliably present in `event.request.headers`. The remaining exposure is that a valid PDF the user did not choose can open in the reader, with its name shown; nothing is uploaded, executed or sent anywhere. A confirmation prompt would close it at the cost of a click per share and is an open decision in `docs/contracts/datei-eintritt.md` ("Offen 2"). <br>**Measured, not assumed** (probe worker in the real image, driven through the E2E suite with real Chromium and a real form navigation): the worker is handed eight request headers — `accept`, `content-type`, `origin`, the four `sec-ch-ua*`/`upgrade-insecure-requests` hints, and `user-agent`. `Content-Length` is absent, so no size can be known before the body is read. `origin` *is* present and cannot be suppressed by a referrer policy, which makes it the better signal for this check; what Chrome sends a Trusted Web Activity as `origin` has not been measured on a device, and acting on an unmeasured assumption is exactly how the `android-app:` referrer was missed once already. Open, noted at the end of the contract's addendum 4. <br>**The parked entry.** Each share is stored under an unguessable key (`crypto.randomUUID()`, or 16 random bytes as hex where that is unavailable) and the redirect carries that key, so a start picks up exactly its own entry. The key used to be a running number, which gave a foreign page two ways to destroy the user's file: `/reader?share=999` deleted every entry with a lower number, and any start without a number — including a `?share=rejected` a foreign page can trigger — deleted everything it found, including the share another window was still waiting for. Clean-up now goes by age alone: a foreign entry is deleted only once it is more than five minutes old, which is what the privacy page promises. An entry without a readable timestamp counts as old. <br>Guarded by `tests-js/service-worker.test.mjs` (acceptance, rejection by scheme and origin, a test pinning the empty-referrer gap, key form and uniqueness, the timestamp) and `tests-js/boot.test.mjs` (a fresh foreign entry survives a start without a key, an invented key deletes nothing, the own entry is fetched regardless of age, entries without a timestamp are cleaned). The E2E suite covers the accepted path only; there is no browser-level test for the rejection. |

## M6 review — findings

**Dependencies.** `PdfSharpCore` (transitively `SixLabors.ImageSharp 1.0.4`,
known high-severity CVEs NU1903 GHSA-2cmq-823j-5qj8 / GHSA-63p8-c4ww-9cg7 /
GHSA-65x7-c272-7g7r) was **removed entirely** — it had been dead in the web path
since M1 (all PDF operations run through pdf-lib / PDF.js). `dotnet build` is now
free of NU19xx warnings.

**Cryptography (PDF encryption).** Audited the WebCrypto R6 implementation
(`pdf-manipulator-bridge.ts`):
- All random material — 32-byte file key, 8-byte validation/key salts, 16-byte
  IVs, the 4-byte `/Perms` nonce — comes from `crypto.getRandomValues`. No
  `Math.random` anywhere in the crypto path.
- Algorithm 2.B (the iterated hardening hash) is correct: ≥64 rounds with the
  SHA-256/384/512 selection and the `last byte ≤ round − 32` termination.
- Key derivation (`/U /UE /O /OE /Perms`) follows ISO 32000-2 §7.6.4.3.
- AES is hardware-accelerated via the SubtleCrypto API; a built-in self-test
  round-trips the construction and verifies wrong-password rejection.
- **Known limitations (not vulnerabilities, by design / scope):** only stream
  (page-content) objects are encrypted — string objects (title, bookmarks) stay
  in clear text (`/StrF /Identity`); passwords are not SASLprep-normalised
  (an interop nuance for non-ASCII passwords). Both are documented in-app.

**Untrusted-PDF parsing & XSS.** PDF.js eval is disabled; the single Markdown
render path is HTML-free; no other untrusted content is injected as HTML.

**HTTP headers.** Added a CSP plus `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy` and `Permissions-Policy` to the nginx config. The CSP allows
`'wasm-unsafe-eval'` (required by the .NET WASM runtime), `'unsafe-inline'` (the
pre-boot theme script + inline styles), and `https:`/`blob:` for the Tesseract
OCR CDN. Tightening `script-src` (extracting the inline boot script, pinning the
OCR host) is tracked as follow-up hardening; the CSP should be smoke-tested in a
real Docker deployment, since the `dotnet run` dev server does not use nginx.

## Privacy stance

No analytics, no error reporting, no fonts/CDN at load (fonts are self-hosted).
Tesseract.js — worker, WASM core and the `deu`/`eng` language models — is served
from this origin as well, so OCR makes no third-party request either. It is not
precached: `deu.traineddata.gz` and `eng.traineddata.gz` are 1.3 MB and 2.9 MB
and match no pattern in `offlineAssetsInclude`, so the first OCR run fetches
them from this origin (Tesseract then keeps them in IndexedDB). OCR therefore
works offline only after it has run online once — deliberately, so that every
install does not carry 4.3 MB nobody may ever use. Reading aloud uses
device-local voices only (see the threat model).

There is no request to any **other host**, at any time. Requests to this origin
do happen and are not hidden: on every start the service worker re-checks
`/service-worker.js` and fetches `resources/{lang}.json` network-first, so a
start leaves entries in this server's access log. Nothing else leaves the
browser — documents never do.

The user-facing version of this statement is `/datenschutz/` (German) and
`/en/privacy/` (English), generated by `tools/gen-landing.mjs`. Keep the three in
step: the stores are given that URL.
