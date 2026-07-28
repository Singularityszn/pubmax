import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const legacyWorker = readFileSync(
  join(process.cwd(), "e2e/fixtures/pre-fix-map-service-worker.js"),
  "utf8",
);

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

test("target worker replaces the pre-fix controller and purges poisoned tiles", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.route(/\/sw\.js\?v=/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: legacyWorker,
    }),
  );

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

  const activeLegacyController = await page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? null,
  );
  expect(activeLegacyController).toContain("/sw.js?v=");

  const tileUrl = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (!name.startsWith("pubmax-sw-swr-")) continue;
      const cache = await caches.open(name);
      for (const cachedRequest of await cache.keys()) {
        if (/tiles\.openfreemap\.org\/planet\/.*\.pbf$/.test(cachedRequest.url)) {
          return cachedRequest.url;
        }
      }
    }
    return null;
  });
  expect(tileUrl).not.toBeNull();

  await page.locator('.mobileTabBar a[href="/today"]').click();
  await page.waitForURL("**/today");

  const waitingLegacyUrl = `/sw.js?v=legacy-waiting-${Date.now()}`;
  const waitingState = await page.evaluate(async (scriptUrl) => {
    const registration = await navigator.serviceWorker.register(scriptUrl);
    const candidate = registration.installing ?? registration.waiting;
    if (candidate && candidate.state !== "installed") {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("legacy update did not reach waiting")),
          15_000,
        );
        candidate.addEventListener("statechange", () => {
          if (candidate.state === "installed") {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    }
    return {
      active: registration.active?.scriptURL ?? null,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      waiting: registration.waiting?.scriptURL ?? null,
    };
  }, waitingLegacyUrl);
  expect(waitingState.active).toBe(activeLegacyController);
  expect(waitingState.controller).toBe(activeLegacyController);
  expect(waitingState.waiting).toContain("legacy-waiting-");

  const poisonedUrl = `${tileUrl}?poisoned-rollout=1`;
  const legacyCaches = await page.evaluate(
    async ({ activeScriptUrl, poisonedTileUrl }) => {
      const version = new URL(activeScriptUrl).searchParams.get("v");
      const activeCacheName = `pubmax-sw-swr-${version}`;
      const cache = await caches.open(activeCacheName);
      await cache.put(
        poisonedTileUrl,
        new Response("poisoned", {
          status: 503,
          headers: { "Content-Type": "application/x-protobuf" },
        }),
      );
      return (await caches.keys()).filter((name) => name.startsWith("pubmax-sw-"));
    },
    {
      activeScriptUrl: activeLegacyController!,
      poisonedTileUrl: poisonedUrl,
    },
  );
  expect(legacyCaches.some((name) => name.includes("legacy-waiting-"))).toBe(true);

  const cdp = await context.newCDPSession(page);
  const origin = new URL(page.url()).origin;
  const usage = await cdp.send("Storage.getUsageAndQuota", { origin });
  await cdp.send("Storage.overrideQuotaForOrigin", {
    origin,
    quotaSize: Math.ceil(usage.usage + 1),
  });

  const uncachedTileUrl = `${tileUrl}?quota-miss=${Date.now()}`;
  const direct = await request.get(uncachedTileUrl);
  expect(direct.status()).toBe(200);
  expect((await direct.body()).byteLength).toBeGreaterThan(0);
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url);
        return "delivered";
      } catch {
        return "errored";
      }
    }, uncachedTileUrl),
  ).toBe("errored");

  await context.unroute(/\/sw\.js\?v=/);
  const targetWorkerUrl = `/sw.js?v=rollout-target-${Date.now()}`;
  const takeover = await page.evaluate(async (scriptUrl) => {
    const states: string[] = [];
    const controllerChanged = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
        once: true,
      });
    });
    const registration = await navigator.serviceWorker.register(scriptUrl, {
      updateViaCache: "none",
    });
    const candidate = registration.installing ?? registration.waiting;
    if (candidate) {
      states.push(candidate.state);
      candidate.addEventListener("statechange", () => states.push(candidate.state));
    }
    await controllerChanged;
    return {
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      states,
      waiting: registration.waiting?.scriptURL ?? null,
    };
  }, targetWorkerUrl);

  expect(takeover.controller).toContain("rollout-target-");
  expect(takeover.states).toContain("installed");
  expect(takeover.states).toContain("activated");
  expect(takeover.waiting).toBeNull();
  await expect
    .poll(() =>
      page.evaluate(
        async (superseded) =>
          (await caches.keys()).filter((name) => superseded.includes(name)),
        legacyCaches,
      ),
    )
    .toEqual([]);

  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => navigator.serviceWorker.controller?.scriptURL ?? null,
        ),
      { timeout: 15_000 },
    )
    .toContain("rollout-target-");
  const recoveredTile = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, size: (await response.arrayBuffer()).byteLength };
  }, poisonedUrl);
  expect(recoveredTile.status).toBe(200);
  expect(recoveredTile.size).toBeGreaterThan(0);

  await expect
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
    .toBe("tiles");
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(page.locator(".mapSoftRetry")).toHaveCount(0);
  if (process.env.PW_MAP_EVIDENCE === "1") {
    await page.screenshot({
      path: "docs/evidence/map-blank-basemap/after-quota-update-390.png",
    });
  }
});
