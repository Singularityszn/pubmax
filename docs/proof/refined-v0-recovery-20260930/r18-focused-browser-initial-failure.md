# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-uk-base-layer.spec.ts >> normal London entry paints UK base pubs and takes a price
- Location: e2e/map-uk-base-layer.spec.ts:90:5

# Error details

```
Error: a second UK base pub is reachable while the first sheet stays open

Timeout 90000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=e3]:
    - region "Interactive pub map of London" [ref=e4]:
      - generic [ref=e6]:
        - region "Map" [ref=e7]
        - group [ref=e8]:
          - generic "Toggle attribution" [ref=e9] [cursor=pointer]
      - generic "Map controls":
        - generic [ref=e10]:
          - link "Open PUBMAXX landing page" [ref=e11] [cursor=pointer]:
            - /url: /
            - img "PUBMAXX" [ref=e12]:
              - generic [ref=e14]:
                - generic [ref=e15]: PUBMAX
                - generic [ref=e16]: X
          - 'button "Map area: London. Change city" [ref=e18] [cursor=pointer]':
            - generic [ref=e19]: London
          - button "Search the map" [ref=e21] [cursor=pointer]
          - button "Filters" [ref=e25] [cursor=pointer]
          - button "More map controls" [ref=e27] [cursor=pointer]
        - 'button "Drink shown on the map: Pints. Choose another drink" [ref=e33] [cursor=pointer]':
          - generic [ref=e37]: Pints
      - generic "Map utilities":
        - 'button "TfL live: 2 updates" [ref=e38] [cursor=pointer]':
          - generic [ref=e46]: "2"
        - button "Near me" [ref=e47] [cursor=pointer]
  - navigation "Primary":
    - list [ref=e51]:
      - listitem
      - listitem [ref=e52]:
        - link "Tonight" [ref=e53] [cursor=pointer]:
          - /url: /tonight
      - listitem [ref=e61]:
        - link "Map" [ref=e62] [cursor=pointer]:
          - /url: /map
      - listitem [ref=e68]:
        - link "Places" [ref=e69] [cursor=pointer]:
          - /url: /places
      - listitem [ref=e75]:
        - link "Out" [ref=e76] [cursor=pointer]:
          - /url: /out
      - listitem [ref=e83]:
        - link "Plan" [ref=e84] [cursor=pointer]:
          - /url: /plan
      - listitem [ref=e92]:
        - link "You" [ref=e93] [cursor=pointer]:
          - /url: /u/night_owl
  - alert [ref=e100]
  - generic:
    - button "Dismiss North Nineteen backdrop"
    - dialog [ref=e101]:
      - banner [ref=e102]:
        - button "Expand sheet" [ref=e103] [cursor=pointer]
        - heading "North Nineteen" [level=2] [ref=e105]
        - button "Close venue detail" [ref=e106] [cursor=pointer]
      - generic [ref=e111]:
        - generic [ref=e112]: No price yet
        - paragraph [ref=e117]:
          - text: We know this pub is here, and that is all we know. Nobody has logged what a drink costs -
          - strong [ref=e118]: be the first
          - text: .
        - generic [ref=e119]:
          - region [ref=e120]:
            - heading "What’s it tonight?" [level=3] [ref=e125]
            - radiogroup "What are you drinking at North Nineteen?" [ref=e126]:
              - radio "Beer" [checked] [ref=e127] [cursor=pointer]
              - radio "Alcohol-free" [ref=e128] [cursor=pointer]
              - radio "Soft drinks" [ref=e129] [cursor=pointer]
              - radio "Coffee" [ref=e130] [cursor=pointer]
              - radio "Wine" [ref=e131] [cursor=pointer]
              - radio "Cocktails" [ref=e132] [cursor=pointer]
              - radio "Whisky" [ref=e133] [cursor=pointer]
              - radio "Other" [ref=e134] [cursor=pointer]
            - generic [ref=e135]:
              - generic [ref=e136]: What measure?
              - radiogroup "What measure?" [ref=e137]:
                - radio "Pint" [checked] [ref=e138] [cursor=pointer]
                - radio "Half" [ref=e139] [cursor=pointer]
                - radio "Other" [ref=e140] [cursor=pointer]
            - generic [ref=e141]:
              - generic [ref=e142]:
                - generic [ref=e143]: £
                - textbox "Price of a beer at North Nineteen, in pounds" [ref=e144]:
                  - /placeholder: "4.20"
                  - text: "9.90"
              - button "Log it" [disabled] [ref=e145]
            - generic "Common prices" [ref=e146]:
              - button "£4.00" [ref=e147] [cursor=pointer]
              - button "£4.50" [ref=e148] [cursor=pointer]
              - button "£5.00" [ref=e149] [cursor=pointer]
            - generic [ref=e150]:
              - button "Photo of the bill at North Nineteen" [ref=e151]
              - button "Photo of the bill" [ref=e152] [cursor=pointer]
            - paragraph [ref=e156]: Add a photo of the bill, so another drinker can check this price.
            - paragraph [ref=e157]: Your price shows on this pub’s page straight away, dated and badged as community. It never replaces the price on record. It marks this pub's pin straight away. A second drinker reporting a similar price confirms the figure here. Up to £30 a drink. It counts under your public handle on the contributor record.
          - group [ref=e158]:
            - generic "What drinkers noticed Access unknown" [ref=e159] [cursor=pointer]:
              - generic [ref=e160]: What drinkers noticed
              - generic [ref=e164]: Access unknown
        - paragraph [ref=e167]:
          - text: Pub location from
          - link "OpenStreetMap contributors" [ref=e168] [cursor=pointer]:
            - /url: https://www.openstreetmap.org/copyright
          - text: ", ODbL. Prices never come from OpenStreetMap."
```

# Test source

```ts
  195 |     }
  196 |     return [...byId.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  197 |   };
  198 | 
  199 |   await expect
  200 |     .poll(async () => uniqueUkPins(await paintedMarks(page)).length, {
  201 |       timeout: 60_000,
  202 |     })
  203 |     .toBeGreaterThan(1);
  204 | 
  205 |   const pins = uniqueUkPins(await paintedMarks(page));
  206 |   expect(pins.length).toBeGreaterThan(1);
  207 |   let firstPinId: string | null = null;
  208 | 
  209 |   async function dismissCuratedSheetIfOpen(): Promise<void> {
  210 |     const curatedClose = page.getByRole("button", { name: "Close pub detail" });
  211 |     if (!(await curatedClose.isVisible().catch(() => false))) return;
  212 |     await curatedClose.click();
  213 |     await expect(page.locator(".venueInspector")).toHaveCount(0, { timeout: 10_000 });
  214 |     await expect(sheet).toHaveCount(0, { timeout: 5_000 });
  215 |   }
  216 | 
  217 |   let firstPinAttempt = 0;
  218 |   await expect
  219 |     .poll(
  220 |       async () => {
  221 |         await dismissCuratedSheetIfOpen();
  222 |         const ukPins = uniqueUkPins(await paintedMarks(page));
  223 |         if (ukPins.length === 0) return null;
  224 |         const pin = ukPins[firstPinAttempt % ukPins.length];
  225 |         firstPinAttempt += 1;
  226 |         await page.mouse.click(pin.x, pin.y);
  227 |         await page.waitForTimeout(400);
  228 |         if ((await sheet.count()) === 0) return null;
  229 |         const name = await sheetName();
  230 |         if (!name) return null;
  231 |         const sel = new URL(page.url()).searchParams.get("sel");
  232 |         if (!sel?.startsWith("venue-uk-")) return null;
  233 |         firstPinId = pin.id;
  234 |         firstName = name;
  235 |         await priceField.fill(TYPED_PRICE);
  236 |         await expect(priceField).toHaveValue(TYPED_PRICE);
  237 |         return name;
  238 |       },
  239 |       {
  240 |         message: "a painted UK base pin opens the unverified price sheet",
  241 |         timeout: 90_000,
  242 |       },
  243 |     )
  244 |     .not.toBeNull();
  245 | 
  246 |   expect(firstPinId).not.toBeNull();
  247 | 
  248 |   async function selectOtherUkBaseFromList(): Promise<void> {
  249 |     const listButton = page
  250 |       .locator(
  251 |         `button.mapVenueListItem[data-venue-id^="venue-uk-"]:not([data-venue-id="${firstPinId}"])`,
  252 |       )
  253 |       .first();
  254 |     if (!(await listButton.isVisible().catch(() => false))) {
  255 |       const more = page.getByRole("button", { name: "More map controls" });
  256 |       await expect(more).toBeVisible({ timeout: 10_000 });
  257 |       await more.click();
  258 |       const listToggle = page.getByRole("button", { name: "List view" });
  259 |       await expect(listToggle).toBeVisible({ timeout: 10_000 });
  260 |       await listToggle.click();
  261 |       await expect(listButton).toBeVisible({ timeout: 15_000 });
  262 |     }
  263 |     await listButton.click();
  264 |     await page.waitForTimeout(400);
  265 |   }
  266 | 
  267 |   await priceField.blur();
  268 | 
  269 |   await expect
  270 |     .poll(
  271 |       async () => {
  272 |         for (const pin of uniqueUkPins(await paintedMarks(page))) {
  273 |           if (pin.id === firstPinId) continue;
  274 |           await dismissCuratedSheetIfOpen();
  275 |           await page.mouse.click(pin.x, pin.y);
  276 |           await page.waitForTimeout(500);
  277 |           if ((await sheet.count()) === 0) continue;
  278 |           const name = await sheetName();
  279 |           if (name && name !== firstName) return name;
  280 |         }
  281 |         try {
  282 |           await selectOtherUkBaseFromList();
  283 |         } catch {
  284 |           return null;
  285 |         }
  286 |         const name = await sheetName();
  287 |         if (name && name !== firstName) return name;
  288 |         return null;
  289 |       },
  290 |       {
  291 |         message: "a second UK base pub is reachable while the first sheet stays open",
  292 |         timeout: 90_000,
  293 |       },
  294 |     )
> 295 |     .not.toBeNull();
      |          ^ Error: a second UK base pub is reachable while the first sheet stays open
  296 | 
  297 |   switched = true;
  298 | 
  299 |   const opened = firstName !== null;
  300 |   expect(opened, "a UK base pin should be tappable somewhere on a zoomed-in map").toBe(true);
  301 |   expect(switched, "a second, different UK base pin should be reachable from the first").toBe(true);
  302 | 
  303 |   // Pub B inherited nothing from pub A: no price, no receipt, no error.
  304 |   await expect(priceField).toHaveValue("");
  305 |   await expect(sheet.locator(".vpsubStamp")).toHaveCount(0);
  306 |   await expect(sheet.locator(".vpsubError")).toHaveCount(0);
  307 |   await expect(sheet).toContainText("No price yet");
  308 |   // ODbL attribution travels with the pins wherever they are displayed.
  309 |   await expect(sheet).toContainText("OpenStreetMap contributors");
  310 | 
  311 |   // The proof that base pubs stay OUT of the venue index - and therefore out of
  312 |   // search, the price filters and the crawl router. If one had leaked into
  313 |   // `venues`, the selection would resolve and the CURATED inspector would open
  314 |   // here instead of this sheet.
  315 |   await expect(page.locator(".venueInspector")).toHaveCount(0);
  316 |   expect(Number(await wrap.getAttribute("data-venue-count"))).toBeGreaterThanOrEqual(
  317 |     Number(curatedBefore),
  318 |   );
  319 | 
  320 |   // The flywheel: an unpriced pub takes a community price like any other.
  321 |   const logButton = sheet.getByRole("button", { name: "Log it" });
  322 |   await sheet.locator("input.vpsubInput").fill("4.20");
  323 |   await attachBill(sheet);
  324 |   await expect(logButton).toBeEnabled({ timeout: 20_000 });
  325 |   await expect(async () => {
  326 |     await logButton.click();
  327 |     await expect(sheet.locator(".vpsubStamp")).toContainText("£4.20", { timeout: 5_000 });
  328 |   }).toPass({ timeout: 60_000 });
  329 | 
  330 |   // (3) RESTORE. The tap wrote ?sel= plus its `at=` location hint; reloading
  331 |   // that URL must stream the pub's cell, fly the camera and reopen the SAME
  332 |   // unverified sheet - a shared base-pub link behaves like a curated one.
  333 |   const pubName = ((await sheet.locator(".unverifiedPubName").textContent()) ?? "").trim();
  334 |   expect(pubName.length).toBeGreaterThan(0);
  335 |   await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("sel=venue-uk-");
  336 |   expect(page.url()).toContain("at=");
  337 |   await page.goto(page.url());
  338 |   const restoredSheet = page.locator(".unverifiedPub");
  339 |   await expect(restoredSheet).toBeVisible({ timeout: 45_000 });
  340 |   await expect(restoredSheet.locator(".unverifiedPubName")).toHaveText(pubName);
  341 | });
  342 | 
  343 | test("a fresh national overview stays below the UK base gate and fetches no data", async ({
  344 |   page,
  345 | }) => {
  346 |   test.setTimeout(120_000);
  347 |   const requests = ukBaseRequests(page);
  348 | 
  349 |   const response = await page.goto("/map?uk=1");
  350 |   expect(response?.status()).toBe(200);
  351 |   const wrap = page.locator(".mapCanvasWrap");
  352 |   await expect(wrap).toHaveAttribute("data-uk-base-status", "zoom_required", {
  353 |     timeout: 30_000,
  354 |   });
  355 |   await expect(wrap).toHaveAttribute("data-uk-base-count", "0");
  356 | 
  357 |   await page.waitForTimeout(1800);
  358 |   // The national gazetteer (places.json) loads for search and browse; below the
  359 |   // zoom gate the manifest and cell shards must stay unfetched.
  360 |   expect(requests.filter((url) => url.endsWith("places.json"))).toHaveLength(1);
  361 |   expect(
  362 |     requests.filter(
  363 |       (url) => !url.endsWith("places.json"),
  364 |     ),
  365 |   ).toEqual([]);
  366 | });
  367 | 
  368 | 
  369 | test("venue-type chips hide UK base bar and pub marks as well as curated kinds", async ({
  370 |   page,
  371 | }) => {
  372 |   test.setTimeout(180_000);
  373 |   await page.setViewportSize({ width: 1440, height: 900 });
  374 |   await page.emulateMedia({ reducedMotion: "reduce" });
  375 |   await page.goto("/map");
  376 |   const wrap = page.locator(".mapCanvasWrap");
  377 |   await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
  378 |   await expect.poll(() => page.evaluate(() => "__pubmaxMapCamera" in window), {
  379 |     timeout: 30_000,
  380 |   }).toBe(true);
  381 |   const beforeZoom = await page.evaluate(() => (
  382 |     window as Window & { __pubmaxMapCamera: { read: () => { zoom: number } } }
  383 |   ).__pubmaxMapCamera.read().zoom);
  384 |   const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  385 |   await zoomIn.click();
  386 |   await zoomIn.click();
  387 |   await zoomIn.click();
  388 |   await expect.poll(() => page.evaluate((initialZoom) => {
  389 |     const camera = (window as Window & {
  390 |       __pubmaxMapCamera: { read: () => { zoom: number; moving: boolean } };
  391 |     }).__pubmaxMapCamera.read();
  392 |     return !camera.moving && camera.zoom >= initialZoom + 2.5;
  393 |   }, beforeZoom), { timeout: 20_000 }).toBe(true);
  394 |   await expect(wrap).toHaveAttribute("data-uk-base-status", "ready", { timeout: 30_000 });
  395 | 
```