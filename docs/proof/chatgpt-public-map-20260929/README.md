# Local public map MCP evidence

Protocol and controlled local Chromium checks passed on 29 September 2026. Repository verification, production build, final source review and GitHub publication remain pending. This is local integration evidence. No authenticated ChatGPT account connection or production iframe CSP was tested.

## Before and after

An actual HTTP request with a foreign Host and an absolute loopback request target returned 200 before the authority fix. The regression expected 403. After the fix, the server validates Host independently and the real HTTP regression passes.

A real MCP result overwrote a failed map's status in Chromium: `failure-before-results: map failure disappeared after real MCP result: 3 listed pubs.` The widget now retains result status and map failure separately. Both failure-before-results and results-before-failure checks pass; the list remains available when module or streets requests fail.

Phone rendering also showed the pub popup covering map attribution. Opening a popup now pans only as needed to clear map edges and attribution. Browser geometry checks confirm the detail link clears attribution. The widget reports its content height through the documented MCP Apps size notification; the controlled host resizes the frame to show the full phone list.

## Current checks

- Seven Node tests pass: public whitelist and retirement, explicit publisher attribution, bounded borough results and coordinates, shared London price bands, real MCP client protocol, foreign Host refusal and shared theme projection.
- Actual public dataset results render in Chromium at 390px and 1440px. Three listed pubs, named pin buttons, an opened popup, canonical selected-pub link and no horizontal overflow pass.
- Module and street request failures retain their status after subsequent real MCP results.
- Changed-path ESLint exits zero. Dead-code gate passed after declaring the nested package as a separate workspace while preserving the root workspace entries.

Map tiles and pinned MapLibre modules are real network resources. Only the local host bridge is controlled. It answers initialization, delivers actual MCP tool results and handles content-size notifications. These checks establish rendering and local protocol behaviour, not authenticated ChatGPT hosting or distribution acceptance.

[Phone screenshot](390.png), [desktop screenshot](1440.png), [browser receipt](receipt.json). Raw logs and other captures stay in ignored local artifacts.
