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
