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
| User documents | Exfiltration / tracking | No backend, no cookies, no telemetry; the only outbound request is the Tesseract.js CDN for OCR language models, **and only on an explicit OCR click** |
| The app shell | Clickjacking / MIME-sniffing / injection | HTTP security headers (CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) via nginx |

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
Tesseract.js language models are the only third-party fetch, gated behind an
explicit OCR action.
