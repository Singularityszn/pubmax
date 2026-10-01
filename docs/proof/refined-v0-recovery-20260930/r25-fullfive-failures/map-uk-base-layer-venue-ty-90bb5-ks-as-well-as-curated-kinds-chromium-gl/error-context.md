# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-uk-base-layer.spec.ts >> venue-type chips hide UK base bar and pub marks as well as curated kinds
- Location: e2e/map-uk-base-layer.spec.ts:394:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
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
          - region "Map" [ref=e55]
          - generic:
            - generic [ref=e56]:
              - button "Zoom in" [active] [ref=e57] [cursor=pointer]
              - button "Zoom out" [ref=e59] [cursor=pointer]
            - group [ref=e61]:
              - generic "Toggle attribution" [ref=e62] [cursor=pointer]
        - 'button "Map layers: Tube, Rail, parks, and place stories" [ref=e63] [cursor=pointer]':
          - generic [ref=e68]: Layers
      - search [ref=e69]:
        - generic [ref=e70]:
          - generic [ref=e72]:
            - generic [ref=e73]:
              - generic [ref=e77]: Search pubs
              - combobox "Search pubs" [ref=e78]
            - status [ref=e79]
          - 'button "Filters: venue types, view and zone" [ref=e81] [cursor=pointer]':
            - generic [ref=e83]: Filters
          - 'button "Drink: Pints" [ref=e84] [cursor=pointer]'
          - button "Plan an outing" [ref=e89] [cursor=pointer]
          - 'button "Map area: London. Change city" [ref=e96] [cursor=pointer]':
            - generic [ref=e97]: London
      - complementary "Conditions and area news"
      - region "On tonight near you":
        - generic [ref=e99]:
          - status [ref=e100]:
            - generic [ref=e101]: Tonight nearby
          - button "Hide Pins" [pressed] [ref=e102] [cursor=pointer]:
            - generic [ref=e105]: Pins
            - generic [ref=e106]: "4"
          - button "Dismiss Pins" [ref=e107] [cursor=pointer]
  - alert [ref=e111]
```

# Test source

```ts
  318 | 
  319 |   switched = true;
  320 |   expect(await openedSheet!.evaluate((node) =>
  321 |     node.isConnected && node === document.querySelector(".mobileSharedSheet"),
  322 |   )).toBe(true);
  323 | 
  324 |   const opened = firstName !== null;
  325 |   expect(opened, "a UK base pin should be tappable somewhere on a zoomed-in map").toBe(true);
  326 |   expect(switched, "a second, different UK base pin should be reachable from the first").toBe(true);
  327 | 
  328 |   // Pub B inherited nothing from pub A: no price, no receipt, no error.
  329 |   await expect(priceField).toHaveValue("");
  330 |   await expect(sheet.locator(".vpsubStamp")).toHaveCount(0);
  331 |   await expect(sheet.locator(".vpsubError")).toHaveCount(0);
  332 |   await expect(sheet).toContainText("No price yet");
  333 |   // ODbL attribution travels with the pins wherever they are displayed.
  334 |   await expect(sheet).toContainText("OpenStreetMap contributors");
  335 | 
  336 |   // The proof that base pubs stay OUT of the venue index - and therefore out of
  337 |   // search, the price filters and the crawl router. If one had leaked into
  338 |   // `venues`, the selection would resolve and the CURATED inspector would open
  339 |   // here instead of this sheet.
  340 |   await expect(page.locator(".venueInspector")).toHaveCount(0);
  341 |   expect(Number(await wrap.getAttribute("data-venue-count"))).toBeGreaterThanOrEqual(
  342 |     Number(curatedBefore),
  343 |   );
  344 | 
  345 |   // The flywheel: an unpriced pub takes a community price like any other.
  346 |   const logButton = sheet.getByRole("button", { name: "Log it" });
  347 |   await sheet.locator("input.vpsubInput").fill("4.20");
  348 |   await attachBill(sheet);
  349 |   await expect(logButton).toBeEnabled({ timeout: 20_000 });
  350 |   await expect(async () => {
  351 |     await logButton.click();
  352 |     await expect(sheet.locator(".vpsubStamp")).toContainText("£4.20", { timeout: 5_000 });
  353 |   }).toPass({ timeout: 60_000 });
  354 | 
  355 |   // (3) RESTORE. The tap wrote ?sel= plus its `at=` location hint; reloading
  356 |   // that URL must stream the pub's cell, fly the camera and reopen the SAME
  357 |   // unverified sheet - a shared base-pub link behaves like a curated one.
  358 |   const pubName = ((await sheet.locator(".unverifiedPubName").textContent()) ?? "").trim();
  359 |   expect(pubName.length).toBeGreaterThan(0);
  360 |   await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("sel=venue-uk-");
  361 |   expect(page.url()).toContain("at=");
  362 |   await page.goto(page.url());
  363 |   const restoredSheet = page.locator(".unverifiedPub");
  364 |   await expect(restoredSheet).toBeVisible({ timeout: 45_000 });
  365 |   await expect(restoredSheet.locator(".unverifiedPubName")).toHaveText(pubName);
  366 | });
  367 | 
  368 | test("a fresh national overview stays below the UK base gate and fetches no data", async ({
  369 |   page,
  370 | }) => {
  371 |   test.setTimeout(120_000);
  372 |   const requests = ukBaseRequests(page);
  373 | 
  374 |   const response = await page.goto("/map?uk=1");
  375 |   expect(response?.status()).toBe(200);
  376 |   const wrap = page.locator(".mapCanvasWrap");
  377 |   await expect(wrap).toHaveAttribute("data-uk-base-status", "zoom_required", {
  378 |     timeout: 30_000,
  379 |   });
  380 |   await expect(wrap).toHaveAttribute("data-uk-base-count", "0");
  381 | 
  382 |   await page.waitForTimeout(1800);
  383 |   // The national gazetteer (places.json) loads for search and browse; below the
  384 |   // zoom gate the manifest and cell shards must stay unfetched.
  385 |   expect(requests.filter((url) => url.endsWith("places.json"))).toHaveLength(1);
  386 |   expect(
  387 |     requests.filter(
  388 |       (url) => !url.endsWith("places.json"),
  389 |     ),
  390 |   ).toEqual([]);
  391 | });
  392 | 
  393 | 
  394 | test("venue-type chips hide UK base bar and pub marks as well as curated kinds", async ({
  395 |   page,
  396 | }) => {
  397 |   test.setTimeout(180_000);
  398 |   await page.setViewportSize({ width: 1440, height: 900 });
  399 |   await page.emulateMedia({ reducedMotion: "reduce" });
  400 |   await page.goto("/map");
  401 |   const wrap = page.locator(".mapCanvasWrap");
  402 |   await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
  403 |   await expect.poll(() => page.evaluate(() => "__pubmaxMapCamera" in window), {
  404 |     timeout: 30_000,
  405 |   }).toBe(true);
  406 |   const beforeZoom = await page.evaluate(() => (
  407 |     window as Window & { __pubmaxMapCamera: { read: () => { zoom: number } } }
  408 |   ).__pubmaxMapCamera.read().zoom);
  409 |   const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  410 |   await zoomIn.click();
  411 |   await zoomIn.click();
  412 |   await zoomIn.click();
  413 |   await expect.poll(() => page.evaluate((initialZoom) => {
  414 |     const camera = (window as Window & {
  415 |       __pubmaxMapCamera: { read: () => { zoom: number; moving: boolean } };
  416 |     }).__pubmaxMapCamera.read();
  417 |     return !camera.moving && camera.zoom >= initialZoom + 2.5;
> 418 |   }, beforeZoom), { timeout: 20_000 }).toBe(true);
      |                                        ^ Error: expect(received).toBe(expected) // Object.is equality
  419 |   await expect(wrap).toHaveAttribute("data-uk-base-status", "ready", { timeout: 30_000 });
  420 | 
  421 |   const layers = page.getByRole("button", { name: /Map layers:/ });
  422 |   const listToggle = page.getByRole("button", { name: "List view" });
  423 |   await expect(async () => {
  424 |     await layers.click();
  425 |     await expect(listToggle).toBeVisible({ timeout: 2_000 });
  426 |   }).toPass({ timeout: 20_000 });
  427 |   await listToggle.click();
  428 |   await expect(page.locator(".mapVenueList--open")).toBeVisible();
  429 |   const baseRows = page.locator('.mapVenueListItem[data-venue-id^="venue-uk-"]');
  430 |   const baseBars = baseRows.filter({ hasText: "Other bar · no listed price" });
  431 |   const basePubs = baseRows.filter({ hasText: "Other pub · no listed price" });
  432 |   await expect.poll(() => baseBars.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  433 |   await expect.poll(() => basePubs.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  434 |   const ids = (locator: typeof baseBars) => locator.evaluateAll((items) =>
  435 |     items.map((item) => item.getAttribute("data-venue-id")!).filter(Boolean),
  436 |   );
  437 |   const baseBarIds = await ids(baseBars);
  438 |   const basePubIds = await ids(basePubs);
  439 |   const paintedIds = async (wanted: string[]) =>
  440 |     (await paintedMarks(page))
  441 |       .filter((mark) => mark.kind === "pin" && wanted.includes(mark.id))
  442 |       .map((mark) => mark.id);
  443 |   // Painted-pin probe returns only MapLibre marks that survived collision,
  444 |   // re-query as the same tap target, and are not covered by app chrome.
  445 |   await expect.poll(async () => (await paintedIds(baseBarIds)).length, {
  446 |     timeout: 20_000,
  447 |   }).toBeGreaterThan(0);
  448 |   await expect.poll(async () => (await paintedIds(basePubIds)).length, {
  449 |     timeout: 20_000,
  450 |   }).toBeGreaterThan(0);
  451 | 
  452 |   const filters = page.getByRole("button", { name: /^Filters:/ });
  453 |   await filters.click();
  454 |   const panel = page.getByRole("dialog", { name: "Filters" });
  455 |   const bars = panel.getByRole("button", { name: "Bars", exact: true });
  456 |   await bars.click();
  457 |   await expect(bars).toHaveAttribute("aria-pressed", "false");
  458 |   await filters.click();
  459 |   await expect(baseBars).toHaveCount(0);
  460 |   await expect.poll(() => paintedIds(baseBarIds)).toEqual([]);
  461 |   await expect.poll(async () => (await paintedIds(basePubIds)).length).toBeGreaterThan(0);
  462 | 
  463 |   await filters.click();
  464 |   await bars.click();
  465 |   await expect(bars).toHaveAttribute("aria-pressed", "true");
  466 |   await filters.click();
  467 |   await expect.poll(async () => (await ids(baseBars)).sort(), { timeout: 20_000 })
  468 |     .toEqual([...baseBarIds].sort());
  469 |   await expect.poll(async () => (await paintedIds(baseBarIds)).length).toBeGreaterThan(0);
  470 | 
  471 |   await filters.click();
  472 |   const pints = panel.getByRole("button", { name: "Pints", exact: true });
  473 |   await pints.click();
  474 |   await expect(pints).toHaveAttribute("aria-pressed", "false");
  475 |   await filters.click();
  476 |   await expect(basePubs).toHaveCount(0);
  477 |   await expect.poll(() => paintedIds(basePubIds)).toEqual([]);
  478 |   await expect.poll(async () => (await paintedIds(baseBarIds)).length).toBeGreaterThan(0);
  479 | });
  480 | 
  481 | 
  482 | test("base-led desktop keeps its active Bars filter reachable after a pan", async ({
  483 |   page,
  484 | }) => {
  485 |   test.setTimeout(120_000);
  486 |   await page.setViewportSize({ width: 1440, height: 900 });
  487 |   await page.emulateMedia({ reducedMotion: "reduce" });
  488 |   await page.goto("/map");
  489 |   await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
  490 |   await expect.poll(() => page.evaluate(() => "__pubmaxMapCamera" in window), {
  491 |     timeout: 30_000,
  492 |   }).toBe(true);
  493 | 
  494 |   const filters = page.getByRole("button", { name: /^Filters:/ });
  495 |   await expect(filters).toBeVisible();
  496 |   await filters.click();
  497 |   const panel = page.getByRole("dialog", { name: "Filters" });
  498 |   const bars = panel.getByRole("button", { name: "Bars", exact: true });
  499 |   await bars.click();
  500 |   await expect(bars).toHaveAttribute("aria-pressed", "false");
  501 |   await filters.click();
  502 |   await expect(filters).toHaveAttribute("aria-label", "Filters: venue types, view and zone, 1 filter on");
  503 |   await expect(filters.locator(".mapVenueKindFilterCount")).toHaveText("1");
  504 | 
  505 |   const outside = page.getByRole("complementary", {
  506 |     name: "Outside priced city map",
  507 |   });
  508 |   const mapBox = await page.locator(".maplibreMap").boundingBox();
  509 |   expect(mapBox).not.toBeNull();
  510 |   // Each left drag moves the camera east. Stop on the actual outside-city
  511 |   // banner rather than assuming a fixed number of pixels is a city boundary.
  512 |   for (let drag = 0; drag < 6 && !(await outside.isVisible()); drag += 1) {
  513 |     const y = mapBox!.y + mapBox!.height * 0.65;
  514 |     await page.mouse.move(mapBox!.x + mapBox!.width * 0.76, y);
  515 |     await page.mouse.down();
  516 |     await page.mouse.move(mapBox!.x + mapBox!.width * 0.24, y, { steps: 12 });
  517 |     await page.mouse.up();
  518 |     await expect.poll(() => page.evaluate(() => (
```