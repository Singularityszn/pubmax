# Live walk of pubmaxxing.com, signed out

**Target:** https://pubmaxxing.com
**Deployment under test:** `dpl_8Cz4fvuUqLbQoQLndnQnEDDFDxES`, commit `74e6889132618646c89a19e62813df499e47c5a8`, built 2026-09-07T07:35:42Z (verified via `GET /api/version`).
**Walked:** 2026-09-07, 12:05-13:45 BST.
**Author:** astra-live-walk scout.
**Scope:** read only, signed out. No account created, no price submitted, no plan locked, no message sent, no load testing.

Screenshots: `data/astra-live-walk/shots/`. Raw per-route metrics: `raw-desktop.json`, `raw-phone-slow4g.json`, `raw-phone-fast.json`.

---

## 1. Method

Three browser profiles, real network to production, one cold context per route (no cache, no storage carried over):

| Profile | Viewport | UA | CPU | Network |
|---|---|---|---|---|
| `phone-slow4g` | 390x844 @3x | iPhone iOS 18.5 Safari | 4x throttle | 150 ms RTT, 188,743 B/s down, 86,400 B/s up |
| `phone-fast` | 390x844 @3x | iPhone iOS 18.5 Safari | none | none |
| `desktop` | 1440x900 @2x | Chromium default | none | none |

The Slow 4G figures are Chrome DevTools' own preset, copied from this repo's `e2e/helpers/webVitals.ts:80-97`, so they are directly comparable with the project's recorded baselines.

Timings come from Navigation Timing plus `PerformanceObserver` for LCP, FCP, CLS and long tasks, installed via `addInitScript` before any page script. Bytes are the sum of `transferSize` (over the wire) and `decodedBodySize` (after decompression) across the navigation entry and every resource entry.

"First tappable pin" is the map's own SLA signal, `window.__pubmaxPaintedMapTapPoints()` (`components/map/canvas/paintedPinProbe.ts:23`), polled every 250 ms from navigation start. It reports the pins the map is drawing right now that survived symbol collision and carry no app chrome on top of them, which is exactly a thumb's-eye view.

Scripts used are reproduced at the end of this report.

---

## 2. Headline

The product is in better shape than the route list suggests. The landing, `/near`, the map itself and the venue sheet are genuinely good, fast, and honest about what they know. Three things spoil the first five minutes, and all three are cheap to fix:

1. **The map's own arrival card blocks every tappable pin on a first phone visit.** Reproduced 3/3. The probe reports 0 pins while the card is up and 32-41 the instant it is dismissed.
2. **The homepage's one primary action dead-ends at a sign-in wall.** "Still £6.50?" opens a price composer whose submit button reads "Sign in to post".
3. **The Out tab is empty on every day.** 148 real listings across tonight, tomorrow and the weekend, and not one of them is surfaced, because none of the venues match. `/tonight` meanwhile says the city is having a quiet one, so two primary tabs give contradictory answers about the same night.

Five production bugs were root-caused to a line of source. They are in section 5.

---

## 3. User journey as a stranger

*A Londoner, Monday evening, on an iPhone, wants a cheap pint.*

**00:00 - Land on `/`.** Best screen on the site (`journey-390-01-home.png`). One headline, "What a pint costs, pub by pub." One photo card: The Blackfriar, £6.50 a pint of Pravha, in a pink band that means dear, with the publisher, the collection date, and an archive line saying it was £3.60 in 2013. Under it a cheapest-in-borough rail with two £2.99 rows in green. That card answers the question the site exists to answer, above the fold, in about 1.4 s on a throttled phone. Nothing else on the web does this.

**00:12 - Tap the one big coral button, "Still £6.50?"** It goes to `/map?sel=venue-eltcmh&log=1` in 1451 ms and opens The Blackfriar's sheet with a price composer already scrolled into view. Five price chips, a measure row, a drink field. Then the submit button: **"Sign in to post."** (`logintent-390-01-composer.png`.) The site's single call to action, the one thing it asks a stranger to do, is behind an account. Below it: "No Pint Drops yet at The Blackfriar. Be the first." So the pub the landing chose to lead with has no community price at all.

This is the stall. The whole first-run funnel points at a door that is shut.

**00:40 - Back out, tap Map.** The map is good: pins in price colours, clusters with counts, a lean four-control top bar. But an arrival card, "Cheapest pints near you?", covers the bottom third of the screen over the densest part of central London (`map-390-fast-loaded.png`). Its primary button is black; every other painted primary on the site is coral. While it is up, the map's own probe cannot find a single tappable pin. Dismiss it and 41 appear.

**01:10 - Tap a pin.** Archway Tavern. The sheet is well built: seven tabs, a busyness reading, a hygiene score, the price. The price is **"est. £6.50 / Estimated"**. Tap another (The Torch, Wembley): **"est. £3.48 / Estimated"**. Two for two. About a third of the slim pack carries no listed price (measured: 101 of 141 core rows priced, 60 of 91 in the central shard cell), so a stranger tapping around lands on modelled figures more often than the landing card implies.

**02:00 - Tap Out, because it is tonight.** "Tonight's 31 listings are all at places we don't list yet. Up The Creek, Bridge Theatre, Duke of Yorks Theatre..." and a link out to Ticketmaster (`out-390-01.png`). Tomorrow: 54, same. Weekend: 63, same. One of six primary tabs, and its only painted action is "Open the map", i.e. leave.

**02:30 - Tap Now.** `/tonight` says "The city's having a quiet one tonight. We only list what's really on, and nothing's confirmed yet." (`tonight-390-01.png`.) Honest in isolation, but `/out` just said there were 31 listings. The two tabs disagree.

**03:00 - Try `/near`.** This is the flow that works. "Find my pint", location denied, and it says: "Location's off, so here's central London. Not your patch?" then lists 71 priced pubs cheapest first, The Three Tuns at £2.95, each with "On record, Pint Prices" and a "Keep for tonight" button. No sign-in, no wall, a real answer in under a second (`near-390-02-denied.png`). **This should be what the homepage primary does.**

**04:00 - Try `/plan`.** Good composer: one question, six 44x44 stop chips, a row of describe chips. Tapping "cheap pints tonight in Shoreditch" takes **9.0 s** to return a route, with the area picker then showing "Barnes - not crawl-ready yet", "Chiswick - not crawl-ready yet". Nine seconds is a long time with no progress signal.

**04:40 - Curiosity: tap a founding member.** `/u/karan`, founding member No. 1: "Pints logged 0. Cheapest pint: None yet. Crawls 0. Memories 0. This passport is blank, for now." The social proof is empty, and a sign-in email form is embedded in the middle of a stranger's public profile.

**Where it flows:** landing card, `/near`, the map once the card is gone, the venue sheet, `/plan`'s composer, `/places`.
**Where it stalls:** the homepage primary (sign-in wall), the map arrival card (blocks pins), `/out` (empty), `/tonight` vs `/out` (contradiction), `/plan` generation (9 s), founding profiles (blank).

---

## 4. Speed

### 4.1 Per route

LCP in ms. Requests, transfer and decoded from the unthrottled phone run. CLS from the Slow 4G run, where it is worst.

| Route | LCP slow4G | LCP phone | LCP desktop | Req | KB wire | KB decoded | CLS |
|---|---|---|---|---|---|---|---|
| `/` | 2772 | 456 | 1076 | 57 | 606 | 1675 | 0.004 |
| `/map` | 3316 | 552 | 1016 | 154 | 1354 | 6670 | 0.029 |
| `/map/london` | 3076 | 232 | 1584 | 154 | 1264 | 6673 | 0.029 |
| `/pubs` | 1640 | 592 | 1508 | 56 | 1343 | 2526 | 0 |
| `/drinks` (308 to `/social?tab=discover`) | 1680 | 620 | 752 | 80 | 645 | 1961 | 0.035 |
| `/out` | 3592 | 436 | 2188 | 51 | 548 | 1651 | 0.000 |
| `/tonight` | **4044** | 1128 | 508 | 68 | 607 | 1854 | **0.085** |
| `/today` | 1392 | 176 | 444 | 54 | 533 | 1584 | 0 |
| `/near` | 1280 | 272 | 604 | 56 | 554 | 1612 | 0 |
| `/places` | 1296 | 408 | 684 | 48 | 531 | 1508 | 0 |
| `/social` | 1468 | 276 | 264 | 72 | 641 | 1767 | 0 |
| `/crawls` | 1304 | 560 | 604 | 56 | 651 | 2497 | 0 |
| `/spoons-value` | 1712 | 640 | 1020 | 55 | 564 | 2117 | 0 |
| `/pal` | 1356 | 412 | 548 | 51 | 548 | 1589 | 0 |
| `/onboarding` (bounces to `/`) | **4676** | 476 | 1004 | 62 | 629 | 1707 | 0.004 |
| `/about` | 1548 | 272 | 840 | 47 | 532 | 1519 | 0 |
| `/you` (`/u/you`) | 1504 | 512 | 900 | 78 | 648 | 1880 | 0.027 |
| 404 | 872 | 360 | 1116 | 65 | 567 | 1667 | 0.009 |

TTFB was 11-100 ms everywhere, median 24 ms. Vercel's edge is not the problem anywhere on this site.

Every CLS figure is inside the 0.1 target. The sheet-height work has held: the phone venue sheet opened at a fixed 464 px box with no growth.

### 4.2 First tappable pin on `/map`

The map's own signal, polled from navigation start, on live production over the real internet.

| Profile | Runs | First tappable pin | Requests at that moment |
|---|---|---|---|
| Desktop 1440, unthrottled | 3 | 2431 / 2537 / 2961 ms (median 2537) | 242 |
| Phone 390, unthrottled | 3 | **null / null / 2145 ms** | 210 / 210 / 106 |
| Phone 390, Slow 4G + 4x CPU | 1 | 8891 ms | - |

Two of three phone runs never reached a tappable pin inside 17.5 s. The cause is the arrival card, not the map: see finding B1.

Engine marks on the Slow 4G phone run, from navigation start:

```
map-chunk-ready       4832 ms
first-pins            5305 ms
map-constructed       6760 ms
map-style-load        6947 ms
map-icons-ready       7083 ms
map-scene-built       7127 ms
pubs-source-loaded    8038 ms
pins-visible          8054 ms
pin-entrance-settled  8922 ms
```

The gap that matters is `first-pins` at 5305 ms to `map-constructed` at 6760 ms: the pin data is in hand a second and a half before the engine that draws it exists. On the unthrottled phone the same gap is 2721 to 2663 ms, i.e. gone. It is a CPU-bound parse of the MapLibre chunk, not a network wait.

For reference, `perf/route-budgets.json` records `pinReady` target 2500 ms, measured 2713 ms, on a local production build. My desktop median of 2537 ms is consistent with that. The phone figure is not, because of the card.

### 4.3 The three slowest things

1. **`/pubs` photos: 792 KB for five images, all oversized.** `load` lands at **8289 ms** on Slow 4G, the slowest load event on the site. Five pub photos go through `/api/image-proxy` at their source resolution: 1632x636 and 680x453 natural, into a **344x168** CSS box on a 390 px phone. No `srcset`, no resize, no format negotiation. Individually 210 KB, 156 KB, 150 KB, 139 KB. Roughly 730 KB of the 792 is waste.
2. **`/plan` describe-chip generation: 9053 ms.** Tapping a shipped chip ("cheap pints tonight in Shoreditch") took just over nine seconds to return a route, with no progress indication beyond the button state. This is the longest single interaction I found. `/spoons-value`'s "See it on the map" also took 9044 ms, but that is a full map cold start.
3. **`/map` first tappable pin at 8891 ms on Slow 4G**, of which 3.6 s is the MapLibre chunk parse described above. Beside it: `/map` decodes **6670 KB** on a phone and makes 154-203 requests, 40 of them `venues_slim.cell.*` shards on the phone and **85 on desktop**. Desktop makes 300 requests to settle.

Honourable mention: `/tonight` has the worst LCP on Slow 4G (4044 ms) and the worst CLS (0.085) while displaying no listings at all.

---

## 5. Broken, ugly, confusing

Ordered by severity. Each carries the evidence and, where I found it, the line to change.

### B1. The map arrival card blocks every tappable pin on a first phone visit *(broken, P0)*

`ASIDE.mapArrivalCard` ("FIRST VISIT / Cheapest pints near you?") occupies roughly y 570-844 of an 844 px viewport, about 32% of the screen, over central London where the cheap pins are.

Reproduced 3/3 fresh contexts, 12 s settle each:

```
run0 probePins=0   after dismiss probePins=41
run1 probePins=0   after dismiss probePins=41
run2 probePins=0   after dismiss probePins=32
```

`window.__pubmaxPaintedMapTapPoints()` returns 0 while the card is up because every painted pin has app chrome on top of it. Dismissing the card is the only thing that changes.

Two consequences. A first-time user must dismiss a card before the map is usable. And the project's own `pinReady` budget is measured in a state real first-time users are never in, so the SLA does not describe the shipped first visit.

The band map (`elementFromPoint(195, y)`): y 120-520 is `SECTION.mapStage`, y 600-760 is the card. A finger can still reach the upper two thirds, so this is not a total block, but the densest pin field is under the card.

Shots: `map-390-fast-loaded.png`, `map-390-after-dismiss.png`.

Secondary, same card: its primary button is **black**, not coral. Every other painted primary in the product is coral (`journey-390-01-home.png`, `out-390-01.png`, `tonight-390-01.png`). One button family, one exception, and it is on the map's first screen.

### B2. `GET /api/area-news` 400s for 5 of 20 London night areas, including Soho *(broken, P1)*

Found as a live console error on `/map` at 1440: `400 https://pubmaxxing.com/api/area-news?area=balham`.

Swept all 20 slugs from `lib/nightAreas.ts`:

```
balham                     400   piccadilly-soho            400
barnes                     400   victoria                   400
bermondsey-london-bridge   400   (15 others                 200)
```

Body: `{"error":"Unknown area.","code":"INVALID_REQUEST","retryable":false}`

Root cause: `app/api/area-news/route.ts:30` gates on `isKnownAreaSlug(area)`, which is `area in AREA_INDEX || BOROUGH_SLUG_TO_NAME.has(area)` (`lib/areaNews.ts:198`). `AREA_INDEX` is keyed by **neighbourhood** slug (`soho`), while the map passes the **night-area** slug (`piccadilly-soho`). The 15 that pass do so by coincidence, because their night-area slug happens to also be a neighbourhood or borough key.

So the map's "New round here" block fails silently over Soho, Victoria, Balham, Barnes and London Bridge, five of the areas a Londoner is most likely to pan to. The route already answers `status: "unavailable"` with a 200 for a failed read; an unmapped-but-valid night area should take that path, or `isKnownAreaSlug` should accept `NIGHT_AREA_SLUGS`.

### B3. The homepage's one primary action ends at a sign-in wall *(confusing, P1)*

"Still £6.50?" on `/` is the site's single `data-primary-action`. It opens `/map?sel=venue-eltcmh&log=1`, the Pint Drop composer, whose submit reads **"Sign in to post"** with the explainer "Set the price now. Sign in to post it under your name."

A stranger's first and most emphatic tap produces a login prompt. `/near` proves the site can give an unauthenticated answer in one tap. The landing points at the one thing that cannot.

Two smaller things in the same composer (`logintent-390-01-composer.png`):
- The explainer line is **clipped in half** at the top of the sheet. The log-intent reveal scrolls the price step into view and cuts off the sentence that explains it.
- Three ways to enter one number stacked vertically: a minus/plus stepper around a `£` field, five quick chips, and a free text field.

### B4. The Out tab is empty on every day, and contradicts Tonight *(broken, P1)*

```
/out                  "Tonight's 31 listings are all at places we don't list yet."
/out?day=tomorrow     "Tomorrow's 54 listings are all at places we don't list yet."
/out?day=weekend      "The weekend's 63 listings are all at places we don't list yet."
```

148 sourced listings across three days, zero surfaced, because venue matching resolves none of them. The screen names theatres (Up The Creek, Bridge Theatre, Duke of Yorks) and offers one link out to Ticketmaster. Its one painted primary is "Open the map".

Meanwhile `/tonight`, the other tab about the same evening, says "The city's having a quiet one tonight. We only list what's really on, and nothing's confirmed yet." Both are individually honest and together they contradict each other.

Shots: `out-390-01.png`, `out-390-02-weekend.png`, `tonight-390-01.png`.

### B5. `/spoons-value` cannot reach its own lens, and prefetches the map 805 ways *(broken, P2)*

Two defects in one page, both in source.

**The CTA drops the lens.** `app/spoons-value/page.tsx:112`:

```tsx
primary={<Link prefetch={false} href="/map">See it on the map</Link>}
```

Bare `/map`. Measured: tapping it lands on the ordinary pint map with no units lens and no units key, after 9044 ms. The 805 row links are no better; `spoonsValueMapHref` (`lib/spoonsValue.ts:666`) returns `/map?sel=<id>` with no lens either. The page is entirely about the units lens, and nothing on it can switch the lens on. The only way in is the Drink lane dropdown, where "Spoons value" is the 14th item.

**The prefetch fence misses this file.** `app/spoons-value/SpoonsValueTable.tsx:86`:

```tsx
const href = spoonsValueMapHref(row);
...
<Link href={href}>{row.name}</Link>
```

No `prefetch={false}`, 805 times, each a distinct `/map?sel=<id>` query so nothing dedupes. Measured on a phone, scrolling twelve screens: **7 `_rsc` prefetches of `/map?sel=...`**, growing with scroll depth. `/crawls` does the same, 4 measured, including `/map?mode=build&pubs=...`.

`__tests__/linkPrefetchFence.test.ts` did not catch it and `spoons-value` is not in its `PENDING_GUARD`. The fence resolves an allow-list of 12 helper names (`HEAVY_HELPERS`, line 55-70) and a `HEAVY_NAME` regex matching value names ending `mapHref`/`mapUrl`. Here the helper is `spoonsValueMapHref`, absent from the list, assigned to a const named `href`, so both checks miss. The fence is an allow-list, which is the shape that goes stale the moment a new helper lands. Suggest matching the **call site** name against `/maphref|mapurl$/i` as well as the value name.

### B6. `/onboarding` server-renders a document, then bounces to `/` *(confusing, P2)*

```
NAV https://pubmaxxing.com/onboarding
NAV https://pubmaxxing.com/onboarding
NAV https://pubmaxxing.com/          (~820 ms after first paint)
```

`GET /onboarding` returns 200 with `<title>Set up your first night | PUBMAXXING</title>`, then the client replaces to `/` and stays there. On Slow 4G this route records the **worst LCP on the site, 4676 ms**, because the measured paint is the homepage hero arriving after the redirect. A fresh context with no storage always bounces, so the first-run surface is unreachable from the web. Either it is native-shell-only, in which case the web route should 404 or redirect at the edge rather than ship a document, or it is broken.

### B7. The 404 page preloads 17 stylesheets it never uses *(ugly, P3)*

The not-found document emits 18 console warnings, 17 of them:

> The resource https://pubmaxxing.com/_next/static/immutable/chunks/*.css was preloaded using link preload but not used within a few seconds from the window's load event.

It is the noisiest console on the site by a factor of six. `/today` (5) and `/pal` (2) have the same problem more mildly. The page itself is charming ("Called for last orders here. Whatever was here has drunk up and gone home. The pubs haven't."), but its `<title>` is the generic homepage title, so a 404 in a browser tab is indistinguishable from the landing page.

### B8. `/pubs` ships 792 KB of unresized photographs *(ugly, P2)*

Five `/api/image-proxy` images at 1632x636 and 680x453 natural into a 344x168 CSS box. `loading="lazy"` is set, but no `srcset`, no width parameter on the proxy, no format negotiation. Slow 4G `load` = 8289 ms, the slowest on the site.

The first row of the chains list is also "Doggett's Coat and Badge / **No price logged yet**", and the drink chips on chain cards read "Shots" and "Whisky" rather than a pint price. A page called Chains, sold on pint prices, leading with a pub that has none.

### B9. The desktop map shows 17 chrome elements before you touch a pin *(ugly, P2)*

At 1440 (`map-1440-01-loaded.png`), before any interaction: search field, Filters, Drink: Pints, My pint, Cheapest pint (any), Show me, Drinks, Zone, Plan an outing, London, Show all, Reset view, zoom in, zoom out, Layers, a weather chip, an Elizabeth line disruption banner, and the arrival card. The phone map shows 4 (`journey-390-tab-map.png`) and is much better for it.

The Filters control itself works correctly and is the improvement it was meant to be: it opens a popover of five kind chips and the trigger badges to "Filters 1" when one is switched off (`map-1440-02-filters-open.png`, `map-1440-03-filters-toggled.png`). Two blemishes:
- The popover has no visible container. Five chips float on a near-transparent rectangle with a hard right edge cutting across the map, and it clips the Elizabeth line banner's text.
- The **Clubs** chip is permanently disabled: `aria-disabled="true"`, `title="Clubs are not mapped yet"`. A five-chip row where one can never be used, and the only explanation is a `title` attribute no phone shows.

### B10. Founding member profiles are blank *(confusing, P3)*

`/u/karan`, founding member No. 1, the person a stranger is most likely to click from `/social`:

> Pints logged 0 / Cheapest pint None yet / Followers 6 / Following 6 / Crawls 0 / Memories 0 / **This passport is blank, for now.**

`/social` shows "Founding hundred: 8 accounts" as three initial-letter avatars. The social proof of a social product is eight empty profiles. A sign-in email form ("Continue with email / Email me a link") also renders inline in the middle of somebody else's public profile, which reads as that person's form.

### B11. Small ones

- **`/drinks` is a 308 to `/social?tab=discover`**, whose Discover panel reads "Creator lists / No creators have shared a list yet." A redirect target that is an empty state.
- **The consent card sits 8 px above the tab bar, not flush.** Measured `bottom: 64px` against a 56 px tab bar (`consent-390-dock-detail.png`). Visually fine because the bar is an inset pill, but the shipped CSS and the stated rule disagree.
- **The consent card's copy is cramped.** At 390 the sentence wraps to two lines in a narrow column beside two stacked buttons of unequal width, with the "Privacy" link dangling mid-sentence.
- **MapLibre style warnings on every map load**: `layers[road_shield_us].filter[1]: Expected value to be of type number, but found null instead. Falling back to false.` Three of them, plus `highway-shield-non-us` and `highway-shield-us-interstate`. US road shield layers in a London basemap.
- **Two number-chip shapes.** `/plan`'s stop count is 44x44 squares at `border-radius: 14px`. The price composer's `£4.00`-`£6.00` chips are fully rounded pills. Both are numbers you tap to choose one value.

### Verified correct (things I went looking for and could not break)

- **The consent card fires only after the product answers first.** Not present on `/` after 10 s, not present on `/tonight` on first visit, present on `/today` as the second route. Full-bleed (0 to 390), `border-radius: 0`, no shadow, no `backdrop-filter`, opaque. (`consent-390-A-home-firstvisit.png`, `consent-390-C-today.png`.)
- **The five price chips wrap 4+1 at 390.** Measured: row y=174 holds `£4.00 £4.50 £5.00 £5.50` at x = 61, 130, 198, 267, each 63x44; row y=224 holds `£6.00`. Exactly as specified.
- **The venue sheet does not jump.** Opens at a fixed 464 px box, top 316, bottom 780. CLS on `/map` is 0.029.
- **The tab bar hides correctly under an open sheet.** `transform: matrix(1,0,0,1,0,61.6)`, links at cy=875 below an 844 viewport. I first read this as the tab bar being blocked; it is the documented open-sheet idiom, working.
- **All six phone tabs navigate**, 0-1.1 s each after subtracting settle time.
- **`/near` degrades perfectly** when location is denied.
- **No uncaught page errors on any of the 18 routes** in any of the three profiles.
- **No 4xx or 5xx** on any route except the deliberate 404 and the `area-news` bug in B2.

---

## 6. What a new plan should fix first

1. Take the map arrival card off the pins: make it a top strip, a chip, or dismiss it on the first map gesture (B1).
2. Point the homepage primary at an answer, not a login. Send "Still £6.50?" to the same unauthenticated result `/near` already gives, and ask for the account after the answer (B3).
3. Accept night-area slugs in `isKnownAreaSlug`, or make an unmapped area answer `unavailable` with a 200 instead of 400 (B2).
4. Give `/out` something, or fold it into `/tonight`. One empty tab of six is worse than five good ones, and the two tabs currently contradict each other about the same night (B4).
5. Add `?lens=spoons` (or equivalent) to `/spoons-value`'s CTA and its 805 row links, so the page can reach the lens it is about (B5).
6. Add `prefetch={false}` at `SpoonsValueTable.tsx:86`, and make `linkPrefetchFence` match helper **call sites** ending `mapHref`/`mapUrl`, not just an allow-list of 12 names (B5).
7. Resize `/api/image-proxy` output to the requested box and emit a `srcset`. 792 KB to roughly 60 KB on `/pubs`, and its 8.3 s load with it (B8).
8. Give `/plan`'s describe chips a progress state, and profile the 9 s generation (section 4.3).
9. Cut the desktop map's 17 arrival controls, and either enable the Clubs chip or drop it from the row (B9).
10. Decide what `/onboarding` is on the web: a real surface, or an edge redirect that ships no document (B6).

---

## 7. Waiting on the captain

Two findings are product calls rather than engineering fixes. Both are registered as captain-held tasks; everything else in section 6 has an obvious right answer and needs no decision.

**`astra-live-walk-out-tab` - what `/out` is.** It is empty on every day and contradicts `/tonight`. Invest in venue matching so it has content, fold it into `/tonight` and free the sixth tab, or keep it and print the unmatched listings as real rows with a source credit and no pub link. See B4.

**`astra-live-walk-landing-primary` - what the landing primary does.** Captain decision 2026-09-04, issue #1357, made it the Pint Drop door. Signed out, that door is a sign-in wall, and the anchor pub has no Pint Drop. Keep the ruling and accept the wall, send the primary to the `/near`-style unauthenticated answer and ask for the account afterwards, or keep the door and let a signed-out drinker submit and claim it later. This reverses a standing ruling, so it is not mine to change. See B3.

---

## 8. If this is promoted to a shipping task

Five of the findings are root-caused to a line and would each be a small, testable PR:

| Finding | Change | Existing pin |
|---|---|---|
| B2 | `isKnownAreaSlug` accepts `NIGHT_AREA_SLUGS`, or the route answers `unavailable` 200 for a valid-but-unmapped area | `__tests__` for `lib/areaNews.ts`; add the 20-slug sweep |
| B5a | `app/spoons-value/page.tsx:112` and `lib/spoonsValue.ts:666` carry the units lens | `__tests__/spoonsValueSurfaces.test.tsx` |
| B5b | `prefetch={false}` at `SpoonsValueTable.tsx:86`; `linkPrefetchFence` matches call sites ending `mapHref`/`mapUrl` | `__tests__/linkPrefetchFence.test.ts` |
| B6 | `/onboarding` redirects at the edge or 404s on the web instead of shipping a document it discards | `__tests__/nativeFirstRunConsentPlacement.test.ts` neighbours |
| B8 | `/api/image-proxy` takes a width and emits a `srcset` for `/pubs` | `perf/route-budgets.json` `/pubs` |

B1 is the highest-value change in the list and is a layout decision on the map arrival card rather than a one-line fix.

---

## 9. Reproduction

Every script is preserved in `data/astra-live-walk/scripts/`. They were run from inside a pubmax worktree so they resolve `playwright` from the repo's own `node_modules`; copy one into any checkout of the repo and run it with `node`.

| Script | What it does |
|---|---|
| `walk.mjs` | Cold-load sweep over 18 routes x 3 profiles. `PROFILES=desktop node scratch-astra/walk.mjs`. Writes `raw-<profile>.json` and two screenshots per route. |
| `map-desktop.mjs` | Desktop map walk: pin-ready timing, Filters popover, kind chips, drink lane, pin click. |
| `map-phone.mjs` | Phone map pin-ready timing, throttled and not, plus the engine perf marks. |
| `map-net2.mjs` | Request classification on `/map` at both widths. Surfaces the `area-news` 400. |
| `map-tointeractive.mjs` | Requests counted at the pin-ready moment, 3 runs per width. |
| `cardblock.mjs` / `cardblock2.mjs` | The B1 reproduction: probe count before and after dismissing the arrival card. |
| `consent.mjs` / `consent2.mjs` | Consent card timing across arrival, second route, and its dock geometry. |
| `onboarding.mjs` | The `/onboarding` bounce trace. |
| `phone-journey.mjs`, `phone-tabs.mjs`, `phone-more.mjs`, `phone-more2.mjs` | The stranger journey: home, primary action, price chips, tab tour, plan, near, pal, profile, tonight, out, spoons, crawls, pubs, social. |
| `prefetch.mjs` | Scroll-and-count of `_rsc` prefetches to `/map`. |
| `pubs-img.mjs` | `/pubs` image natural-vs-CSS size and proxy bytes. |

One-line reproductions for the two API findings:

```bash
curl -s "https://pubmaxxing.com/api/area-news?area=piccadilly-soho"
# {"error":"Unknown area.","code":"INVALID_REQUEST","retryable":false}

curl -s https://pubmaxxing.com/spoons-value | grep -c 'href="/map?sel='
# 805
```
