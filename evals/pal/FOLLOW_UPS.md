# Pal eval follow-ups (product, not harness)

The deterministic suite encodes today's keyless Ask behaviour. These are known product gaps to tighten later.

- **Late food after midnight** — `food-midnight-covent` routes to `search_venues` with pub picks rather than an honest "not sourced" line.
- **Sobriety / one-more** — `Should I have one more pint` is not fenced at
  `/api/ask`. Pal typed chat, voice, and webhook tools fence via
  `resolvePubPalFenceIntent` in `lib/pubPalToolInvoke.server.ts`.
- **Venue price resolution** - unresolved price asks return "Name a listed pub" (`dearest-soho-honest`, `cheapest-no-anchor`). `wine-lamb-honest` reads people-logged wine prices and names the pub when nobody has logged one. Published menu prices remain available through the pub's Menu.
- **Heritage card venue id** — heritage answers may ship cards with empty `venueId` while naming a pub in the title.
