# Public venue map for ChatGPT

Status: local protocol, controlled browser, full repository verification and production build passed on the [recorded candidate](../proof/chatgpt-public-map-20260929/README.md). Final committed-head validation and reviewed GitHub publication remain pending. Public hosting, ChatGPT account connection and distribution remain separate release steps.

## Outcome

A person names a London borough in a conversation. One read-only MCP tool returns listed PUBMAXX pubs and pint prices. Its associated MCP Apps resource shows those pubs on PUBMAXX's own MapLibre map, with a list and links into the selected venue in PUBMAXX.

The official documentation establishes MCP Apps resources and the UI bridge. It does not establish an external embed contract for the native `chatgpt.com/maps` product. Keep this implementation on the documented MCP path.

## Contract

- `pubmaxx_venues_in_area` accepts only one of the 33 borough names the bundled dataset records, spelt exactly, and a bounded result limit from 1 to 30. A district, alias or other spelling is refused rather than answered with an empty list. It never requests or accepts a person's or friend's location.
- Read only the committed public pint-price dataset. Reuse existing venue grouping, retired-price eligibility, publisher disclosure and canonical venue map links.
- Return only public venue ID, name, borough, coordinates, canonical link and at most three listed price rows. A price row contains drink, pounds, the shared London pint-price band and the recorded publisher, or null when unrecorded. Do not invent observation dates or claim live prices.
- Render a versioned MCP Apps resource using the official SDK. Declare the exact external map and module origins. Keep map attribution visible, including the pub-data ODbL credit.
- Render safe text, bounded data and safe links. If streets fail, retain the venue list and explain that streets could not load.
- Match PUBMAXX colours, support 390px and 1440px layouts, provide named keyboard-accessible pins and show pub detail on a pin tap.
- Keep the local preview on loopback. Reject foreign Host/Origin values, bound request bodies and keep no persistent sessions or personal data.

## Proof and release

Use the official MCP client for initialization, tool discovery, strict argument validation and resource reads. Drive the actual widget with real public dataset results and a controlled host bridge in Chromium at desktop and phone sizes. Record the controlled host boundary explicitly: local rendering does not prove authenticated ChatGPT connection or its production iframe policy.

Run the repository gate and review the final source before publishing through no-mistakes. Supply local setup instructions and pinned nested dependencies. No production website deployment, public tunnel or ChatGPT distribution submission is authorised by this local implementation.

References: [MCP Apps quickstart](https://developers.openai.com/plugins/build/app-quickstart), [UI resource and bridge documentation](https://developers.openai.com/plugins/build/chatgpt-ui).
