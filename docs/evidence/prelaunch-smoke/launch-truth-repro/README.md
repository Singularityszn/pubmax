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

The correction-round focused run
`npm test -- __tests__/pinRevealCoordinator.test.ts __tests__/pubSourceRevision.test.ts`
recorded the late-paint recovery regression red: generation 1 was expected in
the timeout-recovery lane and the lane stayed empty. That run finished with 15
passing and 2 failing tests. The matching focused green run,
`npx vitest run __tests__/pinRevealCoordinator.test.ts __tests__/pubSourceRevision.test.ts`,
finished with all 17 tests passing. It covers recovery after a late first paint
plus the separate ownership guard that leaves a genuine error-owned notice
intact. The focused Chromium green,
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
and amber cluster discs behind those claims. My later live captures are
`02-no-alcohol-390.png` and `02-no-alcohol-1440.png`; their settled frames do
not retain the same coloured cluster field from the supplied capture, so they
are not presented as a second pixel reproduction.

I reproduced the underlying pre-fix boundary deterministically. A painted
desktop donut survived replacement of the `pubs` source because the sync had no
invalidation operation. Its unit regression failed with zero marker removals.
The source-revision regression also failed before implementation because no
operation coupled MapLibre settlement to key publication.

Cause: cluster paint and key meaning crossed the source boundary on separate
clocks. The key derived from desired GeoJSON immediately. GL paint settled
later, while desktop donuts could retain cached counts from the prior source.

The correction commits one `nextPubsData` revision. Cached donuts retire first,
MapLibre settles that exact object, and only then may that exact object publish
key state. Superseded worker completions cannot publish.

The same correction-round red recorded premature publication: the source
revision test expected no key publication after the old tiles rendered between
the tagged `content` event and source settlement, but publication had already
occurred once. The matching 17-test green waits for revision-tagged content,
then `pubs` source settlement, then a render boundary before publishing. Its
failure case still suppresses publication, queued lens revisions still cross
the same boundary, and story-band reads remain on committed data.

Captain approved keeping the F4 source-revision correction and F5 late-paint
timeout recovery in one pipeline-owned fix. Re-review raised no further finding
on the same-revision guarantee, so the trip-wire did not fire and the
No-alcohol key lens stays in.

Proof is deliberately split:

- Mobile rendered proof: the 390x844 Playwright test crops to the exposed map
  band, excluding controls and sheet. It finds grey cluster pixels and no green
  or amber cluster pixels while the No-alcohol key says clusters stay grey.
- Desktop state-level proof: unit tests require old donut invalidation and
  derive the No-alcohol key from the same all-unknown source revision handed to
  cluster paint. This is not labelled rendered proof. Headless GL did not mount
  desktop donut markers, including after camera zoom, so a desktop pixel claim
  would be false evidence. Live Chromium does mount them, as the supplied smoke
  capture shows; no separate product marker-absence defect was observed.

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

The pre-fix regression failed because each Today daypart began with an absolute
empty-night claim and did not name its listings snapshot. The corrected lines
say that the snapshot has no picks and point readers to Tonight for live
listings. A live Tonight count and an empty Today snapshot can now both be true.

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
