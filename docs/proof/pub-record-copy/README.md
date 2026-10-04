# Grounded pub copy

Gemini wrote a one-sentence description and chose one to three vibe tags for
649 of the 1,916 curated pubs in the stored London price dataset. Another
1,266 pubs have no stored fact the summary may state, so they get no copy and
are listed as `insufficient-stored-facts`. One pub failed validation twice and
is listed as `invalid-copy-after-retry`. Country-wide base pubs and non-pub
anchors are outside this pack.

The model saw a venue ID, its borough and its supported amenities: cocktails,
alcohol-free options, live music, pub quiz, darts, pool, happy hour and
karaoke. Food, live sport and beer garden were left to the Overview chips, so
the summary never repeats them. Names, free text, prices, hours, URLs and
Google Places content were excluded. No page, Places or search request was made.

Publication checks facts, not wording. Every word must state a supported fact,
name the pub's borough or London, or be a connective that states nothing. The
sentence must name the pub and at least one supported fact, and no fact may
repeat. The detail reader runs the same check against current pub fields, so a
removed supporting amenity suppresses the old copy.

Cumulative token-metered spend is USD 0.0806508 over 462 requests. That
includes the USD 0.0496627 and 197 requests of the earlier sentence-picking
run, a 30-pub sample used to tune the prompt, a first full run stopped to
tighten the prompt, and runs stopped by quota and authentication responses
then resumed from the checkpoint. The final resumed run projected USD 0.1992889
before calling. This is API-usage accounting, not an invoice. No quota override
was changed. The task cap was USD 15.

## Before and after

Before this change the selected-pub API had no `recordCopy`, and George's
Overview tab showed its address and actions only. George's stored fields hold
food and a beer garden alone, both already shown as chips, so it now
[returns no copy](api-after-skipped.json). The Yorkshire Grey has cocktails,
live music and happy hour on record, and now returns and shows:

> This Camden local has cocktails, live music and happy hour drinks.

Its tags are Cocktails, Live music and Happy hour.

| Proof | Before (George) | After (The Yorkshire Grey) |
| --- | --- | --- |
| Selected-pub API | [Before](api-before.json) | [After](api-after.json) |
| Desktop, 1440 by 1000 | [Before](before-desktop.png) | [After](after-desktop.png) |
| Phone, 390 by 844 | [Before](before-mobile.png) | [After](after-mobile.png) |
| Phone, 320 by 700 | | [After](after-mobile-320.png) |

Screenshots use a local production build on private port 34716. They prove the
local integration, not a deployment. The pub's photo placeholder stays visible;
no Google photo was stored as evidence.

## Checks

`npm run generate:pub-copy -- --check` validated all 649 entries and the
documented reason for all 1,267 skips. Focused tests exercise the CLI,
grounding, durable spend reservations and their release on the next run,
unbilled non-JSON error pages, per-pub retention and retry, skip coverage,
exponential quota backoff, the server reader and the rendered summary. They
also read the published pack through the existing detail lookup. Runtime
tracing includes the generated JSON. At 1440, 390 and 320 pixels the summary
showed with no document horizontal overflow.
