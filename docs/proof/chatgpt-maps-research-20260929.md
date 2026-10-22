# ChatGPT Maps integration research, 29 September 2026

## Finding

The signed-in ChatGPT Maps page is accessible in the user's in-app browser. Its visible map attribution names Mapbox and OpenStreetMap. It presents venue markers, cards, ratings, opening state and nearby prompt suggestions. No documented API for embedding this exact native ChatGPT Maps page into an external Next.js app was found in the official documentation inspected below. This is a research limit, not proof that no private API exists.

The supported documented direction is a PUBMAXX MCP app that renders PUBMAXX's own map inside ChatGPT. OpenAI's UI documentation includes a Pizzaz Map example. PUBMAXX can retain its MapLibre rendering and price evidence instead of replacing either with ChatGPT search output.

## Three distinct integration paths

| Path | Evidence | Outcome |
| --- | --- | --- |
| Embed native chatgpt.com/maps in PUBMAXX | Visible product, no public embed contract found | Do not build against undocumented internal endpoints or assume iframe support. |
| PUBMAXX map in ChatGPT through an MCP app | Official MCP Apps UI bridge and map example | Feasible architecture. Requires our MCP server, map resource, explicit CSP and reviewed distribution. Not connected or deployed in this audit. |
| Local discovery with the OpenAI Responses web_search tool | Official approximate user_location fields | Can enrich discovery with city/region/country/timezone. Does not provide a basemap, tiles, friends' GPS or price authority. |

## Proposed narrow integration

Expose a read-only tool returning listed PUBMAXX venues for an explicitly supplied area. Its result contains public venue IDs, coordinates and source-backed price rows. Associate that tool with a versioned MCP map resource through `_meta.ui.resourceUri`. The component renders only the returned data, links to PUBMAXX for planning, and declares exact resource/connect domains. Public venue search needs no friend-location capability.

Do not send friends' precise locations into model context or public tool results. Friend sharing remains authenticated inside PUBMAXX. An MCP distribution project is a separate deliverable from improving today's website map startup.

## Evidence and access boundaries

- Read-only inspection of existing user tab https://chatgpt.com/maps, including attribution popover, on 29 September 2026.
- Browser location permission was not changed. No precise coordinates were copied into search requests.
- No ChatGPT prompt was submitted. No native Maps internal endpoints were called.
- Official documentation inspected live, not inferred from prior sessions.

## Sources

- [OpenAI MCP Apps UI documentation](https://developers.openai.com/plugins/build/chatgpt-ui): component resource, UI bridge, map example and CSP.
- [OpenAI web search tool](https://developers.openai.com/api/docs/guides/tools-web-search): approximate user_location fields.
- [ChatGPT Search location behaviour](https://help.openai.com/en/articles/9237897-searching-the-web-with-chatgpt): location permission and location use.
- [ChatGPT Maps](https://chatgpt.com/maps): visible product inspected in the user's browser.
