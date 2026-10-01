# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: landmark-and-sheet.spec.ts >> inline drawers keep spring ownership and content through responsive exits
- Location: e2e/landmark-and-sheet.spec.ts:345:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.mapDrawer.right.springDrawer').locator('.venueInspector')
Expected: 1
Received: 0
Timeout:  10000ms

Call log:
  - Expect "toHaveCount" with timeout 10000ms
  - waiting for locator('.mapDrawer.right.springDrawer').locator('.venueInspector')
    19 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - link "Skip to main content" [ref=f1e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=f1e3]:
    - navigation "Site navigation" [ref=f1e4]:
      - link "Open PUBMAXX landing page" [ref=f1e5] [cursor=pointer]:
        - /url: /
        - img "PUBMAXX" [ref=f1e6]:
          - generic [ref=f1e8]:
            - generic [ref=f1e9]: PUBMAX
            - generic [ref=f1e10]: X
      - list [ref=f1e11]:
        - listitem [ref=f1e12]:
          - link "Tonight" [ref=f1e13] [cursor=pointer]:
            - /url: /tonight
        - listitem [ref=f1e14]:
          - link "Map" [ref=f1e15] [cursor=pointer]:
            - /url: /map
        - listitem [ref=f1e16]:
          - link "Places" [ref=f1e17] [cursor=pointer]:
            - /url: /places
        - listitem [ref=f1e18]:
          - link "Out" [ref=f1e19] [cursor=pointer]:
            - /url: /out
        - listitem [ref=f1e20]:
          - link "Plan" [ref=f1e21] [cursor=pointer]:
            - /url: /plan
        - listitem [ref=f1e22]:
          - link "You" [ref=f1e23] [cursor=pointer]:
            - /url: /u/you
      - generic [ref=f1e24]:
        - button "More pages" [ref=f1e26] [cursor=pointer]:
          - generic [ref=f1e27]: More
        - link "Share a Moment" [ref=f1e30] [cursor=pointer]:
          - /url: /moment?returnTo=%2Fmap
        - link "Activity" [ref=f1e33] [cursor=pointer]:
          - /url: /activity
        - link "Messages" [ref=f1e37] [cursor=pointer]:
          - /url: /messages
        - button "Switch to dark theme" [ref=f1e40] [cursor=pointer]
        - button "Sign in" [ref=f1e45] [cursor=pointer]
    - region "Interactive pub map of London" [ref=f1e49]:
      - generic [ref=f1e50]:
        - generic [ref=f1e51]:
          - region "Map" [ref=f1e52]
          - generic:
            - generic [ref=f1e53]:
              - button "Zoom in" [ref=f1e54] [cursor=pointer]
              - button "Zoom out" [ref=f1e56] [cursor=pointer]
            - group [ref=f1e58]:
              - generic "Toggle attribution" [ref=f1e59] [cursor=pointer]
        - 'button "Map layers: Tube, Rail, parks, and place stories" [ref=f1e60] [cursor=pointer]':
          - generic [ref=f1e65]: Layers
      - search [ref=f1e66]:
        - generic [ref=f1e67]:
          - generic [ref=f1e69]:
            - generic [ref=f1e70]:
              - generic [ref=f1e74]: Search pubs
              - combobox "Search pubs" [expanded] [active] [ref=f1e75]
            - listbox "Search suggestions" [ref=f1e77]:
              - group "Areas" [ref=f1e78]:
                - paragraph [ref=f1e79]:
                  - generic [ref=f1e80]: Areas
                  - generic [ref=f1e81]: Distances from the map centre
                - option "King's Cross 1.3 km from centre" [ref=f1e82] [cursor=pointer]:
                  - generic [ref=f1e83]: King's Cross
                  - generic [ref=f1e88]: 1.3 km from centre
                - option "Piccadilly & Soho 1.4 km from centre" [ref=f1e89] [cursor=pointer]:
                  - generic [ref=f1e90]: Piccadilly & Soho
                  - generic [ref=f1e95]: 1.4 km from centre
                - option "Islington 1.9 km from centre" [ref=f1e96] [cursor=pointer]:
                  - generic [ref=f1e97]: Islington
                  - generic [ref=f1e102]: 1.9 km from centre
                - option "Camden 2.6 km from centre" [ref=f1e103] [cursor=pointer]:
                  - generic [ref=f1e104]: Camden
                  - generic [ref=f1e109]: 2.6 km from centre
                - option "Shoreditch 2.9 km from centre" [ref=f1e110] [cursor=pointer]:
                  - generic [ref=f1e111]: Shoreditch
                  - generic [ref=f1e116]: 2.9 km from centre
            - status [ref=f1e117]
          - 'button "Filters: venue types, view and zone" [ref=f1e119] [cursor=pointer]'
          - 'button "Drink: Pints" [ref=f1e121] [cursor=pointer]'
          - button "Plan an outing" [ref=f1e126] [cursor=pointer]
          - 'button "Map area: London. Change city" [ref=f1e133] [cursor=pointer]':
            - generic [ref=f1e134]: LON
      - status [ref=f1e136]:
        - paragraph [ref=f1e137]: Visiting another city?
        - button "Near me?" [ref=f1e138] [cursor=pointer]
        - button "Dismiss city suggestion" [ref=f1e139] [cursor=pointer]
      - region "On tonight near you"
  - alert [ref=f1e143]
```

# Test source

```ts
  302 |       const start = await drawer.boundingBox();
  303 |       expect(start).not.toBeNull();
  304 |       await home.press("Enter");
  305 |       await expect(drawer).toHaveAttribute("inert");
  306 |       const positions: { x: number; y: number; transform: string }[] = [];
  307 |       for (let frame = 0; frame < 180; frame += 1) {
  308 |         await page.clock.runFor(16);
  309 |         const position = await drawer.evaluate((element, origin) => {
  310 |           if (!element.querySelector(".mapDrawerHead")) return null;
  311 |           const rect = element.getBoundingClientRect();
  312 |           return {
  313 |             x: rect.x - origin.x,
  314 |             y: rect.y - origin.y,
  315 |             transform: getComputedStyle(element).transform,
  316 |           };
  317 |         }, start!);
  318 |         if (!position) break;
  319 |         positions.push(position);
  320 |       }
  321 |       const exit = {
  322 |         positions,
  323 |         inert: await drawer.evaluate((element) => (element as HTMLElement).inert),
  324 |       };
  325 |       await testInfo.attach("drawer-exit-geometry", {
  326 |         body: JSON.stringify(exit),
  327 |         contentType: "application/json",
  328 |       });
  329 |       expect(exit.inert).toBe(true);
  330 |       expect(exit.positions.length).toBeGreaterThan(0);
  331 |       if (width <= 768) {
  332 |         expect(Math.max(...exit.positions.map(({ y }) => y))).toBeGreaterThan(10);
  333 |         expect(Math.max(...exit.positions.map(({ x }) => Math.abs(x)))).toBeLessThan(1);
  334 |       } else {
  335 |         const direction = side === "left" ? -1 : 1;
  336 |         expect(Math.max(...exit.positions.map(({ x }) => x * direction))).toBeGreaterThan(10);
  337 |         expect(Math.max(...exit.positions.map(({ y }) => Math.abs(y)))).toBeLessThan(1);
  338 |       }
  339 |       await expect(drawer.locator(".mapDrawerHead")).toHaveCount(0);
  340 |       expect(errors).toEqual([]);
  341 |     });
  342 |   }
  343 | }
  344 | 
  345 | test("inline drawers keep spring ownership and content through responsive exits", async ({
  346 |   page,
  347 | }) => {
  348 |   test.setTimeout(60_000);
  349 |   const errors = watchPageErrors(page);
  350 | 
  351 |   await page.setViewportSize({ width: 700, height: 900 });
  352 |   await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  353 | 
  354 |   const tabletDrawer = page.locator(".mapDrawer.right.springDrawer");
  355 |   await expect(tabletDrawer).toHaveClass(/open/, { timeout: 30_000 });
  356 |   await expect(tabletDrawer).toBeVisible();
  357 |   await expect(tabletDrawer).toHaveAttribute("data-spring-axis", "vertical");
  358 |   expect(
  359 |     await tabletDrawer.evaluate(
  360 |       (node) => getComputedStyle(node).transitionProperty,
  361 |     ),
  362 |   ).toBe("none");
  363 |   await expect(tabletDrawer.locator(".venueInspector")).toHaveCount(1);
  364 |   const tabletOpenBox = await tabletDrawer.boundingBox();
  365 |   expect(tabletOpenBox).not.toBeNull();
  366 |   expect(tabletOpenBox!.y).toBeGreaterThanOrEqual(0);
  367 |   expect(tabletOpenBox!.y).toBeLessThan(900);
  368 |   expect(tabletOpenBox!.x + tabletOpenBox!.width).toBeLessThanOrEqual(701);
  369 | 
  370 |   // The drawer's way out is the shared SurfaceNav pair now, not a bespoke
  371 |   // close (components/ui/surface-nav.tsx).
  372 |   await tabletDrawer.locator(".surfaceNavHome").click();
  373 |   await expect(tabletDrawer).toHaveAttribute("aria-hidden", "true");
  374 |   // The selected venue may clear immediately, but its rendered content stays
  375 |   // in the exiting drawer until the close spring rests.
  376 |   await expect(tabletDrawer.locator(".venueInspector")).toHaveCount(1);
  377 |   await expect
  378 |     .poll(() => tabletDrawer.locator(".venueInspector").count())
  379 |     .toBe(0);
  380 |   await expect.poll(async () => (await tabletDrawer.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(899);
  381 | 
  382 |   await page.setViewportSize({ width: 900, height: 900 });
  383 |   await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  384 |   const compactDesktopDrawer = page.locator(".mapDrawer.right.springDrawer");
  385 |   await expect(compactDesktopDrawer).toHaveClass(/open/, { timeout: 30_000 });
  386 |   await expect(compactDesktopDrawer).toBeVisible();
  387 |   await expect(compactDesktopDrawer).toHaveAttribute(
  388 |     "data-spring-axis",
  389 |     "horizontal",
  390 |   );
  391 |   expect(
  392 |     await compactDesktopDrawer.evaluate(
  393 |       (node) => getComputedStyle(node).transitionProperty,
  394 |     ),
  395 |   ).toBe("none");
  396 |   const desktopOpenBox = await compactDesktopDrawer.boundingBox();
  397 |   expect(desktopOpenBox).not.toBeNull();
  398 |   expect(desktopOpenBox!.x).toBeLessThan(900);
  399 |   expect(desktopOpenBox!.x + desktopOpenBox!.width).toBeCloseTo(900, 0);
  400 |   await compactDesktopDrawer.locator(".surfaceNavHome").click();
  401 |   await expect(compactDesktopDrawer).toHaveAttribute("aria-hidden", "true");
> 402 |   await expect(compactDesktopDrawer.locator(".venueInspector")).toHaveCount(1);
      |                                                                 ^ Error: expect(locator).toHaveCount(expected) failed
  403 |   await expect(compactDesktopDrawer.locator(".venueInspector")).toHaveCount(0);
  404 |   await expect.poll(async () => (await compactDesktopDrawer.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(899);
  405 | 
  406 |   expect(errors).toEqual([]);
  407 | });
  408 | 
  409 | // ---------------------------------------------------------------------------
  410 | // RESIDUAL GAP (documented, not covered by a flaky test):
  411 | //
  412 | // The rich landmark story CARD (.landmarkCard — photo <img> + "Photo · <credit>"
  413 | // figcaption + external source link + a "Start a crawl here" button seeded from
  414 | // the nearest story pubs) is set exclusively by `selectLandmark(...)`, which the
  415 | // canvas wires to a MapLibre landmark-pin CLICK (components/PubMapCanvas.tsx).
  416 | // There is NO ?landmark= URL state, no list entry, and the whole overlay lives
  417 | // inside the canvas component's success branch — so under the headless `chromium`
  418 | // project (no GPU → the "renderer unavailable" fallback, or a canvas we must not
  419 | // pixel-assert on) that card is genuinely unreachable without WebGL pin-hit-
  420 | // testing. Rather than fake a canvas click (flaky, and forbidden by the brief),
  421 | // the heritage STORY content it renders (description, provenance-badged +
  422 | // source-linked claims) is covered above via the venue sheet's Story tab, and
  423 | // its "start a crawl here" journey entry via the sheet's build-mode add-to-crawl
  424 | // button. The canvas-only landmark card DOM (photo/figcaption/nearest-pub list)
  425 | // remains a residual gap pending either a URL entry point (?landmark=<id>) or a
  426 | // non-canvas list of landmarks.
  427 | 
```