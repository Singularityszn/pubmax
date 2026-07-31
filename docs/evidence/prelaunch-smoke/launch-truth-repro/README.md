# Launch truth defect reproduction

Reproduced on 31 July 2026 from a fresh signed-out browser. Live-site captures
use the requested 1440x900 and 390x844 viewports. Deterministic MapLibre
reproductions use the real app with only basemap network responses replaced.

## 1. False map-background failure

The current live deployment did not reproduce the toast in this later pass. At
1440x900 I saw a full-size MapLibre canvas with background and pins, and no
`.mapSoftRetry` element. That observation is captured in
`01-map-false-failure-desktop.png`; it is not presented as a failing capture.

I reproduced the reported condition against the pre-fix code using a
deterministic MapLibre style with one visible raster source returning a tile and
one secondary raster source left pending. The canvas rendered. After the
12-second readiness ceiling, `.mapSoftRetry` appeared with:

> Map background couldn't load. Tap Retry to try again.

The pre-fix unit regression failed with a `timeout` reveal where it expected a
`tiles` reveal. The pre-fix Playwright regression failed because
`.mapSoftRetry` had count 1 where it expected 0.

Cause: first-paint success required every tiled source to settle. One painted
source plus one pending source was therefore reported as total background
failure.

The correction-round focused pin-reveal regression recorded the late-paint
recovery lane red before implementation. The current focused suite,
`npx vitest run __tests__/pinRevealCoordinator.test.ts`, covers recovery after
a late first paint plus the separate ownership guard that leaves a genuine
error-owned notice intact. The focused Chromium green,
`PW_SKIP_WEBSERVER=1 npx playwright test e2e/map-gl.spec.ts --project=chromium-gl --grep "does not report a background failure"`,
passed with the primary tile delayed beyond the readiness ceiling and the
secondary source still pending.

## 2. No-alcohol key and cluster paint

Fresh signed-out live passes at 390x844 and 1440x900 reproduced the selected
`No alcohol` state and its two claims:

> No alcohol-free or soft drink prices logged here yet.

> Clusters stay grey because no current venue has a trusted alcohol-free or
> soft drink price.

The supplied live smoke capture `../04-filter-mobile.png` visibly retains green
and amber cluster discs behind those claims.

I reproduced the underlying pre-fix boundary deterministically. A painted
desktop donut survived replacement of the `pubs` source because the sync had no
invalidation operation. Its unit regression failed with zero marker removals.
The source-revision regression also failed before implementation because no
operation coupled MapLibre settlement to key publication.

Cause: cluster paint and key meaning crossed the source boundary on separate
clocks. The key derived from desired GeoJSON immediately. GL paint settled
later, while desktop donuts could retain cached counts from the prior source.

The correction captures one `nextPubsData` revision and tags every feature with
its application revision. Before `setData`, desktop donuts surrender paint.
The coordinator then waits for the worker promise, source settlement, and a
later render before it publishes key state and commits that same revision to
donut reconciliation. Superseded worker completions and source errors publish
nothing. Desktop donut queries ignore features from any other tagged revision,
so old source tiles cannot reactivate stale markers after the new commit.

Proof is deliberately split:

- Mobile rendered-pixel proof: the 390x844 Playwright regression crops the
  exposed map band. While the No-alcohol key says clusters stay grey, it finds
  grey cluster pixels and fewer than ten green or amber price pixels.
- Desktop state-level proof: coordinator tests pin settlement, the render
  boundary, supersession, and source-error suppression; donut tests pin the
  revision fence; rendered-state tests derive the key from committed data.
  Headless WebGL did not mount desktop donut markers, so this is not labelled
  desktop rendered-pixel proof.

## 3. Today and Tonight inventory

At 1440x900 in one signed-out live pass, Today displayed:

> Nothing left confirmed tonight.

In the same pass, Tonight displayed `2 listings tonight`, two listing rows, and
`DesignMyNight · sourced` on both. Captures are
`03-04-today-desktop.png` and `03-tonight-desktop.png`.

Cause: Today deliberately disables live enrichment and reads its bundled
listings snapshot. Tonight reads `/api/whats-on` and layers live provider rows
onto its baseline. Today's empty line claimed the whole live night was empty
even though its code had only checked the narrower snapshot.

The first pre-fix regression failed because each Today daypart began with an
absolute empty-night claim. A follow-up red regression then showed all four
dayparts exposing `listings snapshot`, a product plumbing term. The matching
green result requires every daypart to say:

> Nothing left on tonight's list. Open Tonight for live listings.

That sentence is limited to the list Today actually rendered and points to the
separate live listings surface without claiming it is empty.

## 4. Warm reading with a cold headline

The supplied 1440x900 smoke capture shows `Cold out. Find somewhere with a
fire.` above `Thursday 30 Jul, 24C and cloudy in London.` My later signed-out
live pass had no weather verdict, so I did not claim a second live
reproduction.

I reproduced the pre-fix contradiction deterministically with the same weather
path. An Open-Meteo-shaped observation at 24C with 70% precipitation selected
the `hard-rain` rule and its `fireplace` lens. `buildWeatherBrief` displayed
`24C` but discarded the rule ID. `buildDayGreeting` then saw only `fireplace`
and returned `Cold out. Find somewhere with a fire.`

Both regressions failed before implementation:

- the 24C brief had `ruleId` undefined instead of `hard-rain`;
- the 24C greeting returned the cold headline instead of a rain headline.

The corrected brief retains the rule selected from the same observation that
supplies its displayed temperature. Fireplace headlines now distinguish rain,
cold and winter rules. The regression proves a 24C hard-rain reading says rain
and never cold, while a 7C cold reading still says cold.

## 5. Dove price provenance

At 1440x900 in a signed-out live pass I opened The Dove. Its Overview showed
`Baseline on record`, `£7.25` and `Dataset price. Not a live tonight feed.`
No named price publisher appeared. `05-dove-source-desktop.png` and
`observations.json` record that pass. The nearby `Photo: pub website` remained
an image credit, not price provenance.

The authoritative `app_price_001178` record for the £7.25 Asahi price already
carried a specific `pub_url` on Pint Prices. The legacy drink adapter discarded
that field and replaced it with `app-dataset`; the Drinks UI translated that
generic token to `On record`. Overview read only the convenient
`venue.cheapestPrice` number, not the matching source-bearing price row.

Before implementation, the adapter regression failed with `app-dataset`
instead of `Pint Prices`, and the 1440x900 Playwright regression failed because
Overview had no `Pint Prices` link.

The correction validates and names the source on the price record. Overview
finds the row that supplies its baseline figure, and the Drinks adapter carries
that same row's publisher and URL into Asahi. The post-fix Playwright pass
observed £7.25 and the exact Pint Prices link in both places. The menu footnote
now says source links appear where a record names one; it no longer claims
every drink has a named source.

A follow-up audit found 65 other baseline price records with no publisher
recorded. Those prices are unattributed, not contradicted, so they remain
visible. Pre-fix rendered regressions failed because an unattributed Drink row
only said `On record`, an Overview row said `Source not named in record`, and
public landing and Terms copy still promised a publisher for every price. The
matching green regressions require the price row to say `Publisher not
recorded`, explain that the price is on record but its publisher was not
captured, and preserve the publisher link for a named record. Overview says
`Price on record. Publisher not recorded for this price.` Marketing and legal
copy now describe both states rather than making a blanket attribution claim.
