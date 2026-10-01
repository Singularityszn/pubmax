# Publisher-row delivery source trace

Source-only review. No browser, API, network or live-store result is claimed.

The original Sydney Arms row at `data/uk_prices/site_harvest.jsonl:1701` records `venue-uk-n8308248176`, wine, £13, Sauvignon Blanc, New Zealand, `250ml`, the publisher menu URL and observation `2026-09-29T10:40:17.846Z`. The bundle builder carries these fields into `public/data/uk_prices/rows.json`, adds listed/site-harvest provenance and a wine-white subtype. `ukPriceBundle.server.ts` consumes that generated bundle at runtime.

The UK-base shard has no curated venue identity. The map routes base venues to `UnverifiedPubSheet`, whose harvest-overlay read supplies website/menu links and lore alongside separate community state. That sheet does not consume or render the listed bundle rows. The curated `/api/venue/[id]` path first needs a curated venue resolution, so it cannot establish delivery of this base identity. `VenueMenuTab` uses legacy pint rows and the distinct drink-price-update snapshot rather than the site-harvest bundle.

Curated `listedCategoryPrices` is a representative projection: it excludes beer, chooses the cheapest row per recognised serving and caps category output at four. The £13 Sauvignon Blanc 250 ml example would lose the representative slot to the £10.50 Rioja 250 ml from the same venue/date. That is projection behaviour, distinct from the missing base-sheet data path. An exact full-menu requirement needs explicit acceptance, not a test that assumes every raw row renders.

Sparkling Marg was already stored as a shot in `site_harvest.jsonl:123`; the bundle carries that category. The crawler's tequila keyword is a possible mechanism because its cocktail vocabulary may miss abbreviated Marg. The stored ledger lacks the original near-price snippet, so this source lead does not justify relabelling generated records from their names. Inspect an authorised publisher capture and reproduce the actual classification before repair.

Next proof: open the real base venue in a fresh owned local browser, record its API responses and visible price/serving/date/source fields, and retain absent-state evidence. Preserve separate community claims and unknown measures. No fabricated price, silent curated promotion or direct generated-data edit.
