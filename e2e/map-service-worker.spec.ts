import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    (
      window as typeof window & {
        __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
      }
    ).__pubmaxPinRevealTrace = [];
    window.addEventListener("pubmax:pin-reveal", (event) => {
      (
        window as typeof window & {
          __pubmaxPinRevealTrace: Array<{
            reason: string;
            generation: number;
          }>;
        }
      ).__pubmaxPinRevealTrace.push(
        (event as CustomEvent<{ reason: string; generation: number }>).detail,
      );
    });
  });
});

test("active worker keeps valid tiles when cache writes fail during an update", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/map");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          let count = 0;
          for (const name of await caches.keys()) {
            if (!name.startsWith("pubmax-sw-swr-")) continue;
            const cache = await caches.open(name);
            for (const cachedRequest of await cache.keys()) {
              if (/tiles\.openfreemap\.org\/planet\/.*\.pbf$/.test(cachedRequest.url)) {
                count += 1;
              }
            }
          }
          return count;
        }),
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(1_000);

  const originalController = await page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? null,
  );
  expect(originalController).toContain("/sw.js?v=");

  const tileUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith("pubmax-sw-swr-")) continue;
      const cache = await caches.open(name);
      for (const cachedRequest of await cache.keys()) {
        const url = new URL(cachedRequest.url);
        if (
          url.hostname === "tiles.openfreemap.org" &&
          /\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/.test(url.pathname)
        ) {
          urls.push(cachedRequest.url);
        }
      }
    }
    return urls;
  });
  expect(tileUrls.length).toBeGreaterThan(0);

  await page.locator('.mobileTabBar a[href="/today"]').click();
  await page.waitForURL("**/today");

  const removed = await page.evaluate(async () => {
    let count = 0;
    for (const name of await caches.keys()) {
      if (!name.startsWith("pubmax-sw-swr-")) continue;
      const cache = await caches.open(name);
      for (const cachedRequest of await cache.keys()) {
        const url = new URL(cachedRequest.url);
        if (
          url.hostname === "tiles.openfreemap.org" &&
          /\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/.test(url.pathname) &&
          (await cache.delete(cachedRequest))
        ) {
          count += 1;
        }
      }
    }
    return count;
  });
  expect(removed).toBeGreaterThan(0);

  const cdp = await context.newCDPSession(page);
  const origin = new URL(page.url()).origin;
  const usage = await cdp.send("Storage.getUsageAndQuota", { origin });
  await cdp.send("Storage.overrideQuotaForOrigin", {
    origin,
    quotaSize: Math.ceil(usage.usage + 1),
  });

  const updateState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register(
      `/sw.js?v=quota-regression-${Date.now()}`,
    );
    const candidate = registration.installing ?? registration.waiting;
    if (
      candidate &&
      candidate.state !== "installed" &&
      candidate.state !== "activated"
    ) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          if (
            candidate.state === "installed" ||
            candidate.state === "activated" ||
            candidate.state === "redundant"
          ) {
            resolve();
          }
        };
        candidate.addEventListener("statechange", finish);
        setTimeout(resolve, 15_000);
      });
    }
    return {
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      active: registration.active?.scriptURL ?? null,
      waiting: registration.waiting?.scriptURL ?? null,
    };
  });

  expect(updateState.controller).toBe(originalController);
  expect(updateState.active).toBe(originalController);
  expect(updateState.waiting).toContain("quota-regression-");

  const direct = await request.get(tileUrls[0]);
  expect(direct.status()).toBe(200);
  expect((await direct.body()).byteLength).toBeGreaterThan(0);

  await page.evaluate(() => {
    (
      window as typeof window & {
        __pubmaxPinRevealTrace: Array<{
          reason: string;
          generation: number;
        }>;
      }
    ).__pubmaxPinRevealTrace = [];
  });
  await page.locator('.mobileTabBar a[href="/map"]').click();
  await page.waitForURL("**/map");

  const revealReason = await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace: Array<{
                  reason: string;
                  generation: number;
                }>;
              }
            ).__pubmaxPinRevealTrace.at(-1)?.reason ?? null,
        ),
      { timeout: 30_000 },
    )
    .not.toBeNull()
    .then(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __pubmaxPinRevealTrace: Array<{
                reason: string;
                generation: number;
              }>;
            }
          ).__pubmaxPinRevealTrace.at(-1)?.reason,
      ),
    );

  expect(revealReason).toBe("tiles");
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(page.locator(".mapSoftRetry")).toHaveCount(0);
  if (process.env.PW_MAP_EVIDENCE === "1") {
    await page.screenshot({
      path: "docs/evidence/map-blank-basemap/after-quota-update-390.png",
    });
  }
});
