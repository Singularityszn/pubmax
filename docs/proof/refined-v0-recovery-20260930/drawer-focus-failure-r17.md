# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-accessibility.spec.ts >> map keyboard and screen-reader venue path >> keeps desktop drawer focus inside and restores chosen venue on Escape
- Location: e2e/map-accessibility.spec.ts:368:7

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  locator('.mapVenueListItem').first()
Expected: focused
Received: inactive
Timeout:  10000ms

Call log:
  - Expect "toBeFocused" with timeout 10000ms
  - waiting for locator('.mapVenueListItem').first()
    22 × locator resolved to <button type="button" class="mapVenueListItem" data-venue-id="venue-12ino21" id="map-venue-list-item-venue-12ino21">…</button>
       - unexpected value "inactive"

```

```yaml
- button "The Dolphin Tavern Pub 165 m £6.50"
```

# Test source

```ts
  282 |     await page.getByRole("button", { name: /^Filters:/ }).click();
  283 |     const bars = page
  284 |       .getByRole("dialog", { name: "Filters" })
  285 |       .getByRole("button", { name: "Bars", exact: true });
  286 |     await expect(bars).toHaveAttribute("aria-pressed", "true");
  287 |     await bars.click();
  288 |     await expect(bars).toHaveAttribute("aria-pressed", "false");
  289 |     await expect(barRows).toHaveCount(0);
  290 |     await expect.poll(() => rows.evaluateAll((items, removed) => items
  291 |       .map((item) => item.getAttribute("data-venue-id"))
  292 |       .filter((id) => id !== null && removed.includes(id)), barIds)).toEqual([]);
  293 |     await expect(page.locator(`.mapVenueListItem[data-venue-id="${retainedPubId}"]`)).toBeVisible();
  294 |   });
  295 | 
  296 |   test("drops old base-pub rows during a disjoint pan before the next shard fetch", async ({
  297 |     page,
  298 |   }) => {
  299 |     test.setTimeout(120_000);
  300 |     await page.goto("/map");
  301 | 
  302 |     const canvas = page.locator(".maplibregl-canvas").first();
  303 |     const wrap = page.locator(".mapCanvasWrap");
  304 |     await expect(canvas).toBeVisible({ timeout: 30_000 });
  305 |     await canvas.focus();
  306 |     for (let press = 0; press < 3; press += 1) {
  307 |       await page.keyboard.press("Equal");
  308 |       await page.waitForTimeout(1_400);
  309 |     }
  310 |     await expect
  311 |       .poll(
  312 |         async () => Number(await wrap.getAttribute("data-uk-base-count")),
  313 |         { timeout: 30_000 },
  314 |       )
  315 |       .toBeGreaterThan(0);
  316 | 
  317 |     await openVenueListFromLayers(page);
  318 |     const baseRows = page.locator(
  319 |       '.mapVenueListItem[data-venue-id^="venue-uk-"]',
  320 |     );
  321 |     await expect.poll(() => baseRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  322 |     const oldIds = new Set(
  323 |       await baseRows.evaluateAll((items) =>
  324 |         items.map((item) => item.getAttribute("data-venue-id") ?? ""),
  325 |       ),
  326 |     );
  327 | 
  328 |     // One quick multi-screen drag leaves the next 180 ms shard request
  329 |     // pending. DOM membership must still follow camera projection immediately.
  330 |     for (let drag = 0; drag < 3; drag += 1) {
  331 |       await page.mouse.move(1_300, 500);
  332 |       await page.mouse.down();
  333 |       await page.mouse.move(400, 500);
  334 |       await page.mouse.up();
  335 |     }
  336 |     await page.waitForTimeout(50);
  337 | 
  338 |     const overlappingOldIds = await baseRows.evaluateAll(
  339 |       (items, ids) =>
  340 |         items
  341 |           .map((item) => item.getAttribute("data-venue-id") ?? "")
  342 |           .filter((id) => ids.includes(id)),
  343 |       [...oldIds],
  344 |     );
  345 |     expect(overlappingOldIds).toEqual([]);
  346 | 
  347 |     await expect.poll(() => baseRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  348 |     await canvas.focus();
  349 |     // London opens already past UK_BASE_MIN_ZOOM (12). Three Minus presses
  350 |     // from a zoomed-in view often land back on that street-level camera, which
  351 |     // is still above the gate, so keep zooming until the wrap reports the
  352 |     // floor rather than assuming a fixed key count crossed it.
  353 |     await expect
  354 |       .poll(
  355 |         async () => {
  356 |           await page.keyboard.press("Minus");
  357 |           return wrap.getAttribute("data-uk-base-status");
  358 |         },
  359 |         { timeout: 20_000 },
  360 |       )
  361 |       .toBe("zoom_required");
  362 |     // MapLibre has settled below the layer floor, but the base stream's 180 ms
  363 |     // clear may still be pending on a loaded runner. Poll rather than a tight
  364 |     // fixed-timeout assertion so runner variance can't race the clear.
  365 |     await expect.poll(() => baseRows.count(), { timeout: 5_000 }).toBe(0);
  366 |   });
  367 | 
  368 |   test("keeps desktop drawer focus inside and restores chosen venue on Escape", async ({
  369 |     page,
  370 |   }) => {
  371 |     test.setTimeout(180_000);
  372 |     await page.goto("/map");
  373 |     const canvas = page.locator(".maplibregl-canvas").first();
  374 |     await expect(canvas).toBeVisible({ timeout: 30_000 });
  375 | 
  376 |     // List view opens from Layers; keyboard Tab into the list is covered by the
  377 |     // sibling spec. This case pins Escape on the venue drawer with the list
  378 |     // still open underneath — the regression path from List view.
  379 |     await openVenueListFromLayers(page);
  380 |     const chosenVenue = page.locator(".mapVenueListItem").first();
  381 |     await chosenVenue.focus();
> 382 |     await expect(chosenVenue).toBeFocused();
      |                               ^ Error: expect(locator).toBeFocused() failed
  383 |     const chosenVenueId = await chosenVenue.getAttribute("data-venue-id");
  384 |     expect(chosenVenueId).toBeTruthy();
  385 |     const chosenVenueAfterClose = page.locator(
  386 |       `.mapVenueListItem[data-venue-id="${chosenVenueId}"]`,
  387 |     );
  388 |     await page.keyboard.press("Enter");
  389 | 
  390 |     const drawer = page.locator(".mapDrawer.right.open");
  391 |     const closeButton = drawer.getByRole("button", { name: /Close/ });
  392 |     await expect(drawer).toBeVisible();
  393 |     await expect(drawer).toHaveAttribute("role", "dialog");
  394 |     await expect
  395 |       .poll(
  396 |         async () => closeButton.evaluate((node) => node === document.activeElement),
  397 |         { timeout: 30_000 },
  398 |       )
  399 |       .toBe(true);
  400 | 
  401 |     await page.keyboard.press("Escape");
  402 |     await expect(drawer).toBeHidden();
  403 |     await expect(chosenVenueAfterClose).toBeFocused({ timeout: 15_000 });
  404 |   });
  405 | 
  406 |   test("returns Escape focus to a keyboard-selected search result", async ({
  407 |     page,
  408 |   }) => {
  409 |     test.setTimeout(90_000);
  410 |     await page.goto("/map");
  411 | 
  412 |     const search = page.locator("#mapSearchInput");
  413 |     await expect(search).toBeVisible({ timeout: 30_000 });
  414 |     await search.fill("Dolphin");
  415 |     const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  416 |     // Search suggestions can include area/place entries. Select a concrete
  417 |     // venue option so the contract never depends on a mixed-result index.
  418 |     const highlightedVenue = listbox
  419 |       .locator('[role="option"][data-venue-id]')
  420 |       .nth(2);
  421 |     await expect(highlightedVenue).toBeVisible();
  422 |     const highlightedVenueId = await highlightedVenue.getAttribute("data-venue-id");
  423 |     expect(highlightedVenueId).toBeTruthy();
  424 |     const optionIndex = await listbox.getByRole("option").evaluateAll(
  425 |       (options, venueId) =>
  426 |         options.findIndex((option) => option.getAttribute("data-venue-id") === venueId),
  427 |       highlightedVenueId,
  428 |     );
  429 |     expect(optionIndex).toBeGreaterThanOrEqual(0);
  430 | 
  431 |     await search.focus();
  432 |     for (let index = 0; index <= optionIndex; index += 1) {
  433 |       await page.keyboard.press("ArrowDown");
  434 |     }
  435 |     await page.keyboard.press("Enter");
  436 |     await expect
  437 |       .poll(() => new URL(page.url()).searchParams.get("sel"))
  438 |       .toBe(highlightedVenueId);
  439 | 
  440 |     const drawer = page.locator(".mapDrawer.right.open");
  441 |     await expect(drawer).toBeVisible();
  442 |     await expect(
  443 |       drawer.getByRole("button", { name: /Close/ }),
  444 |     ).toBeFocused();
  445 |     await page.keyboard.press("Escape");
  446 |     await expect(drawer).toBeHidden();
  447 |     await expect
  448 |       .poll(() => new URL(page.url()).searchParams.get("sel"))
  449 |       .toBeNull();
  450 |     await expect(search).toBeFocused();
  451 |   });
  452 | 
  453 |   test("keyboard search selects a pub before a matching area", async ({
  454 |     page,
  455 |   }) => {
  456 |     test.setTimeout(90_000);
  457 |     await page.goto("/map");
  458 | 
  459 |     const search = page.locator("#mapSearchInput");
  460 |     await expect(search).toBeVisible({ timeout: 30_000 });
  461 |     await search.fill("Blackfriar");
  462 | 
  463 |     const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  464 |     const venue = listbox
  465 |       .getByRole("group", { name: "Venues", exact: true })
  466 |       .getByRole("option", { name: /The Blackfriar/i });
  467 |     const area = listbox
  468 |       .getByRole("group", { name: "Areas", exact: true })
  469 |       .getByRole("option", { name: /Blackfriars/i });
  470 |     await expect(venue).toBeVisible();
  471 |     await expect(area).toBeVisible();
  472 |     const venueId = await venue.getAttribute("data-venue-id");
  473 |     expect(venueId).toBeTruthy();
  474 |     const venueOptionIndex = await listbox
  475 |       .getByRole("option")
  476 |       .evaluateAll(
  477 |         (options, id) =>
  478 |           options.findIndex(
  479 |             (option) => option.getAttribute("data-venue-id") === id,
  480 |           ),
  481 |         venueId,
  482 |       );
```