# Map URL parameters

This page lists every query, hash, and route parameter that the map honours.
Each parameter has one owner file. Read that file for the exact logic.

The map builds its state from the URL in layers:

- `lib/crawlUrl.ts` decodes and encodes the crawl-planner state (`mode`,
  `style`, filters, `pubs`, `sel`, and more) as one unit.
- `components/map/useCrawlUrl.ts` writes that encoded state back to the
  address bar on a 300 ms debounce, and carries a fixed set of "owned
  passthrough" params through each rewrite so they do not get dropped.
- `lib/explicitMapIntent.ts` composes several of the predicates below to
  decide if an arrival is intentional enough to suppress first-run
  onboarding.
- `lib/mapFirstVisitArrival.ts` adds the planner handoff params to that
  answer for the first-visit arrival card. See "First-visit arrival card"
  below.
- A few params are read directly with `searchParams.get(...)` outside the
  crawl-planner system, in `components/PubMap.tsx` and
  `components/map/pubmap/useMapSurfaceNavigation.ts`.
- `app/map/page.tsx` and `app/map/[city]/page.tsx` read `place`, `lat`,
  `lng`, `band`, `crawl`, and `pubs` on the server, mainly to build page
  metadata and the Open Graph image.

The city that loads is selected by the Next.js route segment (`/map/[city]`).
The `/map` route loads London. Crawl-state rewrites preserve the pathname.

## History and filter synchronisation

`useMapSurfaceNavigation` owns the map's sheet history. When Back, Forward,
or Home traverses related sheet entries on the same pathname, it calls the
synchronisation callback returned by `useCrawlUrlSync`. That callback cancels
pending debounced writes and copies the current crawl filters, ordered stops,
and crawl identity onto the landed URL in one replacement. An edited route
clears the old `crawl` identity so reload restores its `pubs` instead. While
arrival hydration is pending, an incoming `crawl` survives until the map can
resolve it. Selection, contribution intent, place context, and the
hash stay with the landed entry, so a closed venue is not reopened by a stale
write. This also applies when reopening an earlier sheet produced a trail of
the same length.

Separate route visits and earlier root entries keep their own URLs. A clean
arrival restored from a saved session stays clean until the reader changes
the crawl state. Regression cases live in
[`mapCrawlUrlSync.test.tsx`](../__tests__/mapCrawlUrlSync.test.tsx).

## Fail-soft for an unknown `?sel=`

An unknown `sel` value never breaks the map. `lib/pubMap.ts` computes a
`MapSelectionNotice`. When the venue lookup returns "missing", the map shows
the notice `"That pub is not one we know."` (`UNKNOWN_MAP_SELECTION_NOTE`).
When the lookup itself fails, it shows `"We could not check that pub right
now."` (`MAP_SELECTION_LOOKUP_FAILED_NOTE`). Either way, the map stays open
and the reader can dismiss the notice.

A UK base pub id (`venue-uk-*`) needs no `at` hint to open. Without one, the
cold restore asks `/api/uk-base/[id]` for the record. An id that the pack does
not hold and that no venue alias owns shows the unknown notice and drops
`sel`. A lookup that fails keeps `sel` with the sheet shut and shows the
could-not-check notice, so a reload asks again (`ukBaseRestoreFor` and
`ukBaseRestoreFailureNotice` in `lib/pubMap.ts`).

## First-visit arrival card

After the pins reveal, a first visit to the map shows one arrival card
(`components/map/MapArrivalCard.tsx`). Any answer holds it back on that
device for 30 days. The answer is kept in `localStorage` under
`pubmax:map-first-visit-arrival:v1` as `dismissed:<epoch ms>`; the bare
`dismissed` that earlier builds wrote never expires (`lib/mapFirstVisitArrival.ts`).

`searchSuppressesMapFirstVisitArrival` (`lib/mapFirstVisitArrival.ts`) holds
the card back for an arrival that already has its own question. It is
`searchHasExplicitMapIntent` (a deep-linked venue, query, place, crawl, and
the other intentional arrivals in `lib/explicitMapIntent.ts`) plus the three
planner handoff params `query`, `occasion`, and `describe`
(`lib/planOccasion.ts`). The map honours those three only here: it reads
their presence to stay quiet, never their values.

While the card is on screen, the analytics consent prompt stands down. See
[`docs/PROMPT_ORCHESTRATION.md`](PROMPT_ORCHESTRATION.md) for that contract.

## Parameter table

| Param | Values | Owner file | What it does | Decode fallback behaviour | Round-trip |
|---|---|---|---|---|---|
| `mode` | `suggest` (default) or `build` | `lib/crawlUrl.ts` | Sets the crawl planner to suggestion mode or build mode. | Any other value is ignored. The state stays `suggest`. | Yes. `encodeCrawl` writes it back on every crawl-state change (debounced, `components/map/useCrawlUrl.ts`). Omitted when it is the default `suggest`. |
| `style` | One of `balanced`, `cheapest`, `heritage`, `writerTrail`, `beerGarden`, `sports`, `dateNight` | `lib/crawlUrl.ts` | Picks the crawl-style filter preset. | A value outside this set is ignored. No style is applied. | Yes, same debounced sync as `mode`. |
| `max` | Number | `lib/crawlUrl.ts` | Sets the maximum pint price filter. | Clamped to 4 to `NO_PINT_PRICE_CAP`. A non-numeric value is ignored. | Yes, same debounced sync. |
| `stops` | Number | `lib/crawlUrl.ts` | Sets the number of crawl stops. | Clamped to 4 to 7 and rounded. | Yes, same debounced sync. |
| `win` | Number | `lib/crawlUrl.ts` | Sets the crawl time window, in minutes. | Clamped to 15 to 30. | Yes, same debounced sync. |
| `drops` | `1` | `lib/crawlUrl.ts` | Requires venues with a live Pint Drop. | Only `1` turns the filter on. Any other value or absence leaves it off. | Yes, same debounced sync. Omitted when off. |
| `low` | `1` | `lib/crawlUrl.ts` | Requires a non-alcoholic option at each stop. | Only `1` turns the filter on. | Yes, same debounced sync. Omitted when off. |
| `cocktails` | `1` | `lib/crawlUrl.ts` | Requires a cocktail option at each stop. Also set implicitly when `drink=cocktail` or a matched cocktail brand is present. | Only `1` turns the filter on. | Yes, same debounced sync. Omitted when off. |
| `food` | `1` | `lib/crawlUrl.ts` | Requires a food option at each stop. | Only `1` turns the filter on. | Yes, same debounced sync. Omitted when off. |
| `q` | Free text | `lib/crawlUrl.ts` | Free-text search query. | Trimmed and cut to 80 characters. Omitted when empty after trim. | Yes, same debounced sync. |
| `drink` | A drink category id, or `low-no` / `non-alcoholic` | `lib/crawlUrl.ts` | Sets the drink-category lens. `low-no` and `non-alcoholic` also turn on the non-alcoholic filter and imply the mocktail alt style. | Parsed by `parseDrinkCategoryParam` (`lib/drinkBrands.ts`). An unmatched value leaves no category set. | Yes, same debounced sync. Only encodes a category allowed on the map (`isMapLensDrinkCategory`, `lib/drinks.ts`, excludes `other`). The default Beer lane is omitted. A valid completed unrefined Beer share (not a drink-shape arrival under `isDrinkShapeArrival`, `lib/mapArrival.ts`) reopens mapped and keeps explicit `drink=beer` through initial curated catalogue resolution. A later plan change releases it. The Food and No-alcohol views stand the drink filters down, so the synced URL drops `drink`, `sub`, `brand` and `topshelf`. The route header Copy link puts back the drink held when the reader left All (`linkWithMapPlanDrinkSelection`, `lib/mapPlanDrinkPresentation.ts`). |
| `brand` | A drink brand id | `lib/crawlUrl.ts` | Sets a drink-brand filter. A matched brand can also imply its category and cocktail flag when `drink=` is absent or does not match. | Normalised and matched by `normalizeBrandQuery` and `findBrand` (`lib/drinkBrands.ts`). `findBrand` reads the map lens catalogue first, then the canonical draught pints in `lib/beers.ts`, so a beer outside the lens (`pravha`) also resolves and keeps the `beer` category. An unmatched value leaves no brand set. | Yes, same debounced sync. |
| `sub` | A drink subtype id | `lib/crawlUrl.ts` | Sets a drink-subtype filter under the resolved category. | Parsed by `parseDrinkSubtypeParam` (`lib/drinkSubtypes.ts`). Only kept when it agrees with the resolved category. | Yes, same debounced sync. |
| `topshelf` | `1` | `lib/crawlUrl.ts` | Restricts the drink category to top-shelf options only. | Only decoded when a drink category is also resolved. | Yes, same debounced sync. Only encoded when both the flag and the category are set. |
| `zone` | `1` to `6`, or `all` | `lib/crawlUrl.ts` | Filters to a London travel zone. | Parsed by `parseZoneParam` (`lib/zones.ts`). `all` or an unrecognised value means no zone filter. | Yes, same debounced sync. `all` is never encoded. |
| `pubs` | Comma-separated venue ids | `lib/crawlUrl.ts` | The ordered stop list of a built crawl. | Split on comma, trimmed, blank entries dropped. | Yes, same debounced sync. |
| `sel` | A venue id | `lib/crawlUrl.ts` (initial state), `components/map/pubmap/useSelParamSync.ts` (live sync), `components/map/pubmap/useMapSurfaceNavigation.ts` (history owner), `lib/mapSelectionHistory.ts` (URL and sentinel helpers), `lib/venueMapUrl.ts` (deep-link builder) | Selects the inspected venue on the map. | An id that does not resolve to a known venue never breaks the map. See "Fail-soft for an unknown `?sel=`" above. | `useMapSurfaceNavigation` owns selection history. `useSelParamSync` handles incoming client navigation, but leaves already-owned Back and Forward entries to that owner so restoration adds no duplicate entry. |
| `band` | A story-band id | `lib/crawlUrl.ts` | Sets the active story-band. Not checked against the band list in this module; an unknown id simply shows no band elsewhere. | Trimmed only. No validation here. | Yes, same debounced sync. |
| `landmark` | A landmark chapter id | `lib/crawlUrl.ts` | Deep-links to a landmark chapter. | Trimmed only. No validation here. | Debounced crawl sync preserves an active story. Sheet-history restoration clears the parameter when the landed trail contains no story, including after Home. |
| `alt` | One of `pint`, `food`, `coffee`, `mocktail` | `lib/crawlUrl.ts` | Sets the alt crawl style. | A value outside this set is ignored. The state stays the default, `pint`. | Yes, same debounced sync. Omitted when it is the default `pint`. |
| `crawl` | A curated crawl id | `lib/crawlUrl.ts` | Loads a named curated crawl. | Passed through `normalizeCrawlId`: lower-cased, non-alphanumeric runs become a dash, leading and trailing dashes trimmed, cut to 80 characters. Never throws on a malformed id. | Written with the current stops. See [History and filter synchronisation](#history-and-filter-synchronisation) for identity clearing and pending hydration. |
| `log` | `1` | `lib/mapLogIntent.ts` | Arms the legacy Pint Drop composer for a resolved pub, or asks the reader to choose a pub. | Only the exact value `1` counts. Any other value, or absence, is false. | Preserved through crawl-state rewrites while active. Leaving the flow clears it and its `price` seed; dismissal does not block a new request. |
| `contribute` | `price` | `lib/priceContributionIntent.ts` | Requests the selected pub's category price form, or opens the pub picker until a pub is selected. `VenueInspector` handles sign-in and form entry. | Only the exact value `price` requests the flow. It grants no write permission. | Preserves city, drink, and pub through sign-in. Bound to the first opened pub through deselection; form entry, Home, picker dismissal, or another pub outside the restored picker retires it. Back to the held price picker allows a new pub choice. |
| `plan` | `1` | `lib/mapArrival.ts` | Forces the crawl planner drawer open on first paint. | Only the exact value `1` opens the planner from this param. Other values fall through to the ordinary open rules (built stops, `mode=build`, or `style=`/`mode=` present). | Preserved as an owned passthrough param during crawl-state rewrites. |
| `accept` | `1` | `lib/mapAcceptance.ts` | Requests the accepted-arrival receipt for `sel`. URL text is not acceptance authority. | Counts only when `sel`, `src`, city, and a live stored PlanningIntent agree. A forged, mismatched, or expired marker is ordinary browsing. | Preserved while the same Venue remains selected. A switch or pin tap strips `accept` and `src`, so acceptance never leaks to another Venue. |
| `src` | Either an acceptance source (`near`, `map-search`, `tonight`, `pal`) when `accept=1` is present, or a Tonight vertical token (`whats-on-quiz`, `whats-on-sport`, `whats-on-deal`, `whats-on-music`) read independently | `lib/mapAcceptance.ts` (acceptance source), `components/PubMap.tsx` (Tonight deep link) | With a verified accepted arrival, names where acceptance happened. On its own, opens the Tonight lane pre-filtered to that kind, London only. | Acceptance path: must match the stored PlanningIntent and `PLANNING_INTENT_SOURCES`. Tonight path: a value outside the four vertical tokens opens no forced lane. | Preserved with the verified same-Venue arrival. The Tonight lane can also be dismissed per value (`dismissedTonightSrc`). |
| `at` | `<lat>,<lng>`, 4 decimal places | `lib/mapSelectionHistory.ts` | Carries a UK base pub's rounded coordinates alongside `sel`, so a shared or reloaded link knows which shard cell to stream and where to centre the camera. | Malformed input (wrong part count, non-finite numbers, or out-of-range lat/lng) is ignored; the hint is treated as absent. | Preserved as an owned passthrough param. Cleared whenever the selection changes to a non-base pub, so a stale hint never survives a switch. |
| `place` | A UK place name | `app/map/page.tsx`, `lib/ukPlaceSearch.ts` | Resolves an uncovered UK town arrival against the place index, server-side. | Validated by `isPublishableUkPlaceName`. An unresolvable or unpublishable name yields no place arrival. | Preserved as an owned passthrough param on later crawl-state rewrites. Resolved once, server-side, at page load; not re-read by the client after mount. |
| `lat` | Number | `app/map/page.tsx`, `lib/ukPlaceSearch.ts` | Latitude for a `place` arrival. | Parsed with `Number()`. A non-finite value means no place arrival. | Same as `place`. |
| `lng` | Number | `app/map/page.tsx`, `lib/ukPlaceSearch.ts` | Longitude for a `place` arrival. | Parsed with `Number()`. A non-finite value means no place arrival. | Same as `place`. |
| `uk` | `1` | `lib/ukNationalBrowse.ts`, `app/map/page.tsx` | Explicit UK national browse. Opens a quiet whole-UK overview; pubs appear when you zoom past the base gate (z12). Softens priced-city chrome. | Only exact `1` counts. Combined with a valid `place` arrival, place wins. | Preserved as an owned passthrough param on crawl-state rewrites. |
| `mapNotice` | `unknown` or `lookup-failed` | `lib/pubMap.ts`, `components/PubMap.tsx`, `components/map/useCrawlUrl.ts` | Carries a map-owned venue-selection notice, such as the unmatched-venue fallback from a Pal card. It never selects a venue. | Other values are ignored. | Consumed into the transient notice and removed with `history.replaceState` after the notice mounts; carried through crawl-state rewrites until then. |
| `city` (route segment, not a query parameter) | A known city id | `lib/cities.ts`, `app/map/[city]/page.tsx` | Selects which city's map loads. | `parseCityId` lower-cases and trims the segment. An id outside the known city set returns `null`, and the route responds with `notFound()`. | Not applicable. This is the route path itself, not a value the client rewrites. |

## Read-only server metadata reads

`app/map/page.tsx` and `app/map/[city]/page.tsx` also read `band`, `crawl`,
and `pubs` a second time, server-side, purely to build page metadata and the
Open Graph share image (stop count comes from `stopCountFromPubsParam` in
`lib/cityShare.ts`). This is a read, not a second source of truth: the
client-side decode in `lib/crawlUrl.ts` still owns the live map state.
