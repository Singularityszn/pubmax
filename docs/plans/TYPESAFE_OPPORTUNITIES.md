# TypeSafe opportunities in PubMaxing

Scope: read-only survey of `lib/`, `scripts/` and `app/api/` on 20 Sep 2026 (branch `fm/pubmax-map-gl-retry-red-on-main`, same tree as main for these files). Each entry names a place where the app makes a semantic judgment with regex tables, keyword lists or hand-tuned thresholds, and shows how a small TypeSafe System One judgment (Choice, Noul or Score) would stand in for the fragile part while code keeps the candidates, rules and side effects.

Ground rules taken from the TypeSafe docs:

- Code finds candidates; the model selects. Never ask the model to generate a value. Every Choice carries a "none of these" option.
- Ask one narrow judgment per question. Batch independent questions over the same state in one call.
- Thresholds on probabilities are product policy and live in code, evaluated on our own fixtures.
- Judgments are typed but not true: keep an evaluation set and a human review lane for the uncertain band.

## Integration shape (applies to every item)

- SDK: `npm install @typesafe-ai/sdk`; client reads `TYPESAFE_API_KEY`. Server side only.
- One module, `lib/ai/typesafe.server.ts`, wrapping `TypeSafeClient.systemOne` with timeout, redacted logging (`lib/log.ts`) and route timing (`lib/routeObservability.ts`).
- Spend fence: add a `typesafe` lane (or per-feature lanes) to `PAID_SPEND_LANES` in `lib/paidSpendBudget.ts`, and to the lane-to-file map pinned by `__tests__/paidSpendBudget.test.ts`, or CI fails.
- Keyless law: `npm run dev` must work with no secrets. Request-path uses keep the current deterministic code as the no-key fallback; harvest and build scripts may require the key and refuse to run without it.
- Pure harvest modules (`lib/harvest/ukPriceCrawl.ts`, `chainMenuPrices.ts`, `venueEvents.ts`, `chainDeals.ts`) stay pure. They already return candidates plus drop reasons; the CLI layer that does the fetching is where the judgment call goes, exactly as fetching is kept out of them today.
- Fixtures already exist for most of these (`__tests__/fixtures/whats_on/*`, harvest fixtures, `venueCanonicalization` tests). Reuse them as the evaluation set and record per-question probabilities so thresholds are chosen from data.

## Tier 1: highest stakes, best fit

### 1. Pub-website pint price extraction
`lib/harvest/ukPriceCrawl.ts:117-405`, plus the duplicate extractor in `scripts/lib/tavilyPubEnrichment.mjs:216-277` and the chain one in `lib/harvest/chainMenuPrices.ts:39-77`.

Today: every `£n.nn` on a page is classified by a 12-row ordered regex table with hardcoded brands, a nearest-word distance, a food-word blacklist, an offer-word blacklist, and special cases for halves, bottles and mixers. The file's own comments record the production misfires it was patched around (a "2 for £9" happy hour published as a pint price on 27 pubs; "Britvic Bitter Lemon £7.25" filed as a pint).

TypeSafe shape (pre-parsed value extraction cookbook): keep `PRICE_PATTERN` as the over-finding candidate finder. For each figure send state `{pubName, pageUrl, snippet: text ±120 chars, priceText}` and ask, in one batched call:
- Choice `whatIsPriced`: options `draught pint`, `half pint`, `bottle or can`, `wine glass`, `spirit or cocktail`, `soft drink or coffee`, `food or meal deal`, `not a menu price` (page furniture, delivery, offer copy).
- Noul `isPromotionalPrice`: "Is this figure a promotional, happy-hour, bundle or 'from' price rather than the standard price?"
- Choice `drinkCategory` over the app's closed `lib/drinks.ts` categories plus `unclear`, asked only when `whatIsPriced` is a drink.
Code keeps the plausibility bands, the verbatim check and the drop-reason log. Publish only when `whatIsPriced = draught pint` has probability above a threshold set on the fixture corpus, and route the middle band to the existing review lane. Result: one extractor instead of three, and new brands or serve phrasings stop being regex edits.

### 2. Pub Pal sobriety and get-home fence
`lib/pubPalLlmFence.ts:5-24`, used on every `/api/pub-pal/llm` POST.

Today: two long alternation regexes decide whether a message is a sobriety or get-home question and force the fixed safety register. "Can I drive?", "have I had too many?", "safe to cycle back?" all slip past and get freestyle model prose.

TypeSafe shape: one Noul per concern over `{message, recentTurns}`: "Is the user asking whether they are fit to drive, cycle or otherwise travel after drinking?" and "Is the user asking how to get home tonight?" Fire the fixed register when either probability clears a low threshold (a false positive costs a duller answer; a false negative is a harm). Keep the regex as the keyless fallback. This is the strongest single case in the repo because the failure mode is safety, not ranking quality.

### 3. Same-pub identity for canonicalisation and joins
`scripts/lib/venueCanonicalization.mjs:163-195` (`namesLikelySamePub`), and the four other normalisers that answer the same question: `scripts/lib/heritageMatch.mjs:26-105`, `scripts/lib/areaNewsMatch.mjs:46-64`, `scripts/lib/openPubs.mjs:271-430`, `lib/tonight.ts:171-217`.

Today: token-subset rules with a generic-word set and distance gates. The rule explicitly knows that "Bell" and "Bell and Crown" must not merge while "Kings Head" and "Kings Head Tavern" must. That distinction is semantic. A wrong merge silently rewrites `venue_id_aliases.json` and repoints pint drops and saved plans.

TypeSafe shape: code keeps the cheap gates (distance under 120 m, shared tokens) to build candidate pairs, then asks one Noul per pair over `{a: {name, address, operator, website}, b: {...}, distanceMetres}`: "Are these two records the same physical pub?" Merge above a high threshold, refuse below a low one, and write the middle band to a review file for the captain. The NHLE case ("Stables in rear yard of the Duke of Hamilton PH, public house not included") becomes a Noul over the listing text: "Does this listing describe the pub building itself rather than an adjacent structure?" replacing the 40-word `STRUCTURE_DENY` set.

## Tier 2: request-path intent and routing

### 4. Ask router tool selection
`lib/ask/router.ts:12-299`.

Today: twelve top-level regexes with a hand-ordered precedence cascade and negative guards; venue names are whatever text survives `stripIntentWords`. Every new tool must be de-conflicted against every regex.

TypeSafe shape (intent routing plus function calling cookbooks): one Choice over the tool set plus `none`, and speculative branch-specific questions in the same call: Choice `venue` over the top N venue candidates found by code (substring hits, nearby venues, recently viewed), Choice `area` over known areas plus `none`, Noul `wantsMap`. Code consumes only the answers on the chosen branch. The regex cascade stays as the keyless fallback.

### 5. Concierge intent parsing
`lib/concierge/intent.ts:24-78` deterministic path, `lib/concierge/whatsOn.ts:32-99`.

Today: eleven mood regexes, a number-word table, a lookahead-terminated area regex, and `cheap` hardcoded to £6. There is already a model path; its `validateModelIntent` (require the area verbatim in the user text) is the right pattern and should be kept.

TypeSafe shape: over `{text, knownAreas, moods}` ask Noul per mood (several may apply), Choice `area` over the areas that appear in the text plus `none`, Choice `groupSize` over the numbers found in the text plus `unstated`, Choice `budgetSignal` over `explicit figure`, `cheap`, `unstated`. Replaces prompt-then-parse-JSON with typed answers and removes the second OpenRouter call.

### 6. Venue resolution by name in Ask tools
`lib/ask/tools.ts:76-87` (`matchVenueByName`), used by heritage, prices, journey and map-action tools.

Today: exact, then `startsWith`, then `includes`, sometimes fed the raw user query, so any substring of a pub name wins and array order decides ties.

TypeSafe shape: code collects every venue whose name shares a token with the query (bounded, say 12), then Choice `intendedVenue` over those candidates plus `none`, with state `{query, candidates: [{name, area, address}]}`. Same pattern serves `lib/tonight.ts` event-to-venue matching and `lib/whatsOn.ts:257-282` listing dedupe ("are these two listings the same event?" as a Noul).

## Tier 3: harvest classification

### 7. What's-on listing kind and structure
`lib/harvest/venueEvents.ts:41-277`, `scripts/whatson/quizParsers.mjs`.

Today: eleven kind regexes into four buckets (quiz, music, sport, deal); comedy nights and supper clubs are dropped; one date shape is understood.

TypeSafe shape: keep the block splitter and the date and time resolvers in code (date arithmetic belongs in code). Ask Choice `kind` over the four kinds plus `other` and `not an event`, and Noul `isRecurringWeekly`. Add `other` as a real bucket so the drop log shrinks.

### 8. Chain deals and sister brands
`lib/harvest/chainDeals.ts:24-325`.

Today: a hardcoded ten-entry sister-brand list decides whether an offer belongs to the pub's brand; the schedule must sit on one line.

TypeSafe shape: Noul `appliesToThisBrand` over `{offerText, pubOperator, pubBrand}` and Choice `dayWindow` over candidate day words and time spans found by regex on the surrounding lines plus `none`.

### 9. Operator website and opening hours
`lib/harvest/pubFacts.ts:128-240`.

Today: a 30-host deny list decides whether a search hit is the pub's own site (the comment records `ciuclub.co.uk` slipping through); opening hours must match one line shape under 48 characters.

TypeSafe shape: Noul `isOperatorSite` over `{pubName, address, resultTitle, resultUrl, snippet}`; for hours, code finds every day word and clock in the page, then Choice per weekday over the candidate time spans plus `closed` and `unstated`.

### 10. Menu link discovery and page-level gates
`lib/harvest/ukPriceCrawl.ts:419-464, 490-554`.

Today: 13 include terms and about 30 exclude terms judge a link from its text alone; a page is "a drinks list" when at least four kept lines outnumber food lines; a pub with a short name cannot be priced on an estate host.

TypeSafe shape: Noul `linkLeadsToDrinksList` over `{linkText, href, pubName}` for the capped candidate set; Noul `pageIsThisPubsDrinksList` over `{pubName, address, pageTitle, url, firstLines}`.

### 11. Night-signal and area-news attribution
`scripts/ingest_night_signal_candidates.mjs:51-196`, `scripts/lib/keenableAreaNews.mjs:241-257`.

Today: a 20-slug term table takes the longest whole-word hit; `isPubRelevant` is nine keywords; news kind is five regexes in fixed order.

TypeSafe shape: Choice `nightArea` over the slug list plus `none`, Noul `isAboutPubs`, Choice `newsKind` over `opening, closure, refurb, award, threat, other`, all in one call per article. Human review stays; its queue gets cleaner.

## Tier 4: ranking and tags

### 12. Concierge venue ranking weights
`lib/concierge/rank.ts:92-213`.

Today: hand-tuned integers (area +30, garden +12, live music times 8) with no evaluation loop.

TypeSafe shape (composite scoring pattern): score each venue once per mood dimension with Score questions over the venue's own text and facts ("how well does this pub suit a quiet chat?", levels described concretely), store the scores in the build output, and keep the weights in code where the captain can tune them without re-inference. Judgments become reusable data; the request path stays free of model calls.

### 13. Cuisine and vibe tags from venue text
`lib/cuisineTags.ts:11-123`, `scripts/build_slim_index.mjs` (`HERITAGE_TERMS`, `WATER_TERMS`, `NA_BRANDS`), `lib/drinkCategoryFromText.ts:36-240`.

Today: keyword hits on names and descriptions ("The Pie & Pint" gets `pie`), plus a 37-entry curated override map that must be re-verified on every dataset rebuild.

TypeSafe shape: at build time, one Noul per tag over `{name, description, menuSnippet}`; keep the curated map only for captain overrides. For drink labels, one Choice over the closed category list plus `unclear`, shared with item 1 so the repo has one drink vocabulary.

## Tier 5: replace prompt-then-parse with typed answers

### 14. Moderation adapters
`lib/profileAvatarModeration.ts:28-60`, `lib/socialPostModeration.ts:32-84`.

Today: prompt for `{"flagged": true|false}` then a three-step tolerant JSON extraction (raw, fenced, brace slicing). A parse failure decides whether a post or avatar publishes.

TypeSafe shape (LLM guardrails cookbook): several Nouls over the text ("contains a slur or harassment", "contains contact details", "advertises a business", "is off-topic for a pub feed"), thresholds per rule in code, an "any serious violation" rule kept separate from weighted preferences. Image moderation stays on the vision endpoint.

### 15. Heritage answer verification
`lib/heritage.ts:234-311`.

Today: numbered facts, a model answer, and a regex over `[F\d+]` markers as the only hallucination check. A paraphrase that cites nothing passes.

TypeSafe shape (citation check cookbook): after generation, split the answer into sentences in code and ask Noul `isSupportedByFacts` per sentence over `{sentence, facts}`. Drop or flag unsupported sentences before caching. This is the cheapest way to make "fail closed to grounded answers" true rather than asserted.

## Not candidates

Kept in code on purpose: date arithmetic (`nextWeeklyOccurrence`, `resolveEventDate`), postcode parsing, HTTPS and URL checks in `lib/harvestFold.ts`, the em-dash lint in `lib/areaNews.ts`, plausibility price bands, haversine gates, the `sourcePolicy` and `robots` fences. These are exact rules, not judgments.

## Recommended first three

1. Item 1, pint price extraction: batch path, highest stakes, fixtures exist, cookbook fits exactly, and it retires three divergent extractors.
2. Item 2, Pub Pal safety fence: one Noul, request path, immediate harm reduction, trivial fallback.
3. Item 3, same-pub identity: one Noul with a review band, protects the venue id space every other feature keys on.

Each starts with a fixture run that records probabilities before any threshold is chosen.
