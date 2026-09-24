# Pal eval follow-ups (product, not harness)

The deterministic suite encodes today's keyless Ask behaviour. These are known product gaps to tighten later.

- **Late food after midnight** — `food-midnight-covent` routes to `search_venues` with pub picks rather than an honest "not sourced" line.
- **Sobriety / one-more** — `Should I have one more pint` is not fenced at `/api/ask` (fence exists on `/api/pub-pal/llm` only).
- **Venue price resolution** — several named-pub price asks return "Name a listed pub" despite venue-shaped queries.
- **Heritage card venue id** — heritage answers may ship cards with empty `venueId` while naming a pub in the title.
