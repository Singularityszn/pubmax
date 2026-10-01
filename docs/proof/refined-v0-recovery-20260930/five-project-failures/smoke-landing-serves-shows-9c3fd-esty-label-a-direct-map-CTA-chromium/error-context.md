# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> landing / serves, shows hero + Demo honesty label + a direct map CTA
- Location: e2e/smoke.spec.ts:26:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Demo').first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Demo').first()

```

```yaml
- link "Skip to main content":
  - /url: "#main"
- banner:
  - link "PUBMAXXING home":
    - /url: /
    - img "PUBMAXX"
  - navigation "Landing navigation":
    - link "Tonight":
      - /url: /tonight
    - link "Map":
      - /url: /map
    - link "Places":
      - /url: /places
    - link "Out":
      - /url: /out
    - link "Plan":
      - /url: /plan
    - link "You":
      - /url: /u/you
  - link "Activity":
    - /url: /activity
  - link "Messages":
    - /url: /messages
  - button "Switch to dark theme"
  - button "Sign in"
- main:
  - region "What a pint costs, pub by pub.":
    - paragraph: PUBMAXX
    - heading "What a pint costs, pub by pub." [level=1]
    - paragraph: London on one map, with 298 historic pubs marked and a listed price wherever we hold one.
    - figure "The London boroughs, and every old pub we hold a history for.":
      - img "A map of London with 298 historic pubs marked, 5 of them named.": Prospect of Whitby Founded 1520 The Seven Stars Built 17th century Upper Flask Built 18th century The Star Tavern Built 19th century The Bulls Head Built 1846
      - text: The London boroughs, and every old pub we hold a history for.
    - link "Cheapest pints near me":
      - /url: /near?locate=1
    - link "Still £6.50?":
      - /url: /map?sel=venue-eltcmh&log=1&price=6.50
    - link "Tonight":
      - /url: /tonight
    - article "The Blackfriar":
      - img "Inside The Black Friar, the Art Nouveau pub at Blackfriars in the City of London"
      - paragraph: City of London
      - button "Near me"
      - heading "The Blackfriar" [level=2]:
        - link "The Blackfriar":
          - /url: /map?sel=venue-eltcmh
      - paragraph:
        - text: £6.50
        - link "a pint of Pravha":
          - /url: /drink/pravha
      - paragraph:
        - text: Listed by
        - link "Pint Prices":
          - /url: https://www.pint-prices.com/pub/174%20Queen%20Victoria%20St,%20Greater,%20London%20EC4V%204EG,%20UK/The%20Blackfriar
        - text: ", collected 4 September 2026."
      - text: Listed
      - paragraph:
        - strong: £3.60
        - text: in July 2013. Up £2.90 in 13 years.
      - paragraph:
        - link "beerintheevening.com":
          - /url: https://www.beerintheevening.com/pubs/comments.shtml/602/
        - text: ", 14 July 2013"
      - paragraph:
        - text: "Photo:"
        - link "Love Art Nouveau":
          - /url: https://commons.wikimedia.org/wiki/File:The_Black_Friar_Pub,_London_(8484501967).jpg
        - text: ","
        - link "CC BY 2.0":
          - /url: https://creativecommons.org/licenses/by/2.0
    - region "Cheapest listed in City of London":
      - heading "Cheapest listed in City of London" [level=2]
      - list:
        - listitem:
          - link "The Crosse Keys £2.99":
            - /url: /map?sel=venue-zottpx&log=1&price=2.99
        - listitem:
          - link "The Liberty Bounds £2.99":
            - /url: /map?sel=venue-1542m3&log=1&price=2.99
        - listitem:
          - link "The Sir John Hawkshaw £3.49":
            - /url: /map?sel=venue-sjcbdo&log=1&price=3.49
  - region "Streets the map sits on.":
    - paragraph: London
    - heading "Streets the map sits on." [level=2]
    - list "Founder photographs of London":
      - listitem:
        - figure "Southwark":
          - img "The Shard seen down a Southwark street under a mackerel sky, London"
          - text: Southwark
      - listitem:
        - figure "Canary Wharf":
          - img "Canary Wharf at night with lit towers, the Caravan terrace and string lights, London"
          - text: Canary Wharf
      - listitem:
        - figure "Canary Wharf":
          - img "Canary Wharf from a rooftop at golden hour over the Crossrail Place glass roof, London"
          - text: Canary Wharf
      - listitem:
        - figure "Exhibition Road":
          - img "The Geological Museum entrance on Exhibition Road with people sitting outside, London"
          - text: Exhibition Road
      - listitem:
        - figure "The Crown Tavern":
          - img "A tree-lined London square with The Crown Tavern on the corner in summer"
          - text: The Crown Tavern
      - listitem:
        - figure "Leadenhall Market":
          - img "The City of London street with the Leadenhall Market arcade and Boxhall, Victorian brick and glass towers behind"
          - text: Leadenhall Market
      - listitem:
        - figure "Canary Wharf":
          - img "Canary Wharf at sunset between glass towers and the Crossrail Place roof with sun flare, London"
          - text: Canary Wharf
      - listitem:
        - figure "Crossrail Place":
          - img "The Crossrail Place roof and tower walkway at golden hour near the Elizabeth line entrance, London"
          - text: Crossrail Place
      - listitem:
        - figure "The Thames at Blackfriars":
          - img "The Thames foreshore with Blackfriars Bridge, Unilever House and the dome of St Pauls under a clear sky, London"
          - text: The Thames at Blackfriars
      - listitem:
        - figure "Westminster":
          - img "Big Ben and the Houses of Parliament with a red double-decker bus in bright sun, London"
          - text: Westminster
    - paragraph: Photos by the PUBMAXX founder
  - region "Today and tonight":
    - heading "Today and tonight" [level=2]
    - link "What’s on today 22°C feels like, cloudy, 2% chance of rain, 13 km/h wind. Wednesday 30 September":
      - /url: /today
    - link "What’s on tonight 12 pubs people are talking about tonight. Wednesday 30 September":
      - /url: /tonight
  - region "What it saves you":
    - paragraph: The average listed pint across 950 London pubs is £5.54. In the cheapest third it is £4.17. That is £1.37 a pint you keep.
    - link "Open the map":
      - /url: /map
  - region "Questions people ask":
    - heading "Questions people ask" [level=2]
    - term: How does PUBMAXXING work?
    - definition: Say where you are and we show what a pint costs at the pubs around you, cheapest first. Each figure carries the day it was collected, and names the publisher when the record has one. Nothing else sets the order, and no pub can pay to sit higher.
    - term: Where do the prices come from?
    - definition: Two places. A pub's own published price list, which we name and link beside the figure. And drinkers, who log what they paid on the day they paid it. When no publisher is recorded for a price, the price says so. We would rather leave a gap than invent a figure.
    - term: How do I log a price?
    - definition: Open a pub on the map and press the price door. Type what you paid and which drink it was, then press Log it. A photo of the bill or the pint is optional. Photos and notes are public and can show people, so only add one you are happy to share.
    - term: What is on today and tonight?
    - definition: Today reads the London weather and says what sort of drinking day it is. Tonight lists what is on across the city through the evening, from published listings. Both cards near the top of this page stamp the day they speak for, so you can tell a fresh answer from a held one.
    - term: Does it work outside London?
    - definition: Not for prices yet. Every listed price we hold today is a London one. The map opens in eleven other UK cities, and a pub there stays without a price until somebody logs the first one.
    - term: Is there an app?
    - definition: This site installs to your home screen today. Open it in your phone browser and choose Add to Home Screen, and it opens full screen from then on. We are building the App Store and Play Store versions now.
- contentinfo:
  - link "PUBMAXXING home":
    - /url: /
    - img "PUBMAXX"
  - paragraph: When a price record names a publisher, we name and link it. When no publisher is recorded, the price says so. The ones drinkers log come with the day they were seen, and no pub can pay to rank higher.
  - navigation "Footer":
    - heading "Get out tonight" [level=2]
    - link "The map":
      - /url: /map
    - link "Find my pint":
      - /url: /near
    - link "Tonight":
      - /url: /tonight
    - link "Plan a night":
      - /url: /plan
    - heading "More" [level=2]
    - link "Social":
      - /url: /social
    - link "Pub Pal":
      - /url: /pal
    - link "Pick your city":
      - /url: /places
    - link "About":
      - /url: /about
  - navigation "Small print":
    - link "Privacy":
      - /url: /privacy
    - link "Terms of use":
      - /url: /terms
    - link "Contact":
      - /url: mailto:karan@pubmaxxing.com
  - paragraph: © 2026 PUBMAXX / Karan Manoharan
  - paragraph:
    - text: PUBMAXX is for over-18s. Know your limits, and know the facts at
    - link "drinkaware.co.uk":
      - /url: https://www.drinkaware.co.uk
    - text: . Prices change, so check at the bar.
- alert
```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | 
  3   | // P3.11 smoke suite. High-signal, non-flaky, WebGL-agnostic: nothing here asserts
  4   | // that the MapLibre canvas actually paints (headless boxes have no GPU), only
  5   | // that the observable app scaffolding mounts and the honesty/theme guarantees hold.
  6   | 
  7   | // Collect uncaught page errors so a single console-fatal fails the run loudly.
  8   | function watchPageErrors(page: Page): string[] {
  9   |   const errors: string[] = [];
  10  |   page.on("pageerror", (err) => errors.push(err.message));
  11  |   return errors;
  12  | }
  13  | 
  14  | async function dismissMapFirstRunTour(page: Page): Promise<void> {
  15  |   await page.addInitScript(() => {
  16  |     window.localStorage.setItem("pubmax-tour-v1-done", "1");
  17  |     window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  18  |     window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  19  |   });
  20  | }
  21  | 
  22  | test.beforeEach(async ({ page }) => {
  23  |   await dismissMapFirstRunTour(page);
  24  | });
  25  | 
  26  | test("landing / serves, shows hero + Demo honesty label + a direct map CTA", async ({
  27  |   page,
  28  | }) => {
  29  |   const errors = watchPageErrors(page);
  30  | 
  31  |   const response = await page.goto("/");
  32  |   expect(response?.status()).toBe(200);
  33  | 
  34  |   // Hero headline (stable id in components/landing/LandingPage.tsx). Assert the
  35  |   // current product promise rather than retired campaign copy.
  36  |   await expect(page.locator("#hero-title")).toContainText(
  37  |     "What a pint costs, pub by pub.",
  38  |   );
  39  | 
  40  |   // Honesty guarantee: seeded demo cards are labelled "Demo" (P4 unified
  41  |   // provenance vocabulary — see lib/provenanceLabels.ts).
> 42  |   await expect(page.getByText("Demo").first()).toBeVisible();
      |                                                ^ Error: expect(locator).toBeVisible() failed
  43  | 
  44  |   // Map entry is direct. City choice remains a separate, labelled route.
  45  |   const cta = page.getByRole("link", { name: /open the map/i }).first();
  46  |   await expect(cta).toHaveAttribute("href", "/map");
  47  |   await cta.click();
  48  |   await expect(page).toHaveURL(/\/map$/);
  49  | 
  50  |   expect(errors).toEqual([]);
  51  | });
  52  | 
  53  | test("landing hero headline renders the display face at a deliberate (>=600) weight", async ({
  54  |   page,
  55  | }) => {
  56  |   // Regression guard for the "font looks thin" defect: Space Grotesk is a
  57  |   // variable font, so a heading with no explicit font-weight falls to the 400
  58  |   // default and reads thin. The base h1/h2/h3 rules in globals.css set 600 —
  59  |   // assert the computed weight so a future revert (e.g. a co-dev overwrite)
  60  |   // fails loudly. Also assert the display face is actually wired: the computed
  61  |   // family must name Space Grotesk (guards against --font-display losing its
  62  |   // next/font wiring or --serif being repointed at a fallback stack).
  63  |   await page.goto("/");
  64  |   const hero = page.locator("#hero-title");
  65  |   await expect(hero).toBeVisible();
  66  |   await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);
  67  |   const { weight, family } = await hero.evaluate((el) => {
  68  |     const cs = getComputedStyle(el);
  69  |     return { weight: parseInt(cs.fontWeight, 10), family: cs.fontFamily };
  70  |   });
  71  |   expect(weight).toBeGreaterThanOrEqual(600);
  72  |   expect(family).toMatch(/Space Grotesk/i);
  73  | });
  74  | 
  75  | test("/map mounts the map region (canvas OR fallback)", async ({ page }) => {
  76  |   const response = await page.goto("/map");
  77  |   expect(response?.status()).toBe(200);
  78  | 
  79  |   // The map is a dynamic import (ssr:false) behind a loading shell, slow to
  80  |   // hydrate under 4-worker parallel load — give it room so this doesn't flake.
  81  |   // The wrapper always renders once PubMap mounts; inside it is EITHER the
  82  |   // maplibre container (GPU present) OR the "Map renderer unavailable" fallback
  83  |   // (headless/no-WebGL). Pass on either so it stays green regardless of GPU.
  84  |   await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20000 });
  85  |   const canvasOrFallback = page.locator(".maplibreMap, .mapFallback").first();
  86  |   await expect(canvasOrFallback).toBeVisible({ timeout: 20000 });
  87  | 
  88  |   // ponytail: no pageerror assertion here. MapLibre GL emits async teardown
  89  |   // errors under headless timing (getLayer on a torn-down style) that are not
  90  |   // caused by app logic under test; the landing-page test above owns the
  91  |   // no-uncaught-errors guarantee on a deterministic surface.
  92  | });
  93  | 
  94  | test("/feed mounts the social feed scaffold without uncaught errors", async ({ page }) => {
  95  |   const errors = watchPageErrors(page);
  96  |   const response = await page.goto("/feed");
  97  |   expect(response?.status()).toBe(200);
  98  |   // The feed fetches /api/pint-drops and degrades to a social empty state on
  99  |   // failure, so we assert the always-present scaffold (site nav), not content.
  100 |   await expect(page.getByRole("link", { name: "Map", exact: true }).first()).toBeVisible();
  101 |   expect(errors).toEqual([]);
  102 | });
  103 | 
  104 | test("/feed redirects to Social and renders its reachable boundary state (issue #36)", async ({
  105 |   page,
  106 | }) => {
  107 |   const errors = watchPageErrors(page);
  108 |   await dismissMapFirstRunTour(page);
  109 |   const response = await page.goto("/feed");
  110 |   expect(response?.status()).toBe(200);
  111 | 
  112 |   // PR #765 (5adfb689) retired /feed's London-tab + Feed-lanes filter group
  113 |   // in favour of the unified Social shell. /feed now redirects to /social.
  114 |   // Default Chromium has no signed-in account. The exact launch copy can move,
  115 |   // but the reachable boundary must remain honest and actionable.
  116 |   await expect(
  117 |     page.getByRole("heading", { name: "Crews and people who are already here." }),
  118 |   ).toBeVisible();
  119 |   await expect(page.getByText("Sign in to use Social.")).toBeVisible();
  120 |   expect(errors).toEqual([]);
  121 | });
  122 | 
  123 | test("/bar-tab/[id] renders the venue Bar Tab for a real venue id (issue #36)", async ({
  124 |   page,
  125 | }) => {
  126 |   const errors = watchPageErrors(page);
  127 |   // Deep-link straight to a known seed pub's Bar Tab via the same stable FNV-1a
  128 |   // id helper the venue-sheet test uses — no canvas pin click needed.
  129 |   const response = await page.goto(`/bar-tab/${ARNOS_ARMS_ID}`);
  130 |   expect(response?.status()).toBe(200);
  131 |   // The header eyebrow is app-owned + stable ("The Bar Tab"); the venue name and
  132 |   // "Open on the map" cross-link always render for a resolvable id.
  133 |   await expect(page.getByText("The Bar Tab", { exact: true }).first()).toBeVisible();
  134 |   await expect(page.getByRole("link", { name: /open on the map/i }).first()).toBeVisible();
  135 |   expect(errors).toEqual([]);
  136 | });
  137 | 
  138 | test("/discover renders the cheap-pint leaderboard section", async ({ page }) => {
  139 |   const errors = watchPageErrors(page);
  140 |   const response = await page.goto("/discover");
  141 |   expect(response?.status()).toBe(200);
  142 |   // Stable, app-owned heading (id in app/discover/page.tsx).
```