# Signed-out prelaunch smoke

Live site: `https://pubmaxxing.com`  
Date: 30 July 2026  
Session: fresh signed-out Playwright Chromium contexts, no stored site data  
Viewports: 390x844 mobile with touch emulation; 1440x900 desktop

## First-time visitor findings, worst first

- **Desktop map shows a false failure:** at 1440x900, the map background and pins render, then a persistent toast says `Map background couldn't load. Tap Retry to try again.` Reproduced in two fresh Chromium runs. This is untrue and asks for recovery from a failure the visitor cannot see.
- Home proposition is immediate at both widths: listed sourced pint prices on an interactive map, plus crawl planning.
- First-visit analytics choice covers some below-fold home content, but leaves proposition and primary `Find my pint` action visible. `No thanks` and `Allow` are reachable at both widths.

## Result summary

| Journey | Mobile | Desktop |
| --- | --- | --- |
| 1. Home | Pass | Pass |
| 2. Map and key | Pass | Fail |
| 3. Venue sheet | Pending | Pending |
| 4. Filter | Pending | Pending |
| 5. Plan | Pending | Pending |
| 6. Contribute price | Pending | Pending |
| 7. Discover, Today, Tonight | Pending | Pending |
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

Pending.

## 4. Use a filter

Pending.

## 5. Open Plan signed out

Pending.

## 6. Try to contribute a price signed out

Pending.

## 7. Open Discover, Today and Tonight

Pending.

## 8. Follow map credit and privacy

Pending.

## Fixes

None so far. Full walk completes before fix triage.
