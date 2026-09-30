# Local ChatGPT public map

This MCP app shows public London venues and their bundled listed pint prices. It has no account or friend-location tool. Adding a friend in PUBMAXX does not expose GPS to this app.

The server uses the official MCP SDK and MCP Apps UI resource protocol. It reuses PUBMAXX's venue grouping, retired-price rule and publisher resolver. The widget talks to its host through the `App` client from the installed `@modelcontextprotocol/ext-apps` `app-with-deps` export, which the server inlines into the resource. It follows the host's light or dark theme, and falls back to the OS preference. It uses PUBMAXX paper, ink and coral colours, a MapLibre map and OpenFreeMap streets. Map attribution and the `Pub data © OpenStreetMap contributors (ODbL)` credit remain visible.

Run from this folder after installing the root app dependencies:

```sh
npm ci
npm test
npm start
```

The local endpoint is `http://127.0.0.1:8787/mcp`. Set `PUBMAX_MCP_PORT` to choose another port. `/widget` previews the UI, which waits for a host-delivered tool result. The [tool contract](../../docs/plans/public-venue-chatgpt-map.md#contract) owns accepted borough names, result bounds and price disclosures.

The server binds to loopback, rejects foreign Host and Origin values, bounds request bodies, and retains no sessions. Local protocol tests exercise initialization, tool calls, UI resources and invalid inputs with the official client. No OpenAI API key is needed.

The root [command reference](../../README.md) describes `test:chatgpt-map` and its inclusion in `verify`. Browser proof remains a separate runtime check.

`npm run proof:browser` uses the root app's Playwright installation and cached Chromium to check the actual widget with real MCP venue results at 390px and 1440px. A controlled local host answers the UI bridge initialization, sends `ping`, teardown and theme changes, and enforces the resource's declared CSP. Screenshots and JSON stay in ignored `artifacts/chatgpt-map/`. This check does not establish an authenticated ChatGPT connection or compatibility with its production host policy.

`npm run proof:lifecycle` drives seven teardown and URL-boundary cases against the actual widget and installed SDK. It holds real host replies, observes platform worker-URL cleanup, checks raw and normalised oversized links with retained public prices, and verifies a full copy-address fallback at the accepted URL limit. Receipts and the retired-widget capture stay in ignored `artifacts/chatgpt-map-lifecycle/`. The controlled host does not prove authenticated ChatGPT or external navigation.

The [evidence record](../../docs/proof/chatgpt-public-map-20260929/README.md#current-checks) owns check results and distinguishes the first candidate from later review fixes. ChatGPT developer-mode testing needs approved public hosting, an HTTPS endpoint, a reviewed Host/Origin policy and actual account connection. No tunnel, account connection or distribution submission runs automatically. Native ChatGPT Maps has no embed contract established by the sources checked.

Official references: [MCP app quickstart](https://developers.openai.com/plugins/build/app-quickstart), [UI resources and bridge](https://developers.openai.com/plugins/build/chatgpt-ui).
