# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-uk-base-layer.spec.ts >> normal London entry paints UK base pubs and takes a price
- Location: e2e/map-uk-base-layer.spec.ts:90:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.unverifiedPub')
Expected substring: "No price yet"
Received string:    "Prices unreadNorth NineteenPublished menu prices unavailable just now.Nobody has logged what a drink costs at this pub - be the first.What’s it tonight?BeerAlcohol-freeSoft drinksCoffeeWineCocktailsWhiskyOtherWhat measure?PintHalfOther£Log it£4.00£4.50£5.00Photo of the billAdd a photo of the bill, so another drinker can check this price.Your price shows on this pub’s page straight away, dated and badged as community. It never replaces the price on record. It marks this pub's pin straight away. A second drinker reporting a similar price confirms the figure here. Up to £30 a drink. It counts under your public handle on the contributor record.What drinkers noticedAccess unknownThese are what drinkers said they saw, not venue facts.CharacterNot reported yet.EntranceUnknownNobody has confirmed step-free entrance access.ToiletsUnknownNobody has confirmed step-free toilet access.DoorNot reported yet.EatingNot reported yet.Alcohol-freeNot reported yet.Add what you noticedCharacterAccessDoorEatingAlcohol-freeEntranceToiletsRoughPoshNeither character answer is a score. It is your judgement.Log what you sawPub location from OpenStreetMap contributors, ODbL. Prices never come from OpenStreetMap."
Timeout: 10000ms

Call log:
  - Expect "toContainText" with timeout 10000ms
  - waiting for locator('.unverifiedPub')
    24 × locator resolved to <div class="unverifiedPub">…</div>
       - unexpected value "Prices unreadNorth NineteenPublished menu prices unavailable just now.Nobody has logged what a drink costs at this pub - be the first.What’s it tonight?BeerAlcohol-freeSoft drinksCoffeeWineCocktailsWhiskyOtherWhat measure?PintHalfOther£Log it£4.00£4.50£5.00Photo of the billAdd a photo of the bill, so another drinker can check this price.Your price shows on this pub’s page straight away, dated and badged as community. It never replaces the price on record. It marks this pub's pin straight away. A second drinker reporting a similar price confirms the figure here. Up to £30 a drink. It counts under your public handle on the contributor record.What drinkers noticedAccess unknownThese are what drinkers said they saw, not venue facts.CharacterNot reported yet.EntranceUnknownNobody has confirmed step-free entrance access.ToiletsUnknownNobody has confirmed step-free toilet access.DoorNot reported yet.EatingNot reported yet.Alcohol-freeNot reported yet.Add what you noticedCharacterAccessDoorEatingAlcohol-freeEntranceToiletsRoughPoshNeither character answer is a score. It is your judgement.Log what you sawPub location from OpenStreetMap contributors, ODbL. Prices never come from OpenStreetMap."

```

```yaml
- text: Prices unread
- status: Published menu prices unavailable just now.
- paragraph:
  - text: Nobody has logged what a drink costs at this pub -
  - strong: be the first
  - text: .
- region "What’s it tonight?":
  - heading "What’s it tonight?" [level=3]
  - radiogroup "What are you drinking at North Nineteen?":
    - radio "Beer" [checked]
    - radio "Alcohol-free"
    - radio "Soft drinks"
    - radio "Coffee"
    - radio "Wine"
    - radio "Cocktails"
    - radio "Whisky"
    - radio "Other"
  - text: What measure?
  - radiogroup "What measure?":
    - radio "Pint" [checked]
    - radio "Half"
    - radio "Other"
  - textbox "Price of a beer at North Nineteen, in pounds":
    - /placeholder: "4.20"
  - button "Log it" [disabled]
  - button "£4.00"
  - button "£4.50"
  - button "£5.00"
  - button "Photo of the bill at North Nineteen"
  - button "Photo of the bill"
  - paragraph: Add a photo of the bill, so another drinker can check this price.
  - paragraph: Your price shows on this pub’s page straight away, dated and badged as community. It never replaces the price on record. It marks this pub's pin straight away. A second drinker reporting a similar price confirms the figure here. Up to £30 a drink. It counts under your public handle on the contributor record.
- group: What drinkers noticed Access unknown
- paragraph:
  - text: Pub location from
  - link "OpenStreetMap contributors":
    - /url: https://www.openstreetmap.org/copyright
  - text: ", ODbL. Prices never come from OpenStreetMap."
```

# Test source

```ts
  232 |         if (!sel?.startsWith("venue-uk-")) return null;
  233 |         firstPinId = pin.id;
  234 |         firstName = name;
  235 |         await page.getByRole("button", { name: "Expand sheet", exact: true }).click();
  236 |         await expect(page.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
  237 |         await priceField.fill(TYPED_PRICE);
  238 |         await expect(priceField).toHaveValue(TYPED_PRICE);
  239 |         return name;
  240 |       },
  241 |       {
  242 |         message: "a painted UK base pin opens the unverified price sheet",
  243 |         timeout: 90_000,
  244 |       },
  245 |     )
  246 |     .not.toBeNull();
  247 | 
  248 |   expect(firstPinId).not.toBeNull();
  249 | 
  250 |   async function selectOtherUkBaseFromList(): Promise<void> {
  251 |     const listButton = page
  252 |       .locator(
  253 |         `button.mapVenueListItem[data-venue-id^="venue-uk-"]:not([data-venue-id="${firstPinId}"])`,
  254 |       )
  255 |       .first();
  256 |     if (!(await listButton.isVisible().catch(() => false))) {
  257 |       const more = page.getByRole("button", { name: "More map controls" });
  258 |       await expect(more).toBeVisible({ timeout: 10_000 });
  259 |       await more.click();
  260 |       const listToggle = page.getByRole("button", { name: "List view" });
  261 |       await expect(listToggle).toBeVisible({ timeout: 10_000 });
  262 |       await listToggle.click();
  263 |       await expect(listButton).toBeVisible({ timeout: 15_000 });
  264 |     }
  265 |     await listButton.click();
  266 |     await page.waitForTimeout(400);
  267 |   }
  268 | 
  269 |   await priceField.blur();
  270 |   // The price was entered in the expanded modal sheet. Keep it mounted,
  271 |   // collapse to half, then drag to peek before choosing another map pin.
  272 |   const phoneSheet = page.locator(".mobileSharedSheet");
  273 |   const openedSheet = await phoneSheet.elementHandle();
  274 |   expect(openedSheet).not.toBeNull();
  275 |   await phoneSheet.getByRole("button", { name: "Collapse sheet", exact: true }).click();
  276 |   await expect(phoneSheet).toHaveClass(/sheet-half/);
  277 |   const headerBox = await phoneSheet.locator(".mobileSharedSheetHeader").boundingBox();
  278 |   expect(headerBox).not.toBeNull();
  279 |   const dragX = headerBox!.x + 18;
  280 |   const dragY = headerBox!.y + headerBox!.height - 10;
  281 |   await page.mouse.move(dragX, dragY);
  282 |   await page.mouse.down();
  283 |   await page.mouse.move(dragX, dragY + 260, { steps: 12 });
  284 |   await page.waitForTimeout(150);
  285 |   await page.mouse.up();
  286 |   await expect(phoneSheet).toHaveClass(/sheet-peek/);
  287 |   await expect(phoneSheet).not.toHaveAttribute("aria-modal", "true");
  288 |   await expect(page.locator("main.appShell")).not.toHaveAttribute("inert", "");
  289 |   await expect(priceField).toHaveValue(TYPED_PRICE);
  290 | 
  291 |   await expect
  292 |     .poll(
  293 |       async () => {
  294 |         for (const pin of uniqueUkPins(await paintedMarks(page))) {
  295 |           if (pin.id === firstPinId) continue;
  296 |           await dismissCuratedSheetIfOpen();
  297 |           await page.mouse.click(pin.x, pin.y);
  298 |           await page.waitForTimeout(500);
  299 |           if ((await sheet.count()) === 0) continue;
  300 |           const name = await sheetName();
  301 |           if (name && name !== firstName) return name;
  302 |         }
  303 |         try {
  304 |           await selectOtherUkBaseFromList();
  305 |         } catch {
  306 |           return null;
  307 |         }
  308 |         const name = await sheetName();
  309 |         if (name && name !== firstName) return name;
  310 |         return null;
  311 |       },
  312 |       {
  313 |         message: "a second UK base pub is reachable while the first sheet stays open",
  314 |         timeout: 90_000,
  315 |       },
  316 |     )
  317 |     .not.toBeNull();
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
> 332 |   await expect(sheet).toContainText("No price yet");
      |                       ^ Error: expect(locator).toContainText(expected) failed
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
  418 |   }, beforeZoom), { timeout: 20_000 }).toBe(true);
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
```