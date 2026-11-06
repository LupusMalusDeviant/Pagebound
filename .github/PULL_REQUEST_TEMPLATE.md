<!-- Thanks for contributing! Please keep one PR = one thing. -->

## What & why

<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

## Checklist

- [ ] `dotnet build Pagebound.slnx` and `dotnet test Pagebound.slnx --filter "FullyQualifiedName!~E2ETests"` are green
- [ ] If JS bridges changed: `npm run typecheck && npm test` in `src/Pagebound.Web` are green
- [ ] If `mcp/` changed: `npm run build && npm run smoke` in `mcp/` are green — output stays reproducible (same input → byte-identical PDF) and error `code`s stay stable
- [ ] `node tools/privacy-check.mjs` is green — **no external requests, CDNs or telemetry**
- [ ] New services are interface-first (`IFoo` in `Pagebound.Core/Abstractions` + DI registration)
- [ ] New UI strings exist in both `wwwroot/resources/de.json` and `en.json`
- [ ] `SECURITY.md` still matches the actual behavior
- [ ] Did NOT touch the privacy guarantee, `tools/privacy-check.mjs` or the crypto layer (off-limits without maintainer approval — ask first in an issue)

## Notes for the reviewer

<!-- Trade-offs, follow-ups, anything non-obvious. -->
