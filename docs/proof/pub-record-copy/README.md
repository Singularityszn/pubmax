# Grounded pub copy

Gemini wrote one or two sentences of free prose and chose one to three vibe
tags for 585 of the 1,916 curated pubs in the stored London price dataset.
Another 65 pubs with supported facts failed the claim check twice and are
listed as `invalid-copy-after-retry`. The other 1,266 pubs have no fact the
summary may state, so they get no copy and are listed as
`insufficient-stored-facts`. Country-wide base pubs and non-pub anchors are
outside this pack.

The model saw a venue ID, its borough and its supported amenities: cocktails,
alcohol-free options, live music, pub quiz, darts, pool, happy hour and
karaoke. Food, live sport and beer garden were left to the Overview chips, so
the summary never repeats them. Names, free text, prices, hours, URLs and
Google Places content were excluded. No page, Places or search request was made.

Publication checks claims, not wording. The prose may name only the pub's
supported features, each once, with a verb that fits: nobody catches a
cocktail, and "a pub quiz with darts" fails. A closed feature list rejects any
other feature, including the three Overview chip facts. The word before a
feature may only introduce it, so "strong cocktails", "two pool tables" and
"cheapish cocktails" fail; after "<feature> is" only a presence word may
follow, so "the cocktails are strong" fails. A past-tense governing verb is a
lapse unless passive ("hosted live music" fails, "cocktails are served here"
passes). Class lexicons reject denial, lapse, hedge, frequency, schedule, mood,
quality and superlatives, reputation, age, crowd, price and quantity words.
They are lists, so a claim worded outside them and away from a feature can
still pass. No proper noun may appear except the borough and London, and
neither may lead a sentence: "Camden has cocktails" and "The City of London
pub" fail. The detail reader runs the same check against current pub fields,
so a removed supporting amenity suppresses the old copy.
Every eligible pub was regenerated at temperature 0.7 under the claim check.
Later rounds tightened it and regenerated only the rows it newly rejected
through the checkpoint: nine, then fourteen. Openings vary: the most common
two-word starts are "You can" (82), "This place" (81) and "Fancy a" (74), and
513 of 585 descriptions are distinct.

Cumulative token-metered spend is USD 0.1393247 over 932 requests. That
includes USD 0.1007636 over 548 requests from earlier rounds, three 30-pub
samples used to tune the prompt and claim check, the full regeneration, which
projected USD 4.7380852 before calling, and the nine-row and fourteen-row
reruns, which projected USD 0.2044006 and USD 0.2458473. None met a quota
response, so all stayed on the global endpoint. This is API-usage accounting,
not an invoice. No quota override was changed. The task cap was USD 15.

## Before and after

Before this change the selected-pub API had no `recordCopy`, and George's
Overview tab showed its address and actions only. George's stored fields hold
food and a beer garden alone, both already shown as chips, so it now
[returns no copy](api-after-skipped.json). The Yorkshire Grey has cocktails,
live music and happy hour on record, and now returns and shows:

> Happy hour runs here, and they also serve cocktails and have live music.

Its tags are Happy hour, Cocktails and Live music.

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

`npm run generate:pub-copy -- --check` validated all 585 entries and the
documented reason for all 1,331 skips. Focused tests exercise the CLI,
grounding, each review probe as a rejection (unsupported features, negations,
mood, reputation, lapse, hedge, schedule, price and quantity claims, feature
modifiers, borough subjects and misfit verbs), durable spend reservations and
their release on the next run, unbilled non-JSON error pages, per-pub
retention and retry, skip coverage, exponential quota backoff and the move to
`europe-west2`, the server reader and the rendered summary. They
also read the published pack through the existing detail lookup. Runtime
tracing includes the generated JSON. At 1440, 390 and 320 pixels the summary
showed with no document horizontal overflow.
