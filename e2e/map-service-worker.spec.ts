import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const legacyWorker = readFileSync(
  join(process.cwd(), "e2e/fixtures/pre-fix-map-service-worker.js"),
  "utf8",
);

test.describe.configure({ mode: "serial" });

// The worker the app itself registers (components/OfflineReady.tsx), at the
// version playwright.config.ts pins for every e2e build. The rollout under test
// has to be THIS script: once the route below is lifted, every /map load
// registers it, so a target at any other URL is replaced by a second rollout
// during the reload, which purges the target's tiles while the map is drawing.
const APP_WORKER_URL = "/sw.js?v=local&cache-policy=write-safe-v1";

// The basemap is served locally. The workers cache, purge and serve planet
// tile URLs on the tile host, which is what this spec is about; what is drawn
// from them is not. Live tiles made a headless browser read every painted frame
// back on its main thread for seconds at a time, and a live style, tilejson and
// sprite missed the 3 s pin-reveal window, so the reload revealed on its
// timeout rather than on its pins.
//
// One valid vector tile holding a single empty layer (MVT v2, extent 4096).
const EMPTY_VECTOR_TILE = Buffer.from([
  0x1a, 0x08, 0x78, 0x02, 0x0a, 0x01, 0x78, 0x28, 0x80, 0x20,
]);
const PLANET_TILE = /^https:\/\/tiles\.openfreemap\.org\/planet\/.*\.pbf(?:\?.*)?$/;
// The uncached tile asked for under storage pressure is the size of a real
// one (a central London z12 tile is about 150 KB). A ten-byte body can still
// fit in the slack of a full origin, so the legacy worker would cache it and
// the pre-fix failure this spec reproduces would not happen.
const QUOTA_MISS_TILE = Buffer.alloc(160_000);
const MAP_STYLE =
  /^https:\/\/(?:tiles\.openfreemap\.org\/styles\/(?:dark|positron)\/?|basemaps\.cartocdn\.com\/gl\/(?:dark-matter|positron)-gl-style\/style\.json)$/;
const PLANET_STYLE = JSON.stringify({
  version: 8,
  sources: {
    openmaptiles: {
      type: "vector",
      tiles: ["https://tiles.openfreemap.org/planet/fixture/{z}/{x}/{y}.pbf"],
      maxzoom: 14,
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#111111" } },
    {
      id: "fixture-fill",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "x",
      paint: { "fill-color": "#222222" },
    },
  ],
});

async function resetServiceWorkerState(page: Page): Promise<void> {
  await page.goto("/offline.html");
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister();
      }
    }
    for (const key of await caches.keys()) {
      await caches.delete(key);
    }
  });
}

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
  await resetServiceWorkerState(page);
  // Context-wide, so the workers' own fetches are answered too.
  await context.route(MAP_STYLE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: PLANET_STYLE,
    }),
  );
  await context.route(PLANET_TILE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-protobuf",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: route.request().url().includes("quota-miss=")
        ? QUOTA_MISS_TILE
        : EMPTY_VECTOR_TILE,
    }),
  );
  const workerRoute = /\/sw\.js\?v=/;
  let appRegistrationRefused = false;
  await context.route(workerRoute, (route) => {
    const version = new URL(route.request().url()).searchParams.get("v");
    if (route.request().url().includes(APP_WORKER_URL)) appRegistrationRefused = true;
    if (version?.startsWith("legacy-")) {
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: legacyWorker,
      });
    }
    return route.abort("blockedbyclient");
  });

  await page.goto("/offline.html");
  const activeLegacyUrl = `/sw.js?v=legacy-active-${Date.now()}`;
  await page.evaluate(async (scriptUrl) => {
    await navigator.serviceWorker.register(scriptUrl, {
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
  }, activeLegacyUrl);
  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => navigator.serviceWorker.controller?.scriptURL ?? null,
        ),
      { timeout: 15_000 },
    )
    .toContain("legacy-active-");

  await page.goto("/map");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
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
  expect(activeLegacyController).toContain("legacy-active-");
  expect(activeLegacyController).not.toContain("cache-policy");

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
  const legacyState = await page.evaluate(
    async ({ activeScriptUrl, poisonedTileUrl }) => {
      const version = new URL(activeScriptUrl).searchParams.get("v");
      const cacheNames = {
        data: `pubmax-sw-data-${version}`,
        plan: `pubmax-sw-plan-${version}`,
        shell: `pubmax-sw-shell-${version}`,
        swr: `pubmax-sw-swr-${version}`,
      };
      const swr = await caches.open(cacheNames.swr);
      await swr.put(
        poisonedTileUrl,
        new Response("poisoned", {
          status: 503,
          headers: { "Content-Type": "application/x-protobuf" },
        }),
      );
      await swr.put(
        "/_next/static/chunks/legacy-offline.js",
        new Response("legacy static"),
      );
      await (await caches.open(cacheNames.shell)).put(
        "/offline.html",
        new Response("legacy shell"),
      );
      await (await caches.open(cacheNames.data)).put(
        "/data/legacy-offline.json",
        new Response('{"legacy":true}', {
          headers: { "Content-Type": "application/json" },
        }),
      );
      await (await caches.open(cacheNames.plan)).put(
        "/plan/legacy-offline",
        new Response("legacy plan"),
      );
      return {
        all: (await caches.keys()).filter((name) =>
          name.startsWith("pubmax-sw-"),
        ),
        cacheNames,
      };
    },
    {
      activeScriptUrl: activeLegacyController!,
      poisonedTileUrl: poisonedUrl,
    },
  );
  expect(
    legacyState.all.some((name) => name.includes("legacy-waiting-")),
  ).toBe(true);

  const cdp = await context.newCDPSession(page);
  const origin = new URL(page.url()).origin;
  const usage = await cdp.send("Storage.getUsageAndQuota", { origin });
  await cdp.send("Storage.overrideQuotaForOrigin", {
    origin,
    quotaSize: Math.ceil(usage.usage + 1),
  });
  // Chromium checks a write against the usage its quota manager last
  // recorded, and the legacy worker is still caching tiles in the background,
  // so writes can land past the new quota until that record catches up. The
  // legacy defect below is about a FULL origin, so wait until the origin
  // refuses a write before asking it to cache one more tile.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          try {
            const cache = await caches.open("pubmax-e2e-quota-probe");
            await cache.put(
              `/quota-probe-${Date.now()}`,
              new Response(new Uint8Array(16_384)),
            );
            return "stored";
          } catch {
            return "refused";
          }
        }),
      { message: "the origin refuses writes past its quota", timeout: 30_000 },
    )
    .toBe("refused");

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

  // The app registers its own worker once per page load, at idle after the
  // first pins (components/OfflineReady.tsx). On a slow run that idle could
  // land after the route lifts, and the app would then perform the rollout
  // itself, so the takeover below would find the target already active and
  // wait for a controllerchange that had already happened. Lift the route only
  // once this page's own attempt has been refused.
  await expect
    .poll(() => appRegistrationRefused, {
      message: "the app's own worker registration was refused before the rollout",
      timeout: 30_000,
    })
    .toBe(true);
  await context.unroute(workerRoute);
  const targetWorkerUrl = APP_WORKER_URL;
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
    if (candidate && candidate.state !== "activated") {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("target worker did not finish activating")),
          15_000,
        );
        const onStateChange = () => {
          if (candidate.state !== "activated") return;
          clearTimeout(timeout);
          candidate.removeEventListener("statechange", onStateChange);
          resolve();
        };
        candidate.addEventListener("statechange", onStateChange);
        onStateChange();
      });
    }
    return {
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      states,
      waiting: registration.waiting?.scriptURL ?? null,
    };
  }, targetWorkerUrl);

  expect(takeover.controller).toContain(APP_WORKER_URL);
  expect(takeover.states).toContain("installed");
  expect(takeover.states).toContain("activated");
  expect(takeover.waiting).toBeNull();
  const cacheContinuity = await page.evaluate(
    async ({ poisonedTileUrl, targetScriptUrl }) => {
      const names = await caches.keys();
      const targetVersion = new URL(targetScriptUrl).searchParams.get("v");
      const familyNames = (family: string) =>
        names.filter((name) => name.startsWith(`pubmax-sw-${family}-`));
      const matchFamily = async (family: string, request: string) => {
        for (const name of familyNames(family)) {
          const response = await (await caches.open(name)).match(request);
          if (response) return true;
        }
        return false;
      };
      const oldTileUrls: string[] = [];
      for (const name of familyNames("swr")) {
        if (name === `pubmax-sw-swr-${targetVersion}`) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (new URL(request.url).hostname === "tiles.openfreemap.org") {
            oldTileUrls.push(request.url);
          }
        }
      }
      return {
        data: await matchFamily("data", "/data/legacy-offline.json"),
        plan: await matchFamily("plan", "/plan/legacy-offline"),
        poisoned: await matchFamily("swr", poisonedTileUrl),
        shell: await matchFamily("shell", "/offline.html"),
        staticAsset: await matchFamily(
          "swr",
          "/_next/static/chunks/legacy-offline.js",
        ),
        oldTileUrls,
      };
    },
    {
      poisonedTileUrl: poisonedUrl,
      targetScriptUrl: takeover.controller!,
    },
  );
  expect(cacheContinuity).toEqual({
    data: true,
    plan: true,
    poisoned: false,
    shell: true,
    staticAsset: true,
    oldTileUrls: [],
  });

  await page.reload();
  const revealBaseline = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxPinRevealTrace: Array<{ reason: string; generation: number }>;
        }
      ).__pubmaxPinRevealTrace.length,
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () => navigator.serviceWorker.controller?.scriptURL ?? null,
        ),
      { timeout: 15_000 },
    )
    .toContain(APP_WORKER_URL);
  const recoveredTile = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, size: (await response.arrayBuffer()).byteLength };
  }, poisonedUrl);
  expect(recoveredTile.status).toBe(200);
  expect(recoveredTile.size).toBeGreaterThan(0);

  await expect
    .poll(
      () =>
        page.evaluate((baseline) => {
          const trace = (
            window as typeof window & {
              __pubmaxPinRevealTrace: Array<{
                reason: string;
                generation: number;
              }>;
            }
          ).__pubmaxPinRevealTrace;
          return trace
            .slice(baseline)
            .some((entry) =>
              entry.reason === "tiles" ||
              entry.reason === "pins" ||
              entry.reason === "idle",
            );
        }, revealBaseline),
      {
        message:
          "the reloaded map reaches a post-takeover reveal (phone uses pins, not tiles)",
        timeout: 60_000,
      },
    )
    .toBe(true);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(page.locator(".mapSoftRetry")).toHaveCount(0);
  if (process.env.PW_MAP_EVIDENCE === "1") {
    await page.screenshot({
      path: "docs/evidence/map-blank-basemap/after-quota-update-390.png",
    });
  }
});
