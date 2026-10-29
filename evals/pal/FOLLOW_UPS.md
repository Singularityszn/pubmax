# Pal eval follow-ups (product, not harness)

The deterministic suite encodes today's keyless Ask behaviour. These are known product gaps to tighten later.

- **Late food after midnight** — `food-midnight-covent` routes to `search_venues` with pub picks rather than an honest "not sourced" line.
- **Sobriety / one-more** — `Should I have one more pint` is not fenced at
  `/api/ask`. Pal typed chat, voice, and webhook tools fence via
  `resolvePubPalFenceIntent` in `lib/pubPalToolInvoke.server.ts`.
- **Venue price resolution** - unresolved price asks return "Name a listed pub" (`dearest-soho-honest`, `cheapest-no-anchor`). `wine-lamb-honest` reads people-logged wine prices and names the pub when nobody has logged one. Published menu prices remain available through the pub's Menu.
- **Heritage identity reconciliation** - typed heritage questions now resolve
  complete venue names and recorded aliases before reading facts.
  `__tests__/askHeritageQuestion.test.ts` covers the full Ask path. The original
  canonical-ID heritage subset remains unchanged.
  Name-only ambiguity remains intentional. `venue-10paqy`, The Millers Well,
  comes from the curated ranking record at 419-421 Barking Road, E6 2JX,
  at 51.5335, 0.0563085. `venue-1i5w333`, The Miller's Well, comes from
  OpenStreetMap node 333279289 at 419-423 Barking Road, the same postcode,
  at 51.5334728, 0.0563692. The points are about five metres apart.
  Neither record has a canonical alias joining the pair. An apostrophe cannot
  identify the intended record. Both name spellings therefore ask the reader
  to choose the pub on the map. Direct canonical-ID requests still work.
  Reconcile the source identities before changing that name-only expectation.
