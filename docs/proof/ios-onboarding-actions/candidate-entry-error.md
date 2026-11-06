# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-onboarding-actions.spec.ts >> clean onboarding actions stay reachable at 390x844 in light
- Location: e2e/native-onboarding-actions.spec.ts:26:9

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'London is ready.' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('heading', { name: 'London is ready.' })

```

```yaml
- link "Skip to main content":
  - /url: "#main"
- banner:
  - link "PUBMAXXING home":
    - /url: /
    - img "PUBMAXX"
  - link "Activity":
    - /url: /activity
  - link "Messages":
    - /url: /messages
  - button "Switch to dark theme"
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
      - paragraph: £6.50 a pint of Pravha
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
  - region "Before you set off":
    - heading "Before you set off" [level=2]
    - link "What’s on today We could not read today's London weather just now. Monday 7 September":
      - /url: /today
    - link "What’s on tonight Nothing is listed across London tonight yet. Monday 7 September":
      - /url: /tonight
  - region "The cheapest listed pint near you, on one map.":
    - paragraph: What it saves you
    - heading "The cheapest listed pint near you, on one map." [level=2]
    - paragraph: The average listed pint across 952 London pubs is £5.53. In the cheapest third it is £4.16. That is £1.37 a pint you keep.
    - link "Open the map":
      - /url: /map
  - paragraph: Fresh from the taps
  - list "Latest community Pint Drops":
    - listitem:
      - text: "@wapping_wall_ted £6.40"
      - paragraph: My old man swore the flagstone floor by the bar was laid when the watermen still drank…
      - text: Told since the 1960s Demo
    - listitem:
      - text: "@tessa_of_shadwell £6.10"
      - paragraph: Nan cleaned here in the fifties and said the pewter bar top was older than anyone who…
      - text: Nan's shift, 1950s Demo
    - listitem:
      - text: "@limehouse_reach £5.80"
      - paragraph: Dad always took the window seat over the water and said Dickens put this room in a book…
      - text: Dad's rule, 1980s Demo
    - listitem:
      - text: "@narrowstreet_nell £5.60"
      - paragraph: Grandma said at a proper high tide the balcony feels like the deck of a barge. She was…
      - text: High-tide advice Demo
    - listitem:
      - text: "@hammersmith_oar £7.20"
      - paragraph: Grandad rowed off the Mall and called the front snug the smallest bar in England long…
      - text: Rowing club lore Demo
    - listitem:
      - text: "@conduit_st_kit £6.50"
      - paragraph: Mum said her grandmother could order a port here without the saloon ever seeing her face.…
      - text: Great-grandmother's trick Demo
    - listitem:
      - text: "@chiswick_wheeler £5.90"
      - paragraph: My grandfather drank here when the trams still ran up the High Road. Same green tiles…
      - text: Since the trams Demo
    - listitem:
      - text: "@bethnal_iris £5.20"
      - paragraph: "Grandad came in after his market shifts and always said the same thing: a small room…"
      - text: Market-day habit Demo
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
    - paragraph: Pro is coming, at about £9.99 a month. Everything on this page stays free, and a drinker pays for nothing today.
    - text: Email
    - textbox "Email":
      - /placeholder: you@example.com
    - button "Tell me when Pro lands"
  - region "Choose your city":
    - paragraph: Cities
    - heading "Choose your city" [level=2]
    - paragraph: Open a price-aware pub map. Crawls and drink-shaped pins for the night you want.
    - text: Find your town
    - searchbox "Find your town"
    - paragraph: Twelve city maps, including one preview. London has pint prices; eight cities have crawls.
    - button "Use my location"
    - paragraph:
      - link "Browse pubs across the UK":
        - /url: /map?uk=1
    - navigation "City maps":
      - list:
        - listitem:
          - 'link "London: Price-aware crawls across the capital. Open map."':
            - /url: /map
            - text: London
            - paragraph: Price-aware crawls across the capital
        - listitem:
          - 'link "Manchester: Northern Quarter rounds and city-centre crawls. Open map."':
            - /url: /map/manchester
            - text: Manchester
            - paragraph: Northern Quarter rounds and city-centre crawls
        - listitem:
          - 'link "Birmingham: City-centre rounds and canal-side pubs. Open map."':
            - /url: /map/birmingham
            - text: Birmingham
            - paragraph: City-centre rounds and canal-side pubs
        - listitem:
          - 'link "Leeds: Arcade bars and Headingley terraces. Open map."':
            - /url: /map/leeds
            - text: Leeds
            - paragraph: Arcade bars and Headingley terraces
        - listitem:
          - 'link "Liverpool: Waterfront crawls and Merseyrail nights. Open map."':
            - /url: /map/liverpool
            - text: Liverpool
            - paragraph: Waterfront crawls and Merseyrail nights
        - listitem:
          - 'link "Oxford: College-town pints and riverside walks. Open map."':
            - /url: /map/oxford
            - text: Oxford
            - paragraph: College-town pints and riverside walks
        - listitem:
          - 'link "Durham: Cathedral-city snugs on a compact map. Open map."':
            - /url: /map/durham
            - text: Durham
            - paragraph: Cathedral-city snugs on a compact map
        - listitem:
          - 'link "Glasgow: West End crawls and Subway nights. Open map."':
            - /url: /map/glasgow
            - text: Glasgow
            - paragraph: West End crawls and Subway nights
        - listitem:
          - 'link "Bristol: Harbour-side rounds and hillside pubs. Open map."':
            - /url: /map/bristol
            - text: Bristol
            - paragraph: Harbour-side rounds and hillside pubs
        - listitem:
          - 'link "Cambridge: Back-lane pubs and riverside college crawls. Open map."':
            - /url: /map/cambridge
            - text: Cambridge
            - paragraph: Back-lane pubs and riverside college crawls
        - listitem:
          - 'link "Bath: Georgian streets and spa-city snugs. Open map."':
            - /url: /map/bath
            - text: Bath
            - paragraph: Georgian streets and spa-city snugs
        - listitem:
          - 'link "Llandudno, Preview: Seafront pubs from the Great Orme to Colwyn Bay. Open map."':
            - /url: /map/llandudno
            - text: Llandudno Preview
            - paragraph: Seafront pubs from the Great Orme to Colwyn Bay
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
    - heading "The good stuff" [level=2]
    - link "Social":
      - /url: /social
    - link "Pub Pal":
      - /url: /pal
    - link "Pick your city":
      - /url: /choose-city
    - link "Our story":
      - /url: /about
  - navigation "Small print":
    - link "Privacy":
      - /url: /privacy
    - link "Terms of use":
      - /url: /terms
    - link "Contact":
      - /url: mailto:support@pubmaxxing.com
  - paragraph:
    - text: PUBMAXX is for over-18s. Know your limits, and know the facts at
    - link "drinkaware.co.uk":
      - /url: https://www.drinkaware.co.uk
    - text: . Prices change, so check at the bar.
- navigation "Primary":
  - list:
    - listitem:
      - link "Now":
        - /url: /tonight
    - listitem:
      - link "Map":
        - /url: /map
    - listitem:
      - link "Places":
        - /url: /places
    - listitem:
      - link "Out":
        - /url: /out
    - listitem:
      - link "Social":
        - /url: /social
    - listitem:
      - link "You":
        - /url: /u/you
- button "Create"
- alert
```

# Test source

```ts
  1   | import { expect, test, type Locator, type Page } from "@playwright/test";
  2   | 
  3   | async function expectReachable(page: Page, action: Locator): Promise<void> {
  4   |   await expect(action).toBeInViewport({ ratio: 1 });
  5   |   const box = await action.boundingBox();
  6   |   expect(box).not.toBeNull();
  7   |   expect(box!.height).toBeGreaterThanOrEqual(44);
  8   |   expect(box!.width).toBeGreaterThanOrEqual(44);
  9   |   expect(await action.evaluate((button) => {
  10  |     const box = button.getBoundingClientRect();
  11  |     return button.contains(document.elementFromPoint(
  12  |       box.x + box.width / 2,
  13  |       box.y + box.height / 2,
  14  |     ));
  15  |   })).toBe(true);
  16  |   expect(await page.evaluate(() => document.documentElement.scrollWidth))
  17  |     .toBeLessThanOrEqual(page.viewportSize()!.width);
  18  | }
  19  | 
  20  | for (const viewport of [
  21  |   { width: 320, height: 568 },
  22  |   { width: 390, height: 844 },
  23  |   { width: 430, height: 932 },
  24  | ]) {
  25  |   for (const colorScheme of ["light", "dark"] as const) {
  26  |     test(`clean onboarding actions stay reachable at ${viewport.width}x${viewport.height} in ${colorScheme}`, async ({ page }, testInfo) => {
  27  |       await page.setViewportSize(viewport);
  28  |       await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  29  |       await page.addInitScript(() => {
  30  |         Object.defineProperty(window, "Capacitor", {
  31  |           configurable: true,
  32  |           value: { isNativePlatform: () => true, getPlatform: () => "ios" },
  33  |         });
  34  |       });
  35  |       await page.goto("/");
  36  |       await expect(page).toHaveURL(/\/onboarding$/);
> 37  |       await expect(page.getByRole("heading", { name: "London is ready." })).toBeVisible();
      |                                                                             ^ Error: expect(locator).toBeVisible() failed
  38  |       await expect(page.locator(".analyticsConsentPrompt")).toHaveCount(0);
  39  | 
  40  |       const london = page.getByRole("button", { name: "Use London" });
  41  |       expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  42  |       await expectReachable(page, london);
  43  |       await testInfo.attach("london-browser", { body: await page.screenshot(), contentType: "image/png" });
  44  |       await london.click();
  45  |       await expect(page.getByRole("heading", { name: "Pick your Pub Pal." })).toBeVisible();
  46  | 
  47  |       const plan = page.getByRole("button", { name: "Plan my night" });
  48  |       expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  49  |       await expectReachable(page, plan);
  50  |       await page.getByRole("button", { name: /Black Cat/ }).click();
  51  |       await expectReachable(page, plan);
  52  |       await testInfo.attach("companion-browser", { body: await page.screenshot(), contentType: "image/png" });
  53  | 
  54  |       const buttons = page.locator(".firstRunOnboarding button");
  55  |       await page.getByRole("button", { name: "Skip", exact: true }).focus();
  56  |       for (let index = 1; index < await buttons.count(); index += 1) {
  57  |         await page.keyboard.press("Tab");
  58  |         await expect(buttons.nth(index)).toBeFocused();
  59  |         await expectReachable(page, buttons.nth(index));
  60  |       }
  61  |       await page.locator(".firstRunOnboarding").evaluate((surface) => {
  62  |         surface.scrollTo(0, surface.scrollHeight);
  63  |       });
  64  |       await expect(page.locator(".firstRunPermissionNote")).toBeInViewport({ ratio: 1 });
  65  |       await page.getByRole("button", { name: "Back", exact: true }).click();
  66  |       await expectReachable(page, london);
  67  | 
  68  |       const lastArea = page.getByText("Piccadilly & Soho", { exact: true });
  69  |       await page.locator(".firstRunOnboarding").evaluate((surface) => {
  70  |         surface.scrollTo(0, surface.scrollHeight);
  71  |       });
  72  |       await expect(lastArea).toBeInViewport({ ratio: 1 });
  73  |       const areaBox = await lastArea.boundingBox();
  74  |       const actionBox = await london.boundingBox();
  75  |       expect(areaBox!.y + areaBox!.height).toBeLessThanOrEqual(actionBox!.y);
  76  |       await expectReachable(page, london);
  77  |     });
  78  |   }
  79  | 
  80  |   test(`onboarding actions survive consent dismissal at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  81  |     await page.setViewportSize(viewport);
  82  |     await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  83  |     await page.addInitScript(() => {
  84  |       Object.defineProperty(window, "Capacitor", {
  85  |         configurable: true,
  86  |         value: { isNativePlatform: () => true, getPlatform: () => "ios" },
  87  |       });
  88  |       // Seed the answer only for consent geometry, as ux-consent-chrome.spec.ts does.
  89  |       localStorage.removeItem("pubmaxx:analytics-consent:v1");
  90  |       sessionStorage.setItem("pubmax:consent-answer-moment:v1", "venue-sheet");
  91  |     });
  92  |     await page.goto("/");
  93  |     await expect(page).toHaveURL(/\/onboarding$/);
  94  |     const consent = page.getByLabel("Anonymous analytics choice");
  95  |     await expect(consent).toBeVisible();
  96  |     const london = page.getByRole("button", { name: "Use London" });
  97  |     expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  98  |     await expectReachable(page, london);
  99  |     await london.click();
  100 |     const plan = page.getByRole("button", { name: "Plan my night" });
  101 |     await expectReachable(page, plan);
  102 |     await consent.getByRole("button", { name: "No thanks" }).click();
  103 |     await expect(consent).toBeHidden();
  104 |     await expectReachable(page, plan);
  105 |     await page.getByRole("button", { name: "Back", exact: true }).click();
  106 |     await expectReachable(page, london);
  107 |   });
  108 | }
  109 | 
```