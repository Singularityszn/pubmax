# Public venue map for ChatGPT

Recorded check results are in the [evidence record](../proof/chatgpt-public-map-20260929/README.md#current-checks). Public hosting, ChatGPT account connection and distribution remain separate release steps.

## Outcome

A person names a London borough in a conversation. One read-only MCP tool returns listed PUBMAXX pubs and pint prices. Its associated MCP Apps resource shows those pubs on PUBMAXX's own MapLibre map, with a list and links into the selected venue in PUBMAXX.

The official documentation establishes MCP Apps resources and the UI bridge. It does not establish an external embed contract for the native `chatgpt.com/maps` product. Keep this implementation on the documented MCP path.

## Contract

- `pubmaxx_venues_in_area` accepts only a borough from `lib/londonBoroughNames.mjs`, advertised as an exact schema enum, and an integer result limit from 1 to 30, defaulting to 12. The canonical names match the bundled dataset's `primary_borough` values. Districts such as Soho, aliases such as `Kensington & Chelsea` and other spellings are refused rather than answered with an empty list. It never requests or accepts a person's or friend's location or authenticated-account fields.
- Read only the committed public pint-price dataset. Reuse existing venue grouping, retired-price eligibility, publisher disclosure and canonical venue map links.
- Return only public venue ID, name, borough, coordinates, canonical link and at most three listed price rows. A price row contains drink, pounds, the shared London pint-price band and the recorded publisher, or null when unrecorded. Do not invent observation dates or claim live prices.
- Render a versioned MCP Apps resource using the official SDK on the server and its installed `App` client in the widget. Advertise only the supported `inline` display mode. Register tool-result and host-context listeners before connecting. Follow the host's light or dark theme, falling back to the OS preference when no host theme is supplied. Declare the exact external map and module origins. Keep map attribution visible, including the pub-data ODbL credit.
- Answer host ping and teardown requests. Before acknowledging teardown, abort owned host-link requests, remove widget listeners and size observers, remove the map, then revoke its worker blob URL. Keep the SDK transport open for the acknowledgement. Pending initialization keeps its timeout without the teardown abort signal. Late initialization, tool results, host-context changes, link refusals and map-import failures leave the retired widget unchanged.
- Render safe text and bounded data. Omit unused venue IDs from the widget's retained projection while preserving IDs in the public tool result. Accept canonical links only at `https://pubmaxxing.com/map` and publisher links only over HTTPS, with no URL credentials. Reject either URL before parsing if raw input exceeds 2,048 characters, and after parsing if the normalised address exceeds that limit. Rejecting a link retains its venue, grounded prices and valid sibling links. A rejected publisher URL retains its nonblank recorded label of at most 160 characters in both list and popup, following the [publisher disclosure wording](../VOICE.md#the-mission-said-plainly). Embedded links use the host's `openLinks` capability and `App.openLink`; denied or unsupported requests display the full accepted address. The copy fallback retains any map error within a 2,200-character whole status bound. If streets fail, retain the venue list and explain that streets could not load.
- Match PUBMAXX colours, support 390px and 1440px layouts, provide named keyboard-accessible pins and show pub detail on a pin tap.
- Bound popup content height to the responsive map height and allow scrolling through every price, publisher disclosure and canonical link. Keep the popup clear of attribution and navigation controls. Links scroll into view on keyboard focus, and pins and the close control remain keyboard-accessible.
- Keep the local preview on loopback. Reject foreign Host/Origin values, bound request bodies and keep no persistent sessions or personal data.

## Proof and release

Use the official MCP client for initialization, tool discovery, strict argument validation and resource reads. Drive the actual widget with real public dataset results and a controlled host bridge in Chromium at desktop and phone sizes. Record the controlled host boundary explicitly: local rendering does not prove authenticated ChatGPT connection or its production iframe policy.

Run the repository gate and review the final source before publishing through no-mistakes. Supply local setup instructions and pinned nested dependencies. No production website deployment, public tunnel or ChatGPT distribution submission is authorised by this local implementation.

References: [MCP Apps quickstart](https://developers.openai.com/plugins/build/app-quickstart), [UI resource and bridge documentation](https://developers.openai.com/plugins/build/chatgpt-ui).
