# Local public map MCP evidence

Protocol, controlled local Chromium, full repository verification and the production build passed on 30 September 2026 for the first candidate. Independent Standards and Spec review cleared those source changes. This is local integration evidence. No authenticated ChatGPT account connection or production iframe policy was tested.

Later review rounds changed the widget attribution, the tool's borough schema, the protocol test and the widget's host client. The [review fixes](#review-fixes) section records what changed and which receipts are fresh. The earlier sections are the baseline and stay as recorded.

## Before and after

An actual HTTP request with a foreign Host and an absolute loopback request target returned 200 before the authority fix. The regression expected 403. After the fix, the server validates Host independently and the real HTTP regression passes.

A real MCP result overwrote a failed map's status in Chromium: `failure-before-results: map failure disappeared after real MCP result: 3 listed pubs.` The widget now retains result status and map failure separately. Both failure-before-results and results-before-failure checks pass; the list remains available when module or streets requests fail.

Phone rendering also showed the pub popup covering map attribution. Opening a popup now pans only as needed to clear map edges and attribution. Browser geometry checks confirm the detail link clears attribution. The widget reports its content height through the documented MCP Apps size notification; the controlled host resizes the frame to show the full phone list.

Native Enter left the pub popup closed at 1440px. The marker now owns Enter and Space activation through the public Marker API and prevents a second native activation after popup focus moves. Both keys open details at desktop and phone sizes.

Enforcing the actual resource's declared CSP also reproduced a blocked MapLibre blob worker and an empty street map. The resource now declares `blob:` for its locally constructed, pinned module worker. The browser checks enforce the [MCP Apps CSP recipe](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) inside a sandboxed iframe. No external network origin or browser permission was added.

A real pub-link click in that sandbox did not reach the host. Embedded links now use the documented `ui/open-link` request when the host advertises support. The controlled host records and acknowledges actual pub and publisher clicks. A refusal or unsupported host displays a copyable address without adding popup permission. This proves the host request and response, not navigation to the external destination.

## Review fixes

The baseline phone and desktop screenshots showed only the street-tile credit. The widget passed `customAttribution` as a top-level MapLibre option, which MapLibre 6.11.2 ignores, so `Pub data © OpenStreetMap contributors (ODbL)` never rendered. The credit now goes through `attributionControl` with `compact: true`, the same supported API the main app uses. The browser proof now waits for that exact text in the rendered attribution element and requires it to be visible at 390px and 1440px. The regenerated [phone](390.png) and [desktop](1440.png) screenshots and the [receipt](receipt.json) show it beside the street-tile credit.

The tool accepted any 2 to 80 character `area` but matched only an exact dataset borough, so `Kensington & Chelsea`, `City of Westminster` or `Soho` returned an empty list that read as "No pubs listed for that borough." The advertised input schema is now an enum of the 33 canonical names in `lib/londonBoroughNames.mjs`, the same names the build stamps onto `primary_borough`. A real SDK client reads that enum from `listTools`. Unsupported districts, aliases, a lower-case spelling and an out-of-range limit are refused before the venue loader runs. A unit test holds that canonical list to the dataset's own borough set. No district mapping or new data source was added.

The protocol test no longer searches the served widget for a bridge method name. It asserts the resource's declared CSP domains instead. Bridge initialization stays proved by the browser run.

The widget hand-wrote its MCP Apps JSON-RPC client and answered no host-initiated request. Against the widget at `181a4590`, the controlled host's `ping` and `ui/resource-teardown` requests both went unanswered: `Host requests unanswered at 1440px: [{"method":"ping","error":"ping had no answer after 3000ms"},{"method":"ui/resource-teardown","error":"ui/resource-teardown had no answer after 3000ms"}]`. The widget now uses the `App` client from the installed `@modelcontextprotocol/ext-apps` 2.0.3 `app-with-deps` export. The server inlines that self-contained module into the resource, and the widget imports it through a `blob:` module URL the declared CSP already allows. No origin, `unsafe-eval` or dependency was added. The SDK answers `ping`, runs initialization and sends size notifications. The widget registers its tool-result and host-context listeners before it connects. Links open through `openLink` only when the host advertises `openLinks`, and the copy-address fallback is unchanged. On teardown the widget removes its listeners, stops size notifications and removes the map before it acknowledges. It does not close the transport; the host unmounts it.

A host theme now overrides the OS preference. The resource still takes dark tokens from `prefers-color-scheme` when the host names no theme. The SDK's `applyDocumentTheme` sets `data-theme`, and the existing light and dark token owners are projected onto that attribute. No token was added.

The browser run proves both host requests return `{}`. After teardown, a later tool result leaves the list unchanged and does not rebuild the map. Appending content sends no further size notification. One size measurement the SDK had already queued before teardown can still arrive, so the check waits two animation frames before it counts. Computed root colours match the OS-default light and dark renders when the host sets dark over an OS light preference and light over an OS dark preference, and again after each `ui/notifications/host-context-changed` switch.

## Lifecycle and URL follow-up, 30 September 2026

The seven-case lifecycle run used the actual served widget, installed official App SDK and a real public MCP result under a controlled separate-origin Chromium host. The [before receipt](lifecycle-before.json) records five failures and two passes at widget SHA-256 `64cddc4087e6b01ead180461a438c4d082e4783eda1b2a5e5dd90a6bb4749e59`. The [after receipt](lifecycle-after.json) records all seven cases passing at `d43fb8c04db99f969a8c0b3fb3d8ee81f0a0c49080e5d4d9e057d03f78cb000a`. Both ran before the follow-up commit, so their HEAD field names parent commit `54e041f8`; their source hashes name the exact tested files.

The widget now declares only `availableDisplayModes: ["inline"]`. Teardown aborts owned pending host link requests and their timers, ignores late refusals and rejected map imports, removes the map, then revokes its owned worker blob URL before acknowledging. The SDK transport stays open for that acknowledgement. Initialization retains its existing timeout rather than the link abort signal: the installed App client closes its transport when initialization rejects. A held-initialization check confirms teardown still answers `{}` and a later initialization response changes no retired DOM, theme, canvas or size notifications.

Canonical and publisher URLs are refused before parsing when raw input exceeds 2,048 characters, and refused after parsing when normalisation exceeds that bound. Both malformed variants previously remained in list and popup links; their copy fallbacks reached 65,607 and 3,066 characters. After the fix, no oversized anchor remains, while real GBP/drink rows and the valid sibling remain in both surfaces. An accepted exactly 2,048-character canonical address reaches the host intact; denial preserves the full copy address and existing map failure in a 2,134-character status, below the 2,200-character proof limit.

Fresh nested Node tests passed all eight cases. The existing [browser receipt](followup-browser.json) and inspected [phone](followup-390.png) and [desktop](followup-1440.png) screenshots passed actual map rendering, attribution, native Enter and Space, popup geometry, pub and publisher host requests, refused and unsupported link fallbacks, teardown, result/error ordering and host/OS themes at 390px and 1440px. The declared resource CSP was enforced. These checks establish controlled local rendering and protocol behaviour; authenticated ChatGPT, external destination navigation, production hosting policy, host container-size limits and distribution acceptance remain unverified.

The follow-up repository gate and GitHub publication remain pending. The earlier checks below describe their recorded candidates and do not verify this follow-up.

## Unused venue ID follow-up, 30 September 2026

Review found that the widget retained an unused host-delivered venue ID without a length bound. The [before receipt](id-before.json) records the actual module's retained projection with two venues and a 65,536-character ID. The native debugger paused the served widget immediately after its projection assignment and inspected only count, property presence and string length. The test changed the venue heading to prove the malformed result rerendered, then checked both cards, grounded GBP/drink rows and canonical links. The other seven lifecycle cases passed.

The widget now omits that unused field from its retained projection. Public MCP result IDs and the input contract remain unchanged. The [after receipt](id-after.json) records all eight cases passing: two venues remain, with no retained ID property or string. Before and after used the same driver SHA-256 `96eb16a1f97d1e9437023f055e22843ceed0479a411e0db86f3d04d41248803f`, installed SDK and server. Widget SHA-256 changed from `d43fb8c04db99f969a8c0b3fb3d8ee81f0a0c49080e5d4d9e057d03f78cb000a` to `d2ce3d3c0fea85be9398f4720e947017e82107b53ad15b35ce82e909a52070ac`. Both ran before the new commit, so HEAD names the published parent `34f11ca2`; per-run source hashes remained stable. An earlier harness attempt could not attach a separate CDP session to the shared renderer and remains in ignored local artifacts as a harness failure, separate from the demonstrated defect.

Fresh nested Node tests passed all eight cases. The [browser receipt](id-browser.json) and inspected [phone](id-390.png) and [desktop](id-1440.png) screenshots passed actual map, attribution, native keyboard, popup geometry, host links, teardown, error ordering and theme checks at 390px and 1440px. Captured owned browser and process groups were absent after the runs. This remains controlled local evidence. Final-head repository validation and reviewed publication for this ID follow-up are pending; authenticated ChatGPT, external destination navigation and production release remain unverified.

## Current checks

The review-fix source and curated receipts are retained in commit `99c8fb9314939ffc79173d21b0d04a706741a509`. These are recorded runs; the documentation and lint phase does not rerun them. Final committed-head validation and reviewed GitHub publication remain pending.

Fresh on the review-fix source:

- Eight Node tests pass: public whitelist and retirement, explicit publisher attribution, bounded borough results and coordinates, exact dataset borough names, shared London price bands, real MCP client protocol with the borough enum and refused inputs, foreign Host refusal and shared theme projection.
- Actual public dataset results render in Chromium at 390px and 1440px. Three listed pubs, the visible pub-data attribution, named pin buttons, native Enter and Space, an opened popup that clears attribution, canonical selected-pub link and no horizontal overflow pass.
- Module and street request failures retain their status after subsequent real MCP results.
- Pub and publisher links reach the controlled host. Denied and unsupported link requests show the address without horizontal overflow.
- The SDK client answers host `ping` and `ui/resource-teardown` at 390px and 1440px. A tool result after teardown rebuilds nothing, and host theme and context changes set the rendered colours.

Recorded on the first candidate and not rerun in the review rounds; the pipeline's own test and build steps cover the final source:

- Full `npm run verify:no-mistakes` exits zero: 1,695 coverage files and 17,968 tests pass, with one file and five tests skipped; all seven MCP protocol tests, 421 PostgreSQL permission tests and both nine-test shared-memory checks pass. Types, dead-code and audit gates pass. Lint has zero errors and 74 warnings; changed MCP paths have zero errors or warnings. Freshness retains one advisory stale dataset and three unmeasured store feeds.
- The Next.js 16.3.6 production build exits zero with `DEPLOYMENT_VERSION=local`, `NEXT_DIST_DIR=.next-prod` and the existing wrapper restoring tracked bundled data and Next files. No application server was deployed.
- Dead-code gate passed after declaring the nested package as a separate workspace while preserving the root workspace entries.

Map tiles and pinned MapLibre modules are real network resources. The local host bridge is controlled. It answers initialization with a host context, delivers actual MCP tool results, sends `ping`, teardown and host-context changes, enforces the resource's declared CSP and handles content-size notifications. The iframe uses `allow-scripts allow-same-origin` on a separate origin. These checks establish rendering and local protocol behaviour, not authenticated ChatGPT hosting or distribution acceptance.

[Before keyboard and worker fixes](1440-Enter-before.png) and [before host-link handling](1440-link-before.png) are baseline failure captures. The [phone screenshot](390.png), [desktop screenshot](1440.png) and [browser receipt](receipt.json) are fresh from the review-fix source. Raw logs and other captures stay in ignored local artifacts.
