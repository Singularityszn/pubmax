# Governed priced landings

Three crawlable page families answer one question from PUBMAXX Pint Price
evidence: what a pint costs, by beer, by part of London, or both.

- `/drink/{brand}` - cheapest listed pints of one brand across London.
- `/area/{area}/drink/{brand}` - the same question inside one Night Area.
- `/area/{area}` - the cheapest listed pint at each pub in one Night Area.

## The area root: `/area/{area}`

Captain decision, 30 Oct 2026 (SEO audit #2126, finding 17). It was held
because an area page looked like a copy of `/borough/{slug}`. A Night Area is
not a borough: Soho is part of Westminster, and Shoreditch spans four boroughs.

- A London Night Area has a page when it holds **15** priced pubs
  (`PRICED_LANDING_PUBLICATION_FLOORS.area`). Each pub counts once, at its own
  cheapest listed pint. Only pub venue kinds, only finite positive prices.
- The floor is the ONLY gate. A price list is not a route, so no route
  readiness review gates this page. `lib/areaLanding.ts` owns the rule.
- The page prints the ranked list, publisher per row, count, the area's
  stations from `transportAnchors`, and its published brand-by-area pairs.
  Its headline price and metadata carry that price row's source-read date.
  A missing date says `Source read date unknown`.
  The summary dates the oldest source read only when it differs from the headline's displayed day.
  It also omits that summary date when any displayed row has no read date.
- Each row keeps the pub's recorded borough.
  A row assigned through the nearby-area claim adds `, near {area name}` unless its borough matches the area's name or an alias.
  `venueAreaClaim` supplies that claim. Regression case: `__tests__/areaLanding.test.tsx`.
- Its map arrival is `mapAreaHref` (`/map?area={slug}`), never `?q=`.
- A name or alias of a published area redirects to that area's page. A known
  area below the floor still redirects to its map area. Unknown or ambiguous
  names return 404. Regression cases: `__tests__/areaRedirect.test.ts`.
- The page is prerendered and held by the CDN (`proxy.ts`
  `CDN_CACHED_DOCUMENT_ROUTES`), with an hour's ISR window. Every name the
  page answers is a static param, so each redirect is prerendered too and an
  unknown name is a 404 with no render. A read that finds no venues throws,
  so a failed read keeps the last good copy and never caches a redirect.
- Published area pages are in the sitemap. Borough pages link each area page
  that holds five or more of the borough's priced pubs
  (`lib/boroughNeighbourhoodLinks.ts`).
- The brand-by-area page's parent crumb is still the brand's own London page.

## What a page may claim

- Every figure comes from the exact price row that owns it.
- The publisher label and link come from that same row through
  `namedLegacyPintPriceSource`. A row with no publisher reads
  `Publisher not recorded` and carries no link.
- On beer pages, `PINT_DATASET_OBSERVED_AT` prints once as shared collection
  context. It is never described as live, current, updated, or a per-row observation.
  The [area-root contract](#the-area-root-areaarea) owns the area page's source dates.
- The count says how many pubs cleared the floor, and discloses the cap
  ("Showing 20 of 347 pubs") whenever the page prints fewer than it counted.
- Nothing here is a community submission, and nothing here reaches map
  authority. Community prices still travel through identity, corroboration,
  freshness and moderation.

## Which pages exist

- Brands come from `DRINK_BRAND_LANDING_CATALOG` in `lib/drinkBrandLanding.ts`:
  the map lens beers (`DRINK_BRANDS.beer`) first, then every canonical draught
  pint in `lib/beers.ts` the lens lacks. The landing card matches its pint
  against that catalogue with the page's own matcher and links it only when
  the page publishes. Areas come from `NIGHT_AREAS`.
- A brand page needs 20 pubs with a valid matching row. An area root needs
  15 priced pubs of any pint. A brand-by-area page
  needs 10, AND its brand's own London page must publish: that page is its
  parent crumb, so a pair without one would link a reader to a 404.
- A brand-by-area page needs no area review. Its separate area estimate follows
  the [public estimate method](https://pubmaxxing.com/how-we-estimate).
  `sampleSize` equals `totalPricedVenues`. The newest valid candidate
  source-read date supplies `computedAt`. Without a valid date, the page omits
  the estimate. The figure links to `/how-we-estimate`. It is never a ranked
  row or a headline `From` price.
- One pub counts once, at its own cheapest matching row.
- Only pub venue kinds, only finite positive prices.
- Ranked cheapest first, then pub name, then pub id. At most 20 rows printed.
- Anything unpublished is a 404 with `noindex, nofollow` metadata, absent from
  static params and absent from the sitemap.

## Where the page sends a reader

- `/drink/{brand}` primary: `/map?brand={brand}`. `decodeDrinkLens` already
  fills the category from the brand, and `PubMap` excludes beer from the
  selected lens, so `?drink=beer` would not select a lens. `findBrand` resolves
  the whole of `lib/beers.ts` after the map lens catalogue, so every brand this
  family publishes re-prices the map it opens.
- `/drink/{brand}` secondary: `/map?sel={venueId}&brand={brand}&log=1`, because
  `log=1` opens that pub's composer when the map resolves it. Without a resolved
  pub, it opens the pub picker.
- `/area/{area}/drink/{brand}` primary: `/map?sel={cheapest venueId}&brand={brand}`.
  Never `?q={area name}`: `q` is a free-text venue filter, so an area name
  narrows the map to whatever pubs happen to carry those words, and
  "Piccadilly & Soho" matches none.
- A `sel` names only a pub the MAP can open. The slim index is sharded and the
  map loads the eager core shard first, so the London brand page's log arrival
  takes the cheapest row inside that shard, which is not always rank 1, and the
  brand-by-area page's arrivals keep their own row or drop `sel`. With no such
  pub, and with an eligibility read that could not answer, the link carries the
  brand alone rather than naming a pub the map would discard. The ranked list
  itself never moves for a link.
- The WORDS follow that same decision. The brand-by-area arrival says "Open the
  cheapest {area} pint on the map" only while it names a pub, and says "Find
  {brand} on the map" when it does not, because a brand-only href is London, not
  the area. One decision answers both (`pricedLandingAreaMapCta`), so the two
  cannot drift.
- Each row: its own `/ledger/{venueId}`, and on the brand-by-area page its own
  log arrival (`pricedLandingLogCta`). "Log this price" only while the href
  names that pub; otherwise "Log a {brand} pint price".
- `/drink/{brand}` lists the published `/area/{slug}/drink/{brand}` siblings
  for that brand, so the pair family is not sitemap-only.

## Surface

- One H1, one immediate `From {price}` answer, the publisher status, the count
  and the date required by [the page claim rules](#what-a-page-may-claim),
  all above the fold at 320, 390 and 430 CSS pixels.
- One cheapest-first list. The rank is presentational: the ordered list already
  carries position, and a name on a bare span is dropped by assistive tech.
- A row prints its own drink tag, title-cased when the dataset shouted it. The
  known all-caps beer tokens (IPA, NEIPA and the rest) keep their capitals.
- London brand rows also show the recorded branch address, or the recorded
  locality when the address is blank. The ledger link's accessible name
  includes that text. Without either value, the row keeps its pub name and borough.
- Every action is at least 44 by 44 CSS pixels and shows visible focus.
- No horizontal page scroll. Light and dark use existing tokens.
- Bottom padding carries `env(safe-area-inset-bottom)`, so phone navigation
  cannot cover the last row.

## Rejected

- A page for every borough: borough membership is broader than night-out
  intent and would multiply weak pages.
- Publishing thin combinations to grow URL count.
- A derived figure used as a ranked price, headline `From` price or structured price offer.
