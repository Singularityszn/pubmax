# Local ChatGPT public map

This MCP app shows public London venues and their bundled listed pint prices. It has no account or friend-location tool. Adding a friend in PUBMAXX does not expose GPS to this app.

The server uses the official MCP SDK and MCP Apps UI resource protocol. It reuses PUBMAXX's venue grouping, retired-price rule and publisher resolver. The widget talks to its host through the `App` client from the installed `@modelcontextprotocol/ext-apps` `app-with-deps` export, which the server inlines into the resource. It follows the host's light or dark theme, and falls back to the OS preference. It uses PUBMAXX paper, ink and coral colours, a MapLibre map and OpenFreeMap streets. Map attribution and the `Pub data © OpenStreetMap contributors (ODbL)` credit remain visible.

Run from this folder after installing the root app dependencies:

```sh
npm ci
npm test
npm start
```

The local endpoint is `http://127.0.0.1:8787/mcp`. Set `PUBMAX_MCP_PORT` to choose another port. `/widget` previews the UI, which waits for a host-delivered tool result. The sole tool, `pubmaxx_venues_in_area`, accepts one of the 33 London borough names the bundled dataset records, spelt exactly as its schema enum lists them, and a limit from 1 to 30. Districts such as Soho, aliases such as `Kensington & Chelsea` and other spellings are refused, not answered with an empty list. It returns at most three listed pint prices per pub. These prices are not a live feed, and no per-row observation date is invented.

The server binds to loopback, rejects foreign Host and Origin values, bounds request bodies, and retains no sessions. Local protocol tests exercise initialization, tool calls, UI resources and invalid inputs with the official client. No OpenAI API key is needed.

The root `npm run verify` installs this pinned package and runs its protocol tests through `test:chatgpt-map`. Browser proof remains a separate runtime check.

`npm run proof:browser` uses the root app's Playwright installation and cached Chromium to check the actual widget with real MCP venue results at 390px and 1440px. A controlled local host answers the UI bridge initialization, sends `ping`, teardown and theme changes, and enforces the resource's declared CSP. Screenshots and JSON stay in ignored `artifacts/chatgpt-map/`. This check does not establish an authenticated ChatGPT connection or compatibility with its production host policy.

Local protocol, controlled browser, full repository verification and production build passed on the recorded candidate; [evidence](../../docs/proof/chatgpt-public-map-20260929/README.md) records their scope. Final committed-head validation and reviewed GitHub publication remain pending. ChatGPT developer-mode testing needs approved public hosting, an HTTPS endpoint, a reviewed Host/Origin policy and actual account connection. No tunnel, account connection or distribution submission runs automatically. Native ChatGPT Maps has no embed contract established by the sources checked.

Official references: [MCP app quickstart](https://developers.openai.com/plugins/build/app-quickstart), [UI resources and bridge](https://developers.openai.com/plugins/build/chatgpt-ui).
