# Signed-out prelaunch smoke

Live site: `https://pubmaxxing.com`  
Date: 30 July 2026  
Session: fresh signed-out Playwright Chromium contexts, no stored site data  
Viewports: 390x844 mobile with touch emulation; 1440x900 desktop

## First-time visitor findings, worst first

- **No-alcohol key contradicts map paint:** at both widths, selecting `No alcohol` says no alcohol-free or soft-drink prices are logged and `Clusters stay grey`, but map behind it continues to show green and amber clusters. Desktop list count changes from 1,466 in default view to 33, while visible canvas still carries large coloured clusters. Key does not describe shown map.
- **Today and Tonight disagree:** Today says `Nothing left confirmed tonight.` Tonight, opened in same pass, says `2 listings tonight` and shows two sourced events. Neither sentence narrows itself enough to make both true.
- **Desktop map shows a false failure:** at 1440x900, the map background and pins render, then a persistent toast says `Map background couldn't load. Tap Retry to try again.` Reproduced in two fresh Chromium runs. This is untrue and asks for recovery from a failure the visitor cannot see.
- **Today calls 24C cold:** headline says `Cold out. Find somewhere with a fire.` immediately above `Thursday 30 Jul, 24C and cloudy in London.` Copy contradicts displayed measurement.
- **Venue price source is not named:** The Dove shows £7.25 and honestly says `Dataset price. Not a live tonight feed.`, but `Dataset price` does not identify the dataset or publisher. Its Drinks detail says every drink carries its source, yet the £7.25 Asahi row only says `ON RECORD`. The nearby `Photo: pub website` is clearly an image credit, not price provenance.
- **Tonight desktop navigation is off-centre:** at 1440x900, shared 1,100px navigation begins at x=-4 instead of x=170 as it does on Discover and Today, leaving brand against viewport edge and a large blank right margin.
- Home proposition is immediate at both widths: listed sourced pint prices on an interactive map, plus crawl planning.
- First-visit analytics choice covers some below-fold home content, but leaves proposition and primary `Find my pint` action visible. `No thanks` and `Allow` are reachable at both widths.

## Result summary

| Journey | Mobile | Desktop |
| --- | --- | --- |
| 1. Home | Pass | Pass |
| 2. Map and key | Pass | Fail |
| 3. Venue sheet | Fail | Fail |
| 4. Filter | Fail | Fail |
| 5. Plan | Pass to read-only boundary | Pass to read-only boundary |
| 6. Contribute price | Pass | Pass |
| 7. Discover, Today, Tonight | Fail | Fail |
| 8. Map credit and privacy | Pending | Pending |

## 1. Land on home page

**What I did**

- Opened `https://pubmaxxing.com/` in a new signed-out context at each viewport.
- Waited five seconds for stable layout and fonts.
- Read first screen without scrolling or dismissing first-visit analytics choice.

**390x844 - Pass**

Visible first screen says `Listed pint prices on an interactive map. Plan a crawl with your mates.` Supporting copy says each price has a source and can be viewed by fare zone or borough. `Find my pint`, `Open the map`, and `Plan my night` are present; primary action and two secondary actions remain visible above analytics choice. No horizontal overflow (`scrollWidth` 390 for viewport width 390).

Capture: [`01-home-mobile.png`](01-home-mobile.png)

**1440x900 - Pass**

Same proposition and supporting copy are visible immediately. Pub/drink artwork makes map-plus-prices concept concrete. Primary and secondary actions remain reachable despite analytics choice across bottom. No horizontal overflow (`scrollWidth` 1440 for viewport width 1440).

Capture: [`01-home-desktop.png`](01-home-desktop.png)

**Diagnostics**

- Main document: HTTP 200 at both widths.
- Console errors: none at either width.
- Console warnings: mobile logged 20 browser unused-preload warnings for Next.js CSS or hero assets; desktop logged none during measured wait.
- Failed requests: no HTTP 4xx/5xx. Chromium reported 12 mobile and 20 desktop `net::ERR_ABORTED` Next.js RSC link-prefetch requests. They were speculative route prefetches, not the main document or a visitor-triggered action; visible page and links remained available.

## 2. Open map and inspect pins and key

**What I did**

- Opened `https://pubmaxxing.com/map` in a new signed-out context at each viewport and declined optional analytics.
- Waited ten seconds for the map and venue index.
- Mobile: opened `More map controls`, which opens on the `Key` tab.
- Desktop: opened the visible `Key` control.

**390x844 - Pass**

MapLibre canvas filled exact viewport. Coloured clusters and individual venue pins appeared behind controls; list-view count was 743 in observed state. Key explained green `£` as £5.50 or less, amber `££` as over £5.50 to £7, red `£££` as over £7, grey `?` as no pint price, plus mixed cluster rings. Copy also distinguishes pub pint thresholds from relative bands for other venue types. No overlap or horizontal overflow observed.

Capture: [`02-map-mobile.png`](02-map-mobile.png)

**1440x900 - Fail**

MapLibre canvas filled exact viewport. London basemap, coloured clusters, individual pins, and list-view count 1,466 appeared. Expanded key clearly described price colours and cluster rings.

Defect: persistent toast at bottom says `Map background couldn't load. Tap Retry to try again.` while background is visibly loaded. Same false failure appeared in a second fresh 1440x900 run after 12 seconds. Left report-only because it touches map behaviour.

Capture: [`02-map-desktop.png`](02-map-desktop.png)

**Diagnostics**

- Main document: HTTP 200 at both widths.
- Console errors: none at either width, including desktop reproduction.
- Console warnings: mobile logged two headless-Chromium WebGL readback-stall warnings and unused-preload warnings; desktop reproduction logged two WebGL readback-stall warnings.
- Failed requests: mobile logged three aborted speculative Next.js RSC prefetches (`/u/you`, `/moment`, `/today`) and no HTTP 4xx/5xx. Desktop reproduction logged no request failures and no HTTP 4xx/5xx despite false failure toast.

## 3. Open a pub

**What I did**

- Opened map and searched `Dov` at each width.
- Tapped visible `The Dove` result, opening selected venue `venue-1p5ftm3`.
- Scrolled its Overview to price provenance, then also checked Drinks > Beer > Asahi for a more specific source.

**390x844 - Fail**

Sheet opened without overlap and showed The Dove, £7.25, `current recorded price`, and `Baseline on record`. Wording `Dataset price. Not a live tonight feed.` is appropriately cautious about freshness.

Failure: no named price source appears. `Dataset price` is a source class, not an origin a visitor can check. The Drinks detail for £7.25 Asahi says `ON RECORD` and `Every drink carries its source`, but still names no dataset, publisher, or listing. `Photo: pub website` is an image credit only.

Capture: [`03-venue-mobile.png`](03-venue-mobile.png)

**1440x900 - Fail**

Same venue opened in right-side sheet without clipping. Overview shows `Baseline on record`, £7.25, and the same honest freshness qualifier. Same named-source omission remains.

Capture: [`03-venue-desktop.png`](03-venue-desktop.png)

**Diagnostics**

- Main document: HTTP 200 at both widths.
- Console errors: none.
- Console warnings: both widths logged two headless-Chromium WebGL readback-stall warnings and one MapLibre style warning: `layers[road_shield_us].filter[1]: Expected value to be of type number, but found null instead.`
- Failed requests: mobile logged one aborted speculative Next.js RSC prefetch for `/today`; desktop logged none. No HTTP 4xx/5xx at either width.
- Fix: none. Price provenance touches pricing and data promises, so this remains for Firstmate.

## 4. Use a filter

**What I did**

- Opened map in a fresh context and selected `No alcohol` under `SHOW ME`.
- Waited six seconds after selection.
- Mobile: kept `Prices and places` open so selected filter, empty-state sentence, key, and canvas behind it were visible together.
- Desktop: reopened `Map key` after filter settled.

**390x844 - Fail**

Filter visibly applied: top category changed from `Pints` to `Pubs`; hidden list-view count changed from 743 in default journey to 49 in this run. Sheet plainly says `No alcohol-free or soft drink prices logged here yet` and key says pins without a trusted price stay unknown and clusters stay grey.

Failure: map behind sheet still shows green and amber clusters, directly contradicting key. This remained after closing sheet and waiting another six seconds in a separate check.

Capture: [`04-filter-mobile.png`](04-filter-mobile.png)

**1440x900 - Fail**

Filter visibly applied and list-view count changed from 1,466 in default journey to 33 in this run. Key says no no-alcohol price exists on map and all clusters stay grey. Canvas still shows green and amber clusters with counts far above filtered list count. False background-failure toast from journey 2 also recurred.

Capture: [`04-filter-desktop.png`](04-filter-desktop.png)

**Diagnostics**

- Main document: HTTP 200 at both widths.
- Console errors: none.
- Console warnings: mobile logged two headless-Chromium WebGL readback-stall warnings; desktop logged none during measured run.
- Failed requests: mobile logged none; desktop logged one aborted speculative Next.js RSC prefetch for `/feed`. No HTTP 4xx/5xx at either width.
- Fix: none. Paint, cluster membership, pricing lens, and map key are map/pricing behaviour and explicitly report-only.

## 5. Open Plan signed out

**What I did**

- Opened `https://pubmaxxing.com/plan` signed out.
- Used `Describe instead` to skip optional five-step intake without entering personal data.
- Selected built-in `Cheap round` prompt. This only filled local draft fields.
- Stopped before enabled `Plan my night`, because next action sends a POST generation request and brief requires live site remain read-only.

**390x844 - Pass to read-only boundary**

No authentication stop appeared. Plan explained that three stops can be reviewed and changed, one link can be opened by crew without an account, and preview remains private until locked. `Cheap round` populated `deal nights and cheap pints tonight in Victoria`, changed title to `Cheap round tonight`, and enabled `Plan my night`. No field was obscured or unreachable while scrolling.

Capture: [`05-plan-mobile.png`](05-plan-mobile.png)

**1440x900 - Pass to read-only boundary**

Same flow and state. Page stayed centred, fields and enabled action were readable, and no sign-in gate interrupted planning.

Capture: [`05-plan-desktop.png`](05-plan-desktop.png)

**Where it stopped**

Product did not stop signed-out visitor before route generation. Smoke stopped at enabled `Plan my night` to honour read-only constraint. Route generation, anonymous link creation, and Plan-to-Round were not claimed as working because they were not submitted or seen.

**Diagnostics**

- Main document: HTTP 200 at both widths.
- Console errors and warnings: none.
- Failed requests: mobile logged six and desktop logged six aborted speculative Next.js RSC prefetches. No HTTP 4xx/5xx.
- POST requests: none.

## 6. Try to contribute a price signed out

**What I did**

- Opened selected The Dove sheet signed out.
- Recorded visible form controls before interaction.
- Clicked `Add price` once and recorded resulting gate before entering anything.

**390x844 - Pass**

No contribution field was visible before click. After click, sheet immediately showed `Sign in to add a price`, `You need an account to add a price`, and `Sign in here and we’ll bring you back to The Dove.` Only new field was email sign-in input (`you@example.com`), followed by `Email me a link`. No price or drink field appeared.

Capture: [`06-contribute-mobile.png`](06-contribute-mobile.png)

**1440x900 - Pass**

Same gate, return promise, and email-only sign-in control appeared in right-side sheet. No price field appeared. False background-failure toast from journeys 2 and 4 recurred but did not obstruct gate.

Capture: [`06-contribute-desktop.png`](06-contribute-desktop.png)

**Diagnostics**

- Main document: HTTP 200 at both widths.
- Console errors: none.
- Console warnings: mobile logged two headless-Chromium WebGL readback-stall warnings plus MapLibre `road_shield_us` null-filter warning; desktop logged MapLibre warning.
- Failed requests: mobile logged one and desktop logged twelve aborted OpenFreeMap vector-tile requests while camera/sheet state changed. No HTTP 4xx/5xx.
- POST requests: none. No sign-in email or contribution submitted.

## 7. Open Discover, Today and Tonight

Opened `/discover`, `/today`, and `/tonight` directly in new signed-out contexts at each width. Waited 4.5 seconds for dynamic content and captured first screen.

### Discover

**390x844 - Pass**

Shows real route-readiness counts, area states, drink families, city energy with demo qualification, tonight pointer, listed-price leaderboard, and editorial routes. Copy distinguishes fresh route-ready areas from reviewed, unchecked, and paused areas.

Capture: [`07-discover-mobile.png`](07-discover-mobile.png)

**1440x900 - Pass**

Same real content, centred and readable without overflow.

Capture: [`07-discover-desktop.png`](07-discover-desktop.png)

### Today

**390x844 and 1440x900 - Fail**

Page shows real, sourced weather (`Checked 1 hour ago · via Open-Meteo`), TfL disruption, listed prices dated 3 July 2026, quiet-pub history, and an explicit event empty state.

Two copy/data defects:

1. Headline `Cold out. Find somewhere with a fire.` contradicts displayed 24C.
2. `Nothing left confirmed tonight.` contradicts Tonight page’s two sourced listings from same pass. Today does not qualify empty state as a narrower area or kind.

Captures: [`07-today-mobile.png`](07-today-mobile.png), [`07-today-desktop.png`](07-today-desktop.png)

### Tonight

**390x844 - Pass**

Shows two real listings, checked 30 July, with venue, times, prices, and DesignMyNight source. `Thin coverage tonight: 2 sourced listings only. Not a full gig guide.` sets honest limit.

Capture: [`07-tonight-mobile.png`](07-tonight-mobile.png)

**1440x900 - Fail**

Content is same and honest, but site navigation is visibly mis-centred. Measured `siteNavBar` at x=-4, width 1,100; Discover and Today place same bar at x=170. Brand nearly touches left edge while 344px remains blank on right.

Capture: [`07-tonight-desktop.png`](07-tonight-desktop.png)

**Diagnostics**

- Main documents: HTTP 200 for all six runs.
- Console errors and warnings: none.
- Failed requests: only aborted speculative Next.js RSC prefetches, with counts mobile Discover 3, Today 10, Tonight 13; desktop Discover 14, Today 7, Tonight 12. No HTTP 4xx/5xx.
- Horizontal overflow: none; `scrollWidth` equalled viewport width on all six.
- Fixes deferred until full walk. Today contradictions touch live data interpretation. Tonight centring is a possible small CSS fix pending diagnosis.

## 8. Follow map credit and privacy

Pending.

## Fixes

None so far. Full walk completes before fix triage.
