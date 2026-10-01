# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-service-worker.spec.ts >> target worker replaces the pre-fix controller and purges poisoned tiles
- Location: e2e/map-service-worker.spec.ts:51:5

# Error details

```
Error: the reloaded map reaches a post-takeover reveal (phone uses pins, not tiles)

the reloaded map reaches a post-takeover reveal (phone uses pins, not tiles)

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=f4e1]:
  - link "Skip to main content" [ref=f4e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=f4e3]:
    - region "Interactive pub map of London" [ref=f4e4]:
      - generic [ref=f4e5]:
        - generic [ref=f4e6]:
          - region "Map" [ref=f4e7]
          - group [ref=f4e8]:
            - generic "Toggle attribution" [ref=f4e9] [cursor=pointer]
        - status [ref=f4e10]:
          - generic [ref=f4e11]: Map background couldn't load. Try again.
          - button "Retry" [ref=f4e12] [cursor=pointer]
      - generic "Map controls":
        - generic [ref=f4e13]:
          - link "Open PUBMAXX landing page" [ref=f4e14] [cursor=pointer]:
            - /url: /
            - img "PUBMAXX" [ref=f4e15]:
              - generic [ref=f4e17]:
                - generic [ref=f4e18]: PUBMAX
                - generic [ref=f4e19]: X
          - 'button "Map area: London. Change city" [ref=f4e21] [cursor=pointer]':
            - generic [ref=f4e22]: London
          - button "Search the map" [ref=f4e24] [cursor=pointer]
          - button "Filters" [ref=f4e28] [cursor=pointer]
          - button "More map controls" [ref=f4e30] [cursor=pointer]
        - 'button "Drink shown on the map: Pints. Choose another drink" [ref=f4e36] [cursor=pointer]':
          - generic [ref=f4e40]: Pints
      - generic "Map utilities":
        - 'button "TfL live: 9 updates" [ref=f4e41] [cursor=pointer]':
          - generic [ref=f4e49]: "9"
        - button "Near me" [ref=f4e50] [cursor=pointer]
      - button "Describe the outing" [ref=f4e54] [cursor=pointer]:
        - strong [ref=f4e60]: Describe the outing
  - navigation "Primary":
    - list [ref=f4e61]:
      - listitem
      - listitem [ref=f4e62]:
        - link "Tonight" [ref=f4e63] [cursor=pointer]:
          - /url: /tonight
      - listitem [ref=f4e71]:
        - link "Map" [ref=f4e72] [cursor=pointer]:
          - /url: /map
      - listitem [ref=f4e78]:
        - link "Places" [ref=f4e79] [cursor=pointer]:
          - /url: /places
      - listitem [ref=f4e85]:
        - link "Out" [ref=f4e86] [cursor=pointer]:
          - /url: /out
      - listitem [ref=f4e93]:
        - link "Plan" [ref=f4e94] [cursor=pointer]:
          - /url: /plan
      - listitem [ref=f4e102]:
        - link "You" [ref=f4e103] [cursor=pointer]:
          - /url: /u/you
  - button "Create" [ref=f4e110] [cursor=pointer]
  - alert [ref=f4e112]
```

# Test source

```ts
  286 |   const cacheContinuity = await page.evaluate(
  287 |     async ({ poisonedTileUrl, targetScriptUrl }) => {
  288 |       const names = await caches.keys();
  289 |       const targetVersion = new URL(targetScriptUrl).searchParams.get("v");
  290 |       const familyNames = (family: string) =>
  291 |         names.filter((name) => name.startsWith(`pubmax-sw-${family}-`));
  292 |       const matchFamily = async (family: string, request: string) => {
  293 |         for (const name of familyNames(family)) {
  294 |           const response = await (await caches.open(name)).match(request);
  295 |           if (response) return true;
  296 |         }
  297 |         return false;
  298 |       };
  299 |       const oldTileUrls: string[] = [];
  300 |       for (const name of familyNames("swr")) {
  301 |         if (name === `pubmax-sw-swr-${targetVersion}`) continue;
  302 |         const cache = await caches.open(name);
  303 |         for (const request of await cache.keys()) {
  304 |           if (new URL(request.url).hostname === "tiles.openfreemap.org") {
  305 |             oldTileUrls.push(request.url);
  306 |           }
  307 |         }
  308 |       }
  309 |       return {
  310 |         data: await matchFamily("data", "/data/legacy-offline.json"),
  311 |         plan: await matchFamily("plan", "/plan/legacy-offline"),
  312 |         poisoned: await matchFamily("swr", poisonedTileUrl),
  313 |         shell: await matchFamily("shell", "/offline.html"),
  314 |         staticAsset: await matchFamily(
  315 |           "swr",
  316 |           "/_next/static/chunks/legacy-offline.js",
  317 |         ),
  318 |         oldTileUrls,
  319 |       };
  320 |     },
  321 |     {
  322 |       poisonedTileUrl: poisonedUrl,
  323 |       targetScriptUrl: takeover.controller!,
  324 |     },
  325 |   );
  326 |   expect(cacheContinuity).toEqual({
  327 |     data: true,
  328 |     plan: true,
  329 |     poisoned: false,
  330 |     shell: true,
  331 |     staticAsset: true,
  332 |     oldTileUrls: [],
  333 |   });
  334 | 
  335 |   await page.reload();
  336 |   const revealBaseline = await page.evaluate(
  337 |     () =>
  338 |       (
  339 |         window as typeof window & {
  340 |           __pubmaxPinRevealTrace: Array<{ reason: string; generation: number }>;
  341 |         }
  342 |       ).__pubmaxPinRevealTrace.length,
  343 |   );
  344 |   await expect
  345 |     .poll(
  346 |       () =>
  347 |         page.evaluate(
  348 |           () => navigator.serviceWorker.controller?.scriptURL ?? null,
  349 |         ),
  350 |       { timeout: 15_000 },
  351 |     )
  352 |     .toContain("rollout-target-");
  353 |   const recoveredTile = await page.evaluate(async (url) => {
  354 |     const response = await fetch(url);
  355 |     return { status: response.status, size: (await response.arrayBuffer()).byteLength };
  356 |   }, poisonedUrl);
  357 |   expect(recoveredTile.status).toBe(200);
  358 |   expect(recoveredTile.size).toBeGreaterThan(0);
  359 | 
  360 |   await expect
  361 |     .poll(
  362 |       () =>
  363 |         page.evaluate((baseline) => {
  364 |           const trace = (
  365 |             window as typeof window & {
  366 |               __pubmaxPinRevealTrace: Array<{
  367 |                 reason: string;
  368 |                 generation: number;
  369 |               }>;
  370 |             }
  371 |           ).__pubmaxPinRevealTrace;
  372 |           return trace
  373 |             .slice(baseline)
  374 |             .some((entry) =>
  375 |               entry.reason === "tiles" ||
  376 |               entry.reason === "pins" ||
  377 |               entry.reason === "idle",
  378 |             );
  379 |         }, revealBaseline),
  380 |       {
  381 |         message:
  382 |           "the reloaded map reaches a post-takeover reveal (phone uses pins, not tiles)",
  383 |         timeout: 60_000,
  384 |       },
  385 |     )
> 386 |     .toBe(true);
      |      ^ Error: the reloaded map reaches a post-takeover reveal (phone uses pins, not tiles)
  387 |   await expect(page.locator(".mapFallback")).toHaveCount(0);
  388 |   await expect(page.locator(".mapSoftRetry")).toHaveCount(0);
  389 |   if (process.env.PW_MAP_EVIDENCE === "1") {
  390 |     await page.screenshot({
  391 |       path: "docs/evidence/map-blank-basemap/after-quota-update-390.png",
  392 |     });
  393 |   }
  394 | });
  395 | 
```