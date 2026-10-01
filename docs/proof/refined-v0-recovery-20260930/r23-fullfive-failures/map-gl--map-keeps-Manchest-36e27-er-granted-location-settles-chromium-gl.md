# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-gl.spec.ts >> /map keeps Manchester cluster markers mounted after granted location settles
- Location: e2e/map-gl.spec.ts:962:5

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator:  locator('button.citySuggestBannerSwitch')
Expected: enabled
Received: disabled
Timeout:  20000ms

Call log:
  - Expect "toBeEnabled" with timeout 20000ms
  - waiting for locator('button.citySuggestBannerSwitch')
    43 × locator resolved to <button disabled type="button" class="citySuggestBannerSwitch">Checking…</button>
       - unexpected value "disabled"

```

```yaml
- button "Checking…" [disabled]
```

# Test source

```ts
  877  |   await page.waitForTimeout(2_000);
  878  |   await expect(notice).toBeVisible();
  879  |   await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  880  |   await expect(page.locator(".mapFallback")).toHaveCount(0);
  881  | });
  882  | 
  883  | // Dead-frame-loop contract. A browser can grant WebGL while its render loop
  884  | // never produces a frame at all. Stubbing rAF keeps every MapLibre "render"
  885  | // event from firing, so the 10-second first-frame watchdog — not the pin
  886  | // readiness ceiling, which never unmounts anything — owns the honest, readable
  887  | // no-frame fallback.
  888  | 
  889  | test("/map shows a readable fallback when the phone render loop never draws a frame", async ({
  890  |   page,
  891  | }) => {
  892  |   test.setTimeout(60_000);
  893  |   await page.setViewportSize({ width: 390, height: 844 });
  894  |   await page.addInitScript(() => {
  895  |     // Frame loop never runs: rAF registers callbacks but never invokes them.
  896  |     window.requestAnimationFrame = () => 1;
  897  |     window.cancelAnimationFrame = () => {};
  898  |   });
  899  |   const response = await page.goto("/map");
  900  |   expect(response?.status()).toBe(200);
  901  | 
  902  |   // The map constructs (context granted) — the canvas exists…
  903  |   await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  904  | 
  905  |   // No frame ever renders, so the first-frame watchdog must surface the honest
  906  |   // fallback (10s watchdog + render slack) and keep it: the later pin readiness
  907  |   // ceiling has no card of its own to overwrite this one with.
  908  |   const fallback = page.locator(".mapFallback");
  909  |   await expect(fallback).toBeVisible({ timeout: 25_000 });
  910  |   await expect(fallback).toContainText("Map couldn't draw");
  911  |   await expect(fallback).toContainText("The map opened but did not draw anything.");
  912  |   await page.waitForTimeout(6_000);
  913  |   await expect(fallback).toContainText("The map opened but did not draw anything.");
  914  |   await expect(page.locator(".mapSoftRetry")).toHaveCount(0);
  915  |   await expect(fallback.getByRole("button", { name: "Technical details" })).toHaveAttribute(
  916  |     "aria-expanded",
  917  |     "false",
  918  |   );
  919  | 
  920  |   // A dead frame loop is retryable (a re-init can recover a crashed GPU
  921  |   // process), so Retry stays visible — unlike the confirmed-no-WebGL case.
  922  |   await expect(page.locator(".mapFallbackRetry")).toBeVisible();
  923  | 
  924  |   // Venue content survives: static list rows + the directory link.
  925  |   await expect(page.locator(".mapFallbackBrowse")).toBeVisible();
  926  |   await expect
  927  |     .poll(async () => page.locator(".mapFallbackVenue").count(), { timeout: 15_000 })
  928  |     .toBeGreaterThan(0);
  929  | 
  930  |   const fallbackBackground = rgbChannels(
  931  |     await fallback.evaluate((node) => getComputedStyle(node).backgroundColor),
  932  |   );
  933  |   for (const [label, control] of [
  934  |     ["heading", fallback.locator("strong")],
  935  |     ["explanation", fallback.locator("p")],
  936  |     ["venue", fallback.locator(".mapFallbackVenueName").first()],
  937  |     ["Browse link", fallback.locator(".mapFallbackBrowse")],
  938  |     ["Retry", fallback.locator(".mapFallbackRetry")],
  939  |   ] as const) {
  940  |     const foreground = rgbChannels(
  941  |       await control.evaluate((node) => getComputedStyle(node).color),
  942  |     );
  943  |     expect(
  944  |       contrastRatio(foreground, fallbackBackground),
  945  |       `${label} contrast against fallback surface`,
  946  |     ).toBeGreaterThanOrEqual(4.5);
  947  |   }
  948  | });
  949  | 
  950  | test("/map reuses granted location after an explicit Near me action", async ({ page, context }) => {
  951  |   test.setTimeout(60_000);
  952  |   await page.setViewportSize({ width: 390, height: 844 });
  953  |   await context.grantPermissions(["geolocation"]);
  954  |   await context.setGeolocation({ latitude: 51.513, longitude: -0.125 });
  955  |   await page.goto("/map");
  956  |   await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  957  |   await page.getByRole("button", { name: "Near me" }).click();
  958  |   await expect(page.getByRole("button", { name: "Nearby" })).toBeVisible({ timeout: 20_000 });
  959  |   await expect(page.locator("[data-user-location='shown']")).toBeAttached({ timeout: 20_000 });
  960  | });
  961  | 
  962  | test("/map keeps Manchester cluster markers mounted after granted location settles", async ({
  963  |   page,
  964  |   context,
  965  | }) => {
  966  |   test.setTimeout(90_000);
  967  |   await page.setViewportSize({ width: 1600, height: 1000 });
  968  |   await context.grantPermissions(["geolocation"]);
  969  |   await context.setGeolocation({ latitude: 53.4808, longitude: -2.2426 });
  970  | 
  971  |   // Load Manchester with permission already granted, then invoke the attached
  972  |   // control directly. Banner staging may hide it, but HTMLElement.click still
  973  |   // exercises the same checkNearby/onLocationFound path as a painted control.
  974  |   await page.goto("/map/manchester");
  975  |   const nearMe = page.locator("button.citySuggestBannerSwitch");
  976  |   await expect(nearMe).toBeAttached({ timeout: 20_000 });
> 977  |   await expect(nearMe).toBeEnabled({ timeout: 20_000 });
       |                        ^ Error: expect(locator).toBeEnabled() failed
  978  |   await nearMe.evaluate((button: HTMLButtonElement) => button.click());
  979  |   await expect(page.locator("[data-user-location='shown']")).toBeAttached({
  980  |     timeout: 20_000,
  981  |   });
  982  |   await page.waitForTimeout(2_000);
  983  |   // Show all moved into the Layers popover with the map-chrome consolidation;
  984  |   // dismiss the location status first so it cannot cover the popover trigger.
  985  |   await page.getByRole("button", { name: "Dismiss city suggestion" }).click();
  986  |   await page.getByRole("button", { name: /Map layers/ }).click();
  987  |   const showAll = page.getByRole("button", {
  988  |     name: "Show all of Manchester",
  989  |   });
  990  |   await expect(showAll).toBeVisible({ timeout: 20_000 });
  991  |   await showAll.click();
  992  | 
  993  |   const donuts = page.locator(".donut-cluster-marker");
  994  |   // fitCityBounds runs an 800 ms cinematic. Let that intentional transition
  995  |   // finish, then require a stable non-empty cluster count before observing for
  996  |   // the ongoing empty/non-empty loop this regression targets.
  997  |   await page.waitForTimeout(1_000);
  998  |   await expect
  999  |     .poll(
  1000 |       async () => {
  1001 |         const counts = [await donuts.count()];
  1002 |         for (let sample = 0; sample < 4; sample += 1) {
  1003 |           await page.waitForTimeout(150);
  1004 |           counts.push(await donuts.count());
  1005 |         }
  1006 |         return counts[0] > 0 && counts.every((count) => count === counts[0]);
  1007 |       },
  1008 |       { timeout: 20_000 },
  1009 |     )
  1010 |     .toBe(true);
  1011 | 
  1012 |   // Once the city camera has settled, transient source snapshots must not
  1013 |   // unmount every donut and hand the same clusters back to the GL fallback.
  1014 |   // That DOM-empty/GL-visible alternation is the reported desktop flicker.
  1015 |   const counts: number[] = [];
  1016 |   for (let sample = 0; sample < 30; sample += 1) {
  1017 |     counts.push(await donuts.count());
  1018 |     await page.waitForTimeout(75);
  1019 |   }
  1020 |   expect(counts, `cluster marker counts after settle: ${counts.join(",")}`).not.toContain(0);
  1021 | });
  1022 | 
  1023 | // Issue #35 — optimistic-pins perf guard. The map paints pins from the ~116 KB
  1024 | // slim index BEFORE the ~5.6 MB full dataset lands; PubMap drops a
  1025 | // `pubmax:first-pins` performance.mark the instant those slim pins are set.
  1026 | // Asserting the mark exists and fires early is a WebGL-flake-free proxy for
  1027 | // "first interactive pin is fast" (the PRD's map-click → first pin target),
  1028 | // since it measures the data path, not the GPU. Threshold is a generous CI
  1029 | // ceiling (4s) well under the old full-dataset-only path.
  1030 | test("/map paints optimistic pins from the slim index quickly", async ({ page }) => {
  1031 |   test.setTimeout(60_000);
  1032 |   const fullDatasetRequests: string[] = [];
  1033 |   page.on("request", (request) => {
  1034 |     const path = new URL(request.url()).pathname;
  1035 |     if (path === "/data/pint_prices_app_dataset.json") {
  1036 |       fullDatasetRequests.push(request.url());
  1037 |     }
  1038 |   });
  1039 | 
  1040 |   const response = await page.goto("/map");
  1041 |   expect(response?.status()).toBe(200);
  1042 | 
  1043 |   // Wait until PubMap has set its first-pins mark. It's dropped in a client
  1044 |   // effect after loadSlimVenues() resolves, so poll the Performance timeline.
  1045 |   await expect
  1046 |     .poll(
  1047 |       () =>
  1048 |         page.evaluate(() => performance.getEntriesByName("pubmax:first-pins")[0]?.startTime ?? 0),
  1049 |       { timeout: 45_000 },
  1050 |     )
  1051 |     .toBeGreaterThan(0);
  1052 | 
  1053 |   const startTime = await page.evaluate(() => {
  1054 |     const [mark] = performance.getEntriesByName("pubmax:first-pins");
  1055 |     return mark ? mark.startTime : Number.POSITIVE_INFINITY;
  1056 |   });
  1057 | 
  1058 |   // startTime is ms since navigation start — the time to the first optimistic
  1059 |   // pin paint. The network assertion below is the hard regression guard against
  1060 |   // reintroducing the full-dataset path; this ceiling stays CI-safe under
  1061 |   // SwiftShader and a cold production server.
  1062 |   expect(startTime).toBeLessThan(10000);
  1063 |   expect(fullDatasetRequests).toEqual([]);
  1064 | });
  1065 | 
  1066 | test("desktop area search resolves a gazetteer locality and fits the map", async ({ page }) => {
  1067 |   test.setTimeout(120_000);
  1068 |   await page.setViewportSize({ width: 1440, height: 900 });
  1069 |   await page.emulateMedia({ reducedMotion: "reduce" });
  1070 |   await page.addInitScript(() => {
  1071 |     (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents = [];
  1072 |     window.addEventListener("pubmax:camera-intent", (event) => {
  1073 |       const detail = (event as CustomEvent<{ kind: string; sequence: number }>).detail;
  1074 |       (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents?.push(detail);
  1075 |     });
  1076 |   });
  1077 |   await page.route("**/data/london_localities.json", (route) =>
```