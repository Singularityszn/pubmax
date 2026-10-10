# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> mobile venue sheet (GH #17): opens at the peek snap with the grab handle visible at 390px
- Location: e2e/smoke.spec.ts:281:5

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 788
Received:   838
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=e3]:
    - region "Interactive pub map of London" [ref=e4]:
      - status "Loading the London pub map.":
        - generic:
          - generic:
            - generic: London pub map
            - generic: Loading London pubs…
      - generic [ref=e6]:
        - region "Map" [ref=e7]
        - group [ref=e8]:
          - generic "Toggle attribution" [ref=e9] [cursor=pointer]
  - navigation "Primary":
    - list [ref=e10]:
      - listitem [aria-hidden]
      - listitem [ref=e11]:
        - link "Tonight" [ref=e12] [cursor=pointer]:
          - /url: /tonight
      - listitem [ref=e20]:
        - link "Map" [ref=e21] [cursor=pointer]:
          - /url: /map
      - listitem [ref=e27]:
        - link "Places" [ref=e28] [cursor=pointer]:
          - /url: /places
      - listitem [ref=e34]:
        - link "Out" [ref=e35] [cursor=pointer]:
          - /url: /out
      - listitem [ref=e42]:
        - link "Plan" [ref=e43] [cursor=pointer]:
          - /url: /plan
      - listitem [ref=e51]:
        - link "You" [ref=e52] [cursor=pointer]:
          - /url: /u/you
  - generic:
    - button "Create"
  - alert [ref=e59]
  - generic:
    - button "Dismiss Arnos Arms backdrop"
    - dialog [active] [ref=e60]:
      - banner [ref=e61]:
        - button "Expand sheet" [ref=e62] [cursor=pointer]
        - heading "Arnos Arms" [level=2] [ref=e64]
        - button "Close pub detail" [ref=e65] [cursor=pointer]
      - generic [ref=e69]:
        - generic "Selected pub summary" [ref=e70]:
          - generic [ref=e71]:
            - generic [ref=e72]: £5.50
            - generic [ref=e73]: Listed · collected 2 Oct
          - generic [ref=e74]:
            - strong [ref=e75]: Near me
            - generic [ref=e76]: Turn on location for walk times
          - button "Plan stop" [ref=e77] [cursor=pointer]
        - generic [ref=e78]:
          - img "Arnos Arms exterior or pub interior photo" [ref=e79]:
            - generic [aria-hidden] [ref=e80]: No photo yet
          - tablist "Venue detail sections" [ref=e88]:
            - tab "Overview" [selected] [ref=e89] [cursor=pointer]
            - tab "Photos" [ref=e90] [cursor=pointer]
            - tab "Drinks" [ref=e91] [cursor=pointer]
            - tab "Stories" [ref=e92] [cursor=pointer]
            - tab "Lore" [ref=e93] [cursor=pointer]
          - tabpanel "Overview" [ref=e94]:
            - paragraph [ref=e95]: 338 Bowes Rd, Arnos Grove, London N11 1AN, UK
            - group "Book via site, Pub website" [ref=e96]:
              - link "Book via site" [ref=e97] [cursor=pointer]:
                - /url: https://www.arnosarms.co.uk/#/
              - link "Pub website" [ref=e105] [cursor=pointer]:
                - /url: https://www.arnosarms.co.uk/#/
            - region "How busy it is right now" [ref=e115]:
              - heading "How busy is it right now?" [level=3] [ref=e116]
              - paragraph [ref=e117]: No fresh reading
              - status [ref=e118]
              - paragraph [ref=e119]:
                - link "Sign in to report" [ref=e120] [cursor=pointer]:
                  - /url: /login?mode=signin&from=%2Fmap%3Fsel%3Dvenue-xjf3n0
            - region [ref=e121]:
              - generic [ref=e122]:
                - generic [ref=e123]:
                  - text: Your diary
                  - heading "Been here?" [level=3] [ref=e124]
                - button "Sign in to log a visit" [ref=e125] [cursor=pointer]
            - region [ref=e126]:
              - generic [ref=e127]:
                - generic [ref=e128]:
                  - text: On the night
                  - heading "Visits, written up" [level=3] [ref=e129]
                - button "Write yours on Lore" [ref=e130] [cursor=pointer]
              - paragraph [ref=e131]: No visits have been written up here yet.
            - group [ref=e132]:
              - generic "Details and practical info +" [ref=e133] [cursor=pointer]
            - group [ref=e134]:
              - generic "Last train +" [ref=e135] [cursor=pointer]
            - group [ref=e136]:
              - generic "What drinkers noticed Access unknown" [ref=e137] [cursor=pointer]:
                - generic [ref=e138]: What drinkers noticed
                - generic [ref=e142]: Access unknown
            - region "Drink prices logged at Arnos Arms" [ref=e145]:
              - status [ref=e147]: No beer price logged by a drinker here yet.
            - generic [ref=e148]:
              - generic [ref=e149]: Listed · collected 2 Oct
              - generic [ref=e150]: £5.50
              - generic [ref=e151]:
                - text: Dataset price from
                - link "Pint Prices" [ref=e152] [cursor=pointer]:
                  - /url: https://www.pint-prices.com/pub/338%20Bowes%20Road,%20Arnos%20Grove,%20London,%20N11%201AN/Arnos%20Arms
                - text: . Not a live tonight feed.
              - button "Log tonight's price at Arnos Arms" [ref=e153] [cursor=pointer]: Log tonight's price
            - button "Save Arnos Arms to a list" [ref=e156] [cursor=pointer]
            - button "Save Arnos Arms for a night" [ref=e158] [cursor=pointer]: Save for a night
            - button "Mark that you're at Arnos Arms tonight" [ref=e160] [cursor=pointer]: I'm here
      - toolbar "Venue actions" [ref=e165]:
        - button "Make Arnos Arms Stop 1" [ref=e166] [cursor=pointer]: Make it Stop 1
        - button "Share Arnos Arms" [ref=e169] [cursor=pointer]: Share
```

# Test source

```ts
  241 |     .locator(".mobileMapTopbar")
  242 |     .getByRole("button", { name: /^Filters/ });
  243 |   await expect(filters).toBeVisible();
  244 |   await filters.click();
  245 |   const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible');
  246 |   await expect(sheet).toHaveCount(1);
  247 |   // PR #695 (9b588362) renamed the filters sheet heading from "Drinks and
  248 |   // price" to "Prices and places" (see lib/mobileShell.ts).
  249 |   await expect(sheet.getByRole("heading", { name: "Prices and places" })).toBeVisible();
  250 | });
  251 | 
  252 | // Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey exactly (a
  253 | // tiny, stable, public hash) so this test can deep-link straight to a known
  254 | // seed pub's detail sheet without depending on canvas pin clicks — headless
  255 | // Chromium has no WebGL/GPU, so the MapLibre canvas doesn't reliably paint
  256 | // clickable pins (see the WebGL-agnostic note at the top of this file).
  257 | function stableVenueIdFromKey(key: string): string {
  258 |   let hash = 2166136261;
  259 |   for (let i = 0; i < key.length; i += 1) {
  260 |     hash ^= key.charCodeAt(i);
  261 |     hash = Math.imul(hash, 16777619);
  262 |   }
  263 |   return `venue-${(hash >>> 0).toString(36)}`;
  264 | }
  265 | 
  266 | function normaliseVenueKeyPart(value: string): string {
  267 |   return value.trim().toLowerCase().replace(/\s+/g, " ");
  268 | }
  269 | 
  270 | // A known seed row from public/data/pint_prices_app_dataset.json ("Arnos
  271 | // Arms") — stable dataset, so this id doesn't drift.
  272 | const ARNOS_ARMS_ID = stableVenueIdFromKey(
  273 |   [
  274 |     normaliseVenueKeyPart("Arnos Arms"),
  275 |     normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
  276 |     (51.6162).toFixed(5),
  277 |     (-0.132117).toFixed(5),
  278 |   ].join("|"),
  279 | );
  280 | 
  281 | test("mobile venue sheet (GH #17): opens at the peek snap with the grab handle visible at 390px", async ({
  282 |   page,
  283 | }) => {
  284 |   // iPhone-class width — the same viewport the nav-overflow test above uses,
  285 |   // and the width the drag bottom-sheet gesture is scoped to (≤640px).
  286 |   await page.setViewportSize({ width: 390, height: 844 });
  287 |   await dismissMapFirstRunTour(page);
  288 | 
  289 |   const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  290 |   expect(response?.status()).toBe(200);
  291 | 
  292 |   // The right drawer is the mobile bottom sheet (components/PubMap.tsx +
  293 |   // venueSheet.css). A `sel=` deep link opens it immediately at the "half"
  294 |   // snap (PubMap.tsx's selectVenue default) — asserting `.open` rather than a
  295 |   // specific `.sheet-*` class keeps this robust to the exact snap default
  296 |   // while still proving the sheet-open contract that peek/half/full build on.
  297 |   const sheet = page.locator(".mapDrawer.right");
  298 |   await expect(sheet).toHaveClass(/open/);
  299 |   await expect(page.locator(".mapDrawer.left")).toHaveCount(0);
  300 | 
  301 |   // The grab handle (the drag affordance itself) is visible and — even
  302 |   // without simulating a real pointer-drag — present in the DOM as the
  303 |   // documented gesture surface (components/map/VenueInspector.tsx).
  304 |   await expect(sheet.locator(".mobileSharedSheetGrab")).toBeVisible();
  305 | 
  306 |   // The sheet stays fully usable with no gesture at all: the close button and
  307 |   // tabs are reachable and functional (a11y contract from the spec).
  308 |   const closeButton = page.getByRole("button", { name: "Close pub detail" });
  309 |   await expect(closeButton).toBeVisible();
  310 |   const tabs = page.getByRole("tab");
  311 |   await expect(tabs.first()).toBeVisible();
  312 | 
  313 |   const mobileNav = page.locator(".mobileTabBar").filter({ visible: true });
  314 |   const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
  315 |   const goldenThreadPrice = page.locator(".vpsPriceValue").first();
  316 |   await expect(mobileNav).toBeVisible();
  317 |   await expect(tablist).toBeVisible();
  318 |   await expect(goldenThreadPrice).toHaveText("£5.50");
  319 | 
  320 |   const [navBox, closeBox, tabsBox, horizontalOverflow, goldenThreadPriceStyle] = await Promise.all([
  321 |     mobileNav.boundingBox(),
  322 |     closeButton.boundingBox(),
  323 |     tablist.boundingBox(),
  324 |     page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  325 |     goldenThreadPrice.evaluate((node) => {
  326 |       const style = window.getComputedStyle(node);
  327 |       return {
  328 |         fontFamily: style.fontFamily,
  329 |         letterSpacing: style.letterSpacing,
  330 |       };
  331 |     }),
  332 |   ]);
  333 |   expect(navBox).not.toBeNull();
  334 |   expect(closeBox).not.toBeNull();
  335 |   expect(tabsBox).not.toBeNull();
  336 |   expect(goldenThreadPriceStyle.fontFamily).toContain("Inter");
  337 |   expect(goldenThreadPriceStyle.letterSpacing).not.toBe("normal");
  338 |   expect(horizontalOverflow).toBeLessThanOrEqual(1);
  339 |   expect(navBox!.x).toBeGreaterThanOrEqual(0);
  340 |   expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(390);
> 341 |   expect(closeBox!.y + closeBox!.height).toBeLessThan(navBox!.y);
      |                                          ^ Error: expect(received).toBeLessThan(expected)
  342 |   expect(tabsBox!.y + tabsBox!.height).toBeLessThan(navBox!.y);
  343 | 
  344 |   await closeButton.click();
  345 |   await expect(sheet).toHaveCount(0);
  346 | });
  347 | 
  348 | test("mobile venue sheet reaches Train, holds no price action in the strip, and gates the one price door", async ({
  349 |   page,
  350 | }) => {
  351 |   test.setTimeout(120_000);
  352 |   await page.setViewportSize({ width: 390, height: 844 });
  353 |   await page.emulateMedia({ reducedMotion: "reduce" });
  354 | 
  355 |   const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  356 |   expect(response?.status()).toBe(200);
  357 | 
  358 |   const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  359 |   await expect(portal).toBeVisible();
  360 |   const sheet = portal.locator(".mobileSharedSheet");
  361 |   await expect(sheet).toHaveClass(/open/);
  362 |   const storiesTab = portal.getByRole("tab", { name: "Stories", exact: true });
  363 |   await expect(async () => {
  364 |     await storiesTab.click();
  365 |     await expect(sheet).toHaveClass(/sheet-full/, { timeout: 2_000 });
  366 |   }).toPass({ timeout: 20_000 });
  367 | 
  368 |   // Wait for the command bar to finish portaling into the sheet footer. The
  369 |   // footer is outside the scroll body, so actions remain reachable at full snap.
  370 |   const sheetFooter = sheet.locator(".mobileSharedSheetFooter");
  371 |   const stickyActions = sheetFooter.getByRole("toolbar", { name: "Venue actions" });
  372 |   await expect(stickyActions).toBeVisible();
  373 | 
  374 |   // The Overview's getting-home fold is the single Train entry point (the
  375 |   // sticky strip holds actions, not navigation - owner-reported duplicate
  376 |   // removed). Back to a content tab after, so the sheet is full again.
  377 |   const overviewTab = portal.getByRole("tab", { name: "Overview", exact: true });
  378 |   await expect(async () => {
  379 |     await overviewTab.click();
  380 |     await expect(overviewTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  381 |     await expect(portal.locator("#venuePanel-overview")).toBeVisible({ timeout: 2_000 });
  382 |   }).toPass({ timeout: 20_000 });
  383 |   const gettingHome = portal.locator("#venueSection-getting-home");
  384 |   const gettingHomeSummary = gettingHome.locator("summary");
  385 |   await gettingHomeSummary.scrollIntoViewIfNeeded();
  386 |   await gettingHomeSummary.click();
  387 |   await expect(gettingHome).toHaveAttribute("open", "");
  388 |   await expect(gettingHome.getByLabel("Last Pint")).toBeVisible();
  389 |   await expect(async () => {
  390 |     await storiesTab.scrollIntoViewIfNeeded();
  391 |     await storiesTab.click();
  392 |     await expect(sheet).toHaveClass(/sheet-full/, { timeout: 2_000 });
  393 |   }).toPass({ timeout: 20_000 });
  394 | 
  395 |   // Full snap prioritises the scroll body. Collapse through the real detent
  396 |   // control before using the footer command bar, proving the mobile action is
  397 |   // reachable through supported sheet interaction rather than forced scrolling.
  398 |   await sheet.getByRole("button", { name: "Collapse sheet" }).click();
  399 |   await expect(sheet).toHaveClass(/sheet-half/);
  400 |   await expect(stickyActions).toBeInViewport();
  401 | 
  402 |   // The strip holds actions, not price doors. #1517 folded its "Add price"
  403 |   // into the Overview's one door (lib/pintTrust.ts, `overviewPriceDoor`), so a
  404 |   // price action here would be the second painted primary that rule removed.
  405 |   await expect(
  406 |     stickyActions.getByRole("button", { name: /price/i }),
  407 |   ).toHaveCount(0);
  408 | 
  409 |   // The price path is the Overview's ONE door, whichever kind the pub's trust
  410 |   // state names, and there is exactly one of it on the sheet.
  411 |   await expect(async () => {
  412 |     await overviewTab.click();
  413 |     await expect(overviewTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  414 |     await expect(portal.locator("#venuePanel-overview")).toBeVisible({ timeout: 2_000 });
  415 |   }).toPass({ timeout: 20_000 });
  416 |   const priceDoor = portal.locator("[data-price-door]");
  417 |   await expect(priceDoor).toHaveCount(1);
  418 | 
  419 |   // Anonymous sessions have always been routed to sign-in before the price
  420 |   // form (runPriceContributionRequest in lib/priceContributionIntent.ts,
  421 |   // unchanged since PR #675 — not a tonight regression). The default e2e
  422 |   // chromium project injects a configured-but-fake Supabase URL/key
  423 |   // (playwright.config.ts), so authConfigured is true and an anonymous click
  424 |   // always shows the sign-in gate, never the price textbox directly.
  425 |   await priceDoor.click();
  426 |   await expect(
  427 |     page.getByRole("heading", { name: "Sign in to add a price" }).first(),
  428 |   ).toBeVisible();
  429 | });
  430 | 
  431 | test("theme toggle flips html[data-theme], persists to localStorage, survives reload", async ({
  432 |   page,
  433 | }) => {
  434 |   // The floating ThemeToggle lives on /map. The no-flash inline script sets
  435 |   // data-theme before hydration, so an initial value always exists.
  436 |   await page.setViewportSize({ width: 390, height: 844 });
  437 |   await dismissMapFirstRunTour(page);
  438 |   await page.goto("/map");
  439 |   await page.getByRole("button", { name: "More map controls" }).click();
  440 |   // PR #677 (3740a132, accessible context-aware map key) added the "Key" tab
  441 |   // and made it the default, pushing the ThemeToggle behind the "Layers" tab
```