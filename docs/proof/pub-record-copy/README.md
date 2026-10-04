# Grounded pub copy

The Gemini run published descriptions and one to three factual vibe tags for all
1,916 curated pubs in the stored London price dataset. No pubs were skipped.
884 records support only the pub type and borough sentence; their copy stays
that short. Country-wide base pubs and non-pub anchors are outside this pack.

The model selected exact offered sentences and tags from structured pub fields.
Names, free text, prices, hours, URLs and Google Places content were excluded.
The detail reader validates those selections again against current pub fields.
A removed supporting amenity suppresses the old copy.

The dry run projected USD 7.9518851 including worst-case HTTP retries and an
individual grounding retry for every pending pub. Cumulative token-metered
spend was USD 0.0496627 over 197 requests, including earlier billed validation
failures. This is API-usage accounting, not an invoice. No quota override was
changed and no Places request was made. The task cap was USD 15.

## Before and after

The existing selected-pub API had no `recordCopy` before generation. The Overview
tab showed its address and actions, with no generated description or vibe tags.
The same George pub now returns and shows:

> Pub in Bexley. Serves food. Has a beer garden.

Its tags are Pub, Food served and Beer garden. The pack stores the selected
sentences as grounding evidence; its source-file hash records the exact input.

| Proof | Before | After |
| --- | --- | --- |
| Selected-pub API | [Before](api-before.json) | [After](api-after.json) |
| Desktop, 1440 by 1000 | [Before](before-desktop.png) | [After](after-desktop.png) |
| Phone, 390 by 844 | [Before](before-mobile.png) | [After](after-mobile.png) |

Screenshots use a local production build on private port 34716. They prove the
local integration, not a deployment. The pub's existing photo placeholder stays
visible; no Google photo was stored as evidence.

## Checks

`npm run generate:pub-copy -- --check` validated all 1,916 entries with zero skips.
Focused tests exercise the CLI, grounding, durable spend reservations,
per-pub retention and retry, skip coverage, exponential quota backoff, the
server reader and rendered summary. They also read the published pack through
the existing detail lookup. Runtime tracing includes the generated JSON.

`npm run verify` passed, including 19,283 passing coverage tests and the separate
PostgreSQL proofs. Lint had zero errors. Its existing complexity warnings and
narrow dev-only audit waiver remain. The freshness gate reported three store
feeds unmeasurable without credentials; it did not report those feeds fresh.
The isolated production build passed and its venue-route trace contains the
copy pack. Browser checks at 1440, 390 and [320 pixels](after-mobile-320.png)
showed the grounded summary with no document horizontal overflow.
