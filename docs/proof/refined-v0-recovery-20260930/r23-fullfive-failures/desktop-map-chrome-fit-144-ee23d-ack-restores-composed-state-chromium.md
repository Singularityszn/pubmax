# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-map-chrome-fit.spec.ts >> 1440px planner hands ownership to venue and Back restores composed state
- Location: e2e/desktop-map-chrome-fit.spec.ts:321:5

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 800
Received:   785.600830078125
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=e3]:
    - navigation "Site navigation" [ref=e4]:
      - link "Open PUBMAXX landing page" [ref=e5] [cursor=pointer]:
        - /url: /
        - img "PUBMAXX" [ref=e6]:
          - generic [ref=e8]:
            - generic [ref=e9]: PUBMAX
            - generic [ref=e10]: X
      - list [ref=e11]:
        - listitem [ref=e12]:
          - link "Tonight" [ref=e13] [cursor=pointer]:
            - /url: /tonight
        - listitem [ref=e14]:
          - link "Map" [ref=e15] [cursor=pointer]:
            - /url: /map
        - listitem [ref=e16]:
          - link "Places" [ref=e17] [cursor=pointer]:
            - /url: /places
        - listitem [ref=e18]:
          - link "Out" [ref=e19] [cursor=pointer]:
            - /url: /out
        - listitem [ref=e20]:
          - link "Plan" [ref=e21] [cursor=pointer]:
            - /url: /plan
        - listitem [ref=e22]:
          - link "You" [ref=e23] [cursor=pointer]:
            - /url: /u/you
      - generic [ref=e24]:
        - button "More pages" [ref=e26] [cursor=pointer]:
          - generic [ref=e27]: More
        - link "Share a Moment" [ref=e30] [cursor=pointer]:
          - /url: /moment?returnTo=%2Fmap
        - button "Open command palette" [ref=e33] [cursor=pointer]:
          - generic [ref=e34]: ⌘K
        - link "Activity" [ref=e35] [cursor=pointer]:
          - /url: /activity
        - link "Messages" [ref=e39] [cursor=pointer]:
          - /url: /messages
        - button "Switch to dark theme" [ref=e42] [cursor=pointer]
        - button "Sign in" [ref=e47] [cursor=pointer]
    - region "Interactive pub map of London" [ref=e52]:
      - generic [ref=e53]:
        - generic [ref=e54]:
          - generic:
            - region "Map" [ref=e55]
            - button "17 pubs, tap to zoom in" [ref=e56] [cursor=pointer]:
              - img "17 pubs" [ref=e57]:
                - generic [ref=e64]: "17"
          - generic:
            - generic [ref=e65]:
              - button "Zoom in" [ref=e66] [cursor=pointer]
              - button "Zoom out" [ref=e68] [cursor=pointer]
            - group [ref=e70]:
              - generic "Toggle attribution" [ref=e71] [cursor=pointer]
        - 'button "Map layers: Tube, Rail, parks, and place stories" [ref=e72] [cursor=pointer]':
          - generic [ref=e77]: Layers
      - search [ref=e78]:
        - generic [ref=e79]:
          - generic [ref=e81]:
            - generic [ref=e82]:
              - generic [ref=e86]: Search pubs
              - combobox "Search pubs" [ref=e87]: Soho
              - button "Clear search" [ref=e88] [cursor=pointer]
            - status [ref=e92]
          - 'button "Filters: venue types, view and zone" [ref=e94] [cursor=pointer]':
            - generic [ref=e96]: Filters
          - 'button "Drink: Pints" [ref=e97] [cursor=pointer]'
          - button "Plan an outing" [ref=e102] [cursor=pointer]
          - 'button "Map area: London. Change city" [ref=e109] [cursor=pointer]':
            - generic [ref=e110]: London
      - complementary "First visit" [ref=e112]:
        - generic [ref=e113]:
          - heading "Cheapest pints near you?" [level=2] [ref=e114]
          - paragraph [ref=e115]: Location is used only while the map is open.
        - generic [ref=e116]:
          - button "Use my location" [ref=e117] [cursor=pointer]
          - button "Choose an area" [ref=e121] [cursor=pointer]
        - button "Close" [ref=e122] [cursor=pointer]
    - generic:
      - generic:
        - generic:
          - button
          - button
        - complementary:
          - generic:
            - generic:
              - paragraph: PUBMAXX
              - heading [level=1]: Design the right London pub crawl.
          - group:
            - button [pressed]: Suggest a crawl
            - button: Build your own
          - button: Pubs near me
          - generic:
            - textbox:
              - /placeholder: Search Shoreditch, Hackney, pub name…
              - text: Soho
          - generic:
            - generic: Featured routes
            - paragraph: Hand-picked crawls. One generation’s pubs, handed to the next.
            - generic:
              - button:
                - generic:
                  - strong: Victorian Soho
                  - generic: 5 stops
                - generic: Five Dean Street–era snugs the old Soho hands drank in. Pass the round on to whoever's next.
                - generic: Map route
              - button:
                - generic:
                  - strong: Fleet Street & the Writers
                  - generic: 6 stops
                - generic: The old press strip, Strand to Fleet Street, where a generation of hacks filed copy, then drank it back.
                - generic: Map route
              - button:
                - generic:
                  - strong: Bloomsbury Literary
                  - generic: 5 stops
                - generic: From the Museum Tavern down Lamb's Conduit Street, the reading-room-and-a-pint round handed down since the British Museum days.
                - generic: Map route
              - button:
                - generic:
                  - strong: Riverside Heritage
                  - generic: 4 stops
                - generic: St Katharine Docks east to Limehouse, the Thames-side taverns watermen and their grandkids still drink in at the turn of the tide.
                - generic: Map route
              - button:
                - generic:
                  - strong: A pint, a park, a view
                  - generic: 5 stops
                - generic: A City-fringe loop past Leadenhall Market that climbs to a free rooftop garden with one of London's best skyline views. A pint at each end of the climb.
                - generic: Map route
              - button:
                - generic:
                  - strong: Borough Market crawl
                  - generic: 5 stops
                - generic: A tight loop through the stalls and railway arches of Borough Market, London's oldest food market, trading since at least the 13th century, threaded between five pubs.
                - generic: Map route
              - button:
                - generic:
                  - strong: Bankside riverside walk
                  - generic: 4 stops
                - generic: Straight along the Thames path from Clink Street to the South Bank, the old wharves and a working riverside pub, with Tate Modern and the river the whole way.
                - generic: Map route
              - button:
                - generic:
                  - strong: Camden Market crawl
                  - generic: 4 stops
                - generic: From the lock down Camden High Street, market stalls, canal views, and the pubs that have watched Camden's music scene since punk.
                - generic: Map route
              - button:
                - generic:
                  - strong: Soho small plates
                  - generic: 5 stops
                - generic: A kitchen-first loop through Dean Street's food pubs. Proper plates between the pints, so nobody drinks on an empty stomach.
                - generic: Map route
              - button:
                - generic:
                  - strong: Westminster & Whitehall
                  - generic: 4 stops
                - generic: From the Admiralty to Trafalgar Square, the pubs civil servants and tourists share when Parliament is in session and the bells are ringing.
                - generic: Map route
              - button:
                - generic:
                  - strong: Barbican coding pint
                  - generic: 5 stops
                - generic: A Barbican-to-Old-Street loop through the City fringe, the after-work standup pint between the Square Mile studios and Silicon Roundabout.
                - generic: Map route
              - button:
                - generic:
                  - strong: Leicester Square soft round
                  - generic: 5 stops
                - generic: "A cocktail-bar loop off Leicester Square. Every stop mixes drinks, so it's an easy one to run alcohol-free: order the mocktail version of the round."
                - generic: Map route
              - button:
                - generic:
                  - strong: Historic pubs (Eating Europe guide)
                  - generic: 7 stops
                - generic: Seven stops from Eating Europe's London pubs guide. Heritage notes and stories only, never prices. A city-wide greatest-hits loop, not one tight walk.
                - generic: Map route
              - button:
                - generic:
                  - strong: Young's beer gardens
                  - generic: 10 stops
                - generic: Garden pubs from Young's own regional guides that match our London map. Official microsite links, beer-garden story, no invented prices.
                - generic: Map route
              - button:
                - generic:
                  - strong: Nicholson's West End
                  - generic: 8 stops
                - generic: A walkable Mayfair–Soho–Strand loop through Nicholson's historic pubs. Official menu and book links, no invented prices.
                - generic: Map route
          - generic:
            - generic: Crawl Style
            - group:
              - button [pressed]: Balanced
              - button: Alcohol-free first
              - button: Cheapest
              - button: Historic
              - button: Writer Trail
              - button: Beer Garden
              - button: Live Sports
              - button: Date Night
          - generic:
            - generic:
              - generic: Max Pint
              - strong: Any
            - slider: "10"
            - generic:
              - generic: Stops
              - strong: "6"
            - slider: "6"
            - generic:
              - generic: Max walk between stops
              - strong: 20 min
            - slider: "20"
          - generic:
            - generic:
              - generic: Story Filters
              - button: Reset
            - generic:
              - checkbox
              - text: Saved only
            - generic:
              - checkbox
              - text: By the water
            - generic:
              - checkbox
              - text: Heritage note
            - generic:
              - checkbox
              - text: Has Pint Drops
            - generic:
              - checkbox
              - text: Beer garden
            - generic:
              - checkbox
              - text: Non-alcoholic
            - generic:
              - checkbox
              - text: Live sports
            - generic:
              - checkbox
              - text: Serves food
            - generic:
              - checkbox
              - text: Cocktails
            - generic:
              - checkbox
              - text: Verified listings only
            - paragraph: Off by default so scraped Young's / Nicholson's / guide pins stay on the map.
            - generic:
              - checkbox
              - text: Open now
          - generic:
            - generic: Accessible venues
            - paragraph:
              - text: Only pubs with access we can
              - strong: confirm
              - text: from a public source. Unknown pubs are hidden here rather than guessed. Help by spilling what you know.
            - generic:
              - checkbox
              - text: Step-free entry
            - generic:
              - checkbox
              - text: Accessible toilet
            - generic:
              - checkbox
              - text: Seated service
          - generic:
            - generic:
              - generic: Matched
              - strong: "9"
            - generic:
              - generic: ≤ £5.50
              - strong: "0"
            - generic:
              - generic: Water
              - strong: "0"
            - generic:
              - generic: Heritage
              - strong: "4"
            - generic:
              - generic: Writer
              - strong: "0"
          - generic:
            - generic:
              - generic:
                - paragraph: "@London_W4"
                - heading [level=2]: Alastair Hilton
            - paragraph: "A photographer-led view of pubs: what they look like, why they are loved, and why people should still visit them."
            - generic:
              - generic: The Greatest Pubs
              - generic: Narrowboat London
            - list:
              - listitem: The book is a 156-page signed hardback covering 44 pubs.
              - listitem: His guide profiles describe private historic London pub tours with stories and history facts.
              - listitem: His shop includes pub prints such as The City Barge, The Grapes, The Sun Tavern, and The Queens.
            - generic:
              - link:
                - /url: https://www.alastairhiltonphotographer.com/product-page/the-greatest-pubs
                - text: The Greatest Pubs
              - link:
                - /url: https://x.com/London_W4
                - text: London_W4 on X
              - link:
                - /url: https://camdenguidedwalks.co.uk/london-tour-guide-alastair.php
                - text: Historic pub tours
        - complementary:
          - generic:
            - generic:
              - paragraph: Suggested Plan
              - heading [level=2]: Balanced plan
            - button: Copy link
          - radiogroup:
            - radio [checked]: Pint
            - radio: Food
            - radio: Coffee
            - radio: Mocktail
          - generic:
            - generic:
              - generic: £12.65
              - generic: estimated round
            - generic:
              - generic: 0.9 km
              - generic: straight-line, between stops
            - generic:
              - generic: 13 min
              - generic: walking, straight-line
            - generic:
              - generic: 15 min
              - generic: TfL between stops
            - generic:
              - generic: "6"
              - generic: pint stops
            - generic:
              - generic: "4"
              - generic: story pubs
            - generic:
              - generic: "0"
              - generic: by water
            - generic:
              - generic: "0"
              - generic: writer picks
          - group:
            - button [pressed]: Walk
            - button: Run
            - generic: 13 min walk total · 0.9 km, straight-line
          - generic:
            - generic:
              - strong: Map this plan?
              - generic: 0.9 km, 13 min walk, straight-line.
            - button: Map route
          - generic:
            - paragraph: Invite friends to walk this plan as a Round.
            - generic:
              - generic: The Round · group crawl
              - heading [level=2]: Invite friends to this plan
              - paragraph: Turn this plan into a Round. Friends join by a short code; stops are already queued.
              - generic:
                - textbox:
                  - /placeholder: your handle
                - button: Start Round
          - button: Add to calendar (.ics)
          - button: Check last train at final stop
          - generic:
            - button: Start this crawl
          - button: Save as story
          - list:
            - listitem:
              - button:
                - generic: "1"
                - generic:
                  - strong: Golden Lion (Soho)
                  - paragraph: £6.40 ·
                  - generic: Westminster
              - link:
                - /url: https://www.google.com/maps/dir/?api=1&destination=51.5125,-0.131572&travelmode=walking
                - generic: Directions
              - generic: 1 min walk · 0.1 km, straight-line
            - listitem:
              - button:
                - generic: "2"
                - generic:
                  - strong: Comptons of Soho
                  - paragraph: No price ·
                  - generic: Westminster
              - link:
                - /url: https://www.google.com/maps/dir/?api=1&destination=51.5126,-0.1326&travelmode=walking
                - generic: Directions
              - generic:
                - generic: 3 min walk · 0.2 km, straight-line
                - paragraph: "On the way: Berwick Street"
            - listitem:
              - button:
                - generic: "3"
                - generic:
                  - strong: The Ship Soho
                  - paragraph: No price ·
                  - generic: Westminster
              - link:
                - /url: https://www.google.com/maps/dir/?api=1&destination=51.51409,-0.13417&travelmode=walking
                - generic: Directions
              - generic:
                - generic: 5 min walk · 0.4 km, straight-line
                - paragraph: "On the way: Berwick Street"
            - listitem:
              - button:
                - generic: "4"
                - generic:
                  - strong: Shakespeares Head (Soho)
                  - paragraph: £6.25 ·
                  - generic: Westminster
              - link:
                - /url: https://www.google.com/maps/dir/?api=1&destination=51.5137,-0.139559&travelmode=walking
                - generic: Directions
              - generic: 1 min walk · 0.1 km, straight-line
            - listitem:
              - button:
                - generic: "5"
                - generic:
                  - strong: The Clachan
                  - paragraph: No price ·
                  - generic: Westminster
              - link:
                - /url: https://www.google.com/maps/dir/?api=1&destination=51.51353,-0.14023&travelmode=walking
                - generic: Directions
              - generic: 3 min walk · 0.2 km, straight-line
            - listitem:
              - button:
                - generic: "6"
                - generic:
                  - strong: The Argyll Arms
                  - paragraph: No price ·
                  - generic: Westminster
              - link:
                - /url: https://www.google.com/maps/dir/?api=1&destination=51.51506,-0.14126&travelmode=walking
                - generic: Directions
    - dialog "Bar detail" [ref=e126]:
      - generic [ref=e127]:
        - generic [ref=e128]:
          - button "Back to Plan an outing" [ref=e129] [cursor=pointer]
          - button "Close and return to the London map" [active] [ref=e132] [cursor=pointer]
        - status [ref=e136]:
          - generic [ref=e137]: Loading full bar details…
        - generic [ref=e152]:
          - generic [ref=e153]: Westminster · Bar
          - heading "Three Sheets Soho" [level=3] [ref=e155]
          - img "Three Sheets Soho exterior or bar interior photo" [ref=e156]:
            - generic [ref=e157]: No photo yet
          - tablist "Venue detail sections" [ref=e165]:
            - tab "Overview" [selected] [ref=e166] [cursor=pointer]
            - tab "Photos" [ref=e167] [cursor=pointer]
            - tab "Drinks" [ref=e168] [cursor=pointer]
            - tab "Lore" [ref=e169] [cursor=pointer]
          - tabpanel "Overview" [ref=e170]:
            - paragraph [ref=e171]: 13 manette street, london w1d 4ap
            - group "Find booking" [ref=e172]:
              - link "Find booking" [ref=e173] [cursor=pointer]:
                - /url: https://www.google.com/maps/search/?api=1&query=Three%20Sheets%20Soho%2013%20manette%20street%2C%20london%20w1d%204ap%20book%20a%20table
            - region "How busy it is right now" [ref=e181]:
              - heading "How busy is it right now?" [level=3] [ref=e182]
              - paragraph [ref=e183]: Checking how busy it is.
              - status [ref=e184]
              - paragraph [ref=e185]:
                - link "Sign in to report" [ref=e186] [cursor=pointer]:
                  - /url: /login?mode=signin&from=%2Fmap%3Fsel%3Dbar-three-sheets-soho
            - region [ref=e187]:
              - generic [ref=e188]:
                - generic [ref=e189]:
                  - text: On the night
                  - heading "Visits, written up" [level=3] [ref=e190]
                - button "Open Lore" [ref=e191] [cursor=pointer]
              - status [ref=e192]: Checking visit notes.
            - group [ref=e193]:
              - generic "Details and practical info +" [ref=e194] [cursor=pointer]
            - group [ref=e195]:
              - generic "Last train +" [ref=e196] [cursor=pointer]
            - group [ref=e197]:
              - generic "What drinkers noticed Checking access" [ref=e198] [cursor=pointer]:
                - generic [ref=e199]: What drinkers noticed
                - generic [ref=e203]: Checking access
            - region "Drink prices at Three Sheets Soho" [ref=e206]:
              - status [ref=e208]: Checking beer prices logged here.
            - generic [ref=e209]:
              - generic [ref=e210]:
                - generic [ref=e211]: Sourced
                - text: Three Sheets seasonal cocktail
              - generic [ref=e212]: £14.00
              - generic [ref=e213]:
                - text: Jul ·
                - link "source" [ref=e214] [cursor=pointer]:
                  - /url: https://www.threesheets-bar.com/soho
              - generic [ref=e215]: Not a pint price.
            - button "Save Three Sheets Soho to a list" [ref=e216] [cursor=pointer]
            - button "Save Three Sheets Soho for a night" [ref=e218] [cursor=pointer]: Save for a night
            - button "Mark that you're at Three Sheets Soho tonight" [ref=e220] [cursor=pointer]: I'm here
          - toolbar "Venue actions" [ref=e224]:
            - button "Share Three Sheets Soho" [ref=e225] [cursor=pointer]: Share
  - alert [ref=e232]
```

# Test source

```ts
  323 | }) => {
  324 |   test.setTimeout(120_000);
  325 |   await prepareDesktopMap(page);
  326 |   await stubCityStatus(page);
  327 | 
  328 |   const response = await page.goto("/map?desktop-drawer-exchange=1440", {
  329 |     waitUntil: "domcontentloaded",
  330 |   });
  331 |   expect(response?.status()).toBe(200);
  332 | 
  333 |   const toolbar = page.locator(".mapToolbar");
  334 |   await expect(toolbar).toBeVisible({ timeout: 20_000 });
  335 |   await page.getByRole("button", { name: /Map layers:/ }).click();
  336 |   await expect(async () => {
  337 |     await page.getByRole("button", { name: "List view" }).click();
  338 |     await expect(page.locator(".mapVenueList--open")).toBeVisible({ timeout: 1_000 });
  339 |   }).toPass({ timeout: 20_000 });
  340 |   const retargetVenue = page
  341 |     .locator(".mapVenueListItem")
  342 |     .filter({ hasNotText: "Three Sheets Soho" })
  343 |     .first();
  344 |   await expect(retargetVenue).toHaveCount(1, { timeout: 20_000 });
  345 |   await toolbar
  346 |     .getByRole("button", { name: "Plan an outing" })
  347 |     .evaluate((button) => (button as HTMLElement).click());
  348 | 
  349 |   const planner = page.locator(".mapDrawer.left.springDrawer");
  350 |   const venue = page.locator(".mapDrawer.right.springDrawer");
  351 |   const mapStage = page.locator(".mapStage");
  352 |   await expect(planner).toHaveAttribute("aria-hidden", "false");
  353 |   await expect(planner.locator("#railSearchInput")).toBeVisible();
  354 |   await expect
  355 |     .poll(async () => (await renderedBox(planner, "planner rail")).x)
  356 |     .toBeCloseTo(0, 0);
  357 | 
  358 |   const mapBefore = await renderedBox(mapStage, "map stage before exchange");
  359 | 
  360 |   const firstVenueOption = await indexedToolbarPubOption(page, "Soho", 0);
  361 |   const toolbarBeforeOwnershipChange = await renderedBox(
  362 |     toolbar,
  363 |     "toolbar before ownership change",
  364 |   );
  365 |   await captureDrawerExchange(page, "planner-open");
  366 |   const ownershipChange = await firstVenueOption.evaluate((option) => {
  367 |     const toolbar = document.querySelector<HTMLElement>(".mapToolbar");
  368 |     if (!toolbar) throw new Error("desktop toolbar is missing");
  369 |     const before = toolbar.getBoundingClientRect().x;
  370 |     (option as HTMLElement).click();
  371 |     return {
  372 |       before,
  373 |       after: toolbar.getBoundingClientRect().x,
  374 |     };
  375 |   });
  376 |   expect(
  377 |     Math.abs(ownershipChange.after - ownershipChange.before),
  378 |   ).toBeLessThan(16);
  379 | 
  380 |   // Fully off-screen is also x < -1, so wait for a frame that is still
  381 |   // crossing rather than sampling after the spring has finished. Under load the
  382 |   // spring can finish before the first sample, so mid-exchange geometry is
  383 |   // asserted only when a crossing frame is caught.
  384 |   let midExchange: { planner: { x: number; width: number }; venue: { x: number; width: number }; toolbar: { x: number; width: number } } | null = null;
  385 |   try {
  386 |     await expect
  387 |       .poll(
  388 |         async () => {
  389 |           const sample = await page.evaluate(() => {
  390 |             const rect = (selector: string) => {
  391 |               const node = document.querySelector<HTMLElement>(selector);
  392 |               if (!node) throw new Error(`Missing ${selector} during drawer exchange`);
  393 |               const { x, width } = node.getBoundingClientRect();
  394 |               return { x, width };
  395 |             };
  396 |             return {
  397 |               planner: rect(".mapDrawer.left.springDrawer"),
  398 |               venue: rect(".mapDrawer.right.springDrawer"),
  399 |               toolbar: rect(".mapToolbar"),
  400 |             };
  401 |           });
  402 |           if (sample.planner.x < -1 && sample.planner.x > -sample.planner.width) {
  403 |             midExchange = sample;
  404 |             return true;
  405 |           }
  406 |           return false;
  407 |         },
  408 |         {
  409 |           intervals: [8, 8, 8, 8, 16, 16, 32],
  410 |           timeout: 8_000,
  411 |         },
  412 |       )
  413 |       .toBe(true);
  414 |   } catch {
  415 |     midExchange = null;
  416 |   }
  417 |   let toolbarMid: { x: number; width: number } | null = null;
  418 |   if (midExchange) {
  419 |     const { planner: plannerMid, venue: venueMid } = midExchange;
  420 |     toolbarMid = midExchange.toolbar;
  421 |     expect(plannerMid.x).toBeLessThan(0);
  422 |     expect(plannerMid.x).toBeGreaterThan(-plannerMid.width);
> 423 |     expect(venueMid.x).toBeGreaterThan(800);
      |                        ^ Error: expect(received).toBeGreaterThan(expected)
  424 |     expect(venueMid.x).toBeLessThan(DESKTOP.width);
  425 |     await captureDrawerExchange(page, "mid-exchange");
  426 |   }
  427 | 
  428 |   await expect(planner).toHaveAttribute("aria-hidden", "true");
  429 |   await expect(venue).toHaveAttribute("aria-hidden", "false");
  430 | 
  431 |   const venueBeforeRetarget = await renderedBox(
  432 |     venue,
  433 |     "venue before mid-spring retarget",
  434 |   );
  435 |   const retargetVenueName = await retargetVenue.evaluate((button) => {
  436 |     const name = button
  437 |       .querySelector<HTMLElement>(".mapVenueListItemName")
  438 |       ?.innerText.trim();
  439 |     if (!name) throw new Error("retarget venue name is missing");
  440 |     (button as HTMLElement).click();
  441 |     return name;
  442 |   });
  443 |   await page.waitForTimeout(16);
  444 |   const venueAfterRetarget = await renderedBox(
  445 |     venue,
  446 |     "venue after mid-spring retarget",
  447 |   );
  448 |   expect(venueAfterRetarget.x).toBeLessThanOrEqual(
  449 |     venueBeforeRetarget.x + 10,
  450 |   );
  451 | 
  452 |   await expect
  453 |     .poll(() => page.locator(".mapDrawer.springDrawer.open").count(), {
  454 |       message: "one desktop drawer owns the surface after exchange",
  455 |     })
  456 |     .toBe(1);
  457 |   await expect(
  458 |     venue.getByRole("heading", { name: retargetVenueName }).first(),
  459 |   ).toBeVisible({ timeout: 20_000 });
  460 | 
  461 |   const [mapAfter, venueOpen, toolbarOpen] = await Promise.all([
  462 |     renderedBox(mapStage, "map stage after exchange"),
  463 |     renderedBox(venue, "open venue drawer"),
  464 |     renderedBox(toolbar, "toolbar beside venue"),
  465 |   ]);
  466 |   expect(venueOpen.x).toBeCloseTo(800, 0);
  467 |   expect(toolbarOpen.x + toolbarOpen.width).toBeLessThanOrEqual(
  468 |     venueOpen.x - EDGE_GUTTER + SUBPIXEL_TOLERANCE,
  469 |   );
  470 |   if (toolbarMid) {
  471 |     expect(toolbarMid.x).toBeLessThan(toolbarBeforeOwnershipChange.x);
  472 |     expect(toolbarMid.x).toBeGreaterThan(toolbarOpen.x);
  473 |   }
  474 |   expect(mapAfter).toEqual(mapBefore);
  475 |   await captureDrawerExchange(page, "venue-open");
  476 |   await expect(
  477 |     venue.getByRole("button", { name: "Back to Plan an outing" }),
  478 |   ).toBeVisible();
  479 |   await expect(
  480 |     venue.getByRole("button", { name: "Close and return to the London map" }),
  481 |   ).toBeVisible();
  482 | 
  483 |   await venue
  484 |     .getByRole("button", { name: "Back to Plan an outing" })
  485 |     .click();
  486 |   await expect(planner).toHaveAttribute("aria-hidden", "false");
  487 |   await expect(planner.locator("#railSearchInput")).toHaveValue(
  488 |     "Soho",
  489 |   );
  490 |   await expect
  491 |     .poll(() => page.locator(".mapDrawer.springDrawer.open").count(), {
  492 |       message: "Back restores planner as sole desktop drawer",
  493 |     })
  494 |     .toBe(1);
  495 |   await expect
  496 |     .poll(async () => (await renderedBox(planner, "restored planner")).x)
  497 |     .toBeCloseTo(0, 0);
  498 |   await captureDrawerExchange(page, "back-restored-planner");
  499 | });
  500 | 
  501 | test("1440px Plan an outing takes ownership from an open venue", async ({
  502 |   page,
  503 | }) => {
  504 |   await prepareDesktopMap(page);
  505 |   await stubCityStatus(page);
  506 | 
  507 |   const response = await page.goto("/map?desktop-drawer-owner=planner", {
  508 |     waitUntil: "domcontentloaded",
  509 |   });
  510 |   expect(response?.status()).toBe(200);
  511 | 
  512 |   const toolbar = page.locator(".mapToolbar");
  513 |   const venue = page.locator(".mapDrawer.right.springDrawer");
  514 |   await expect(toolbar).toBeVisible({ timeout: 20_000 });
  515 |   await selectToolbarPub(page, "The French House", /The French House/);
  516 |   await expect(venue).toHaveAttribute("aria-hidden", "false");
  517 | 
  518 |   // This branch owns only the captain's synchronous drawer decision. Selection
  519 |   // and surface history remain separate owners, and the later traversal race is
  520 |   // deliberately handed off in data/nomistakes-land-two-fixes. Capture the
  521 |   // first React commit so this regression cannot accidentally wait for, or
  522 |   // claim to reconcile, that deferred history work.
  523 |   const ownership = await firstDrawerOwnershipCommit(
```