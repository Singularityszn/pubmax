import { test, expect, type Page } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";

function watchRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(request.url());
  });
  return requests;
}

function requested(requests: string[], fragment: string): boolean {
  return requests.some((url) => url.includes(fragment));
}

test("/map initial load uses slim pins without full or detail datasets", async ({ page }) => {
  const requests = watchRequests(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(async () =>
      page.evaluate(() => performance.getEntriesByName("pubmax:first-pins").length),
    )
    .toBeGreaterThan(0);

  // Let post-paint effects settle; a clean map must not begin planning TfL
  // journeys until the viewer opens or maps a route.
  await page.waitForTimeout(1_500);

  expect(requested(requests, "/data/venues_slim.core.json")).toBe(true);
  expect(requested(requests, "/data/pint_prices_app_dataset.json")).toBe(false);
  expect(requested(requests, "/data/venue_detail_index.json")).toBe(false);
  expect(requested(requests, "/data/venue_details.jsonl")).toBe(false);
  expect(requested(requests, "/api/venue/")).toBe(false);
  expect(requested(requests, "/api/citymcp/journey")).toBe(false);
});

test("a filtered beer map link reaches a usable mobile map", async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const requests = watchRequests(page);

  // #912 (8 Aug) removed the landing's Night Signals section and its
  // "Beer at … open on the map" door. The map URL that door wrote is still a
  // shared link, so the filtered arrival starts there.
  await page.goto("/map?drink=beer&style=cheapest");

  await expect(page).toHaveURL(/\/map\?drink=beer&style=cheapest$/);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () => page.evaluate(() => performance.getEntriesByName("pubmax:first-pins").length),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 20_000 });
  // Since #1631 the old Drinks button and its category select are gone. The
  // phone top bar marks the drink filter on Filters, and the drink lane chip
  // names the beer lane as Pints.
  const chrome = page.locator(".mobileMapChrome");
  await expect(chrome.getByRole("button", { name: "Filters: drinks active" })).toBeVisible();
  await expect(
    chrome.getByRole("button", { name: /^Drink shown on the map: Pints\./ }),
  ).toBeVisible();
  await chrome.getByRole("button", { name: "Filters: drinks active" }).click();
  const filters = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  const beer = filters
    .getByRole("group", { name: "Filter by drink shape" })
    .getByRole("button", { name: "Beer (selected)" });
  await expect(beer).toHaveAttribute("aria-pressed", "true");
  await filters.getByRole("button", { name: "Close Prices and places" }).click();
  await expect(filters).toHaveCount(0);

  await page.waitForTimeout(1_500);
  expect(requested(requests, "/api/citymcp/journey")).toBe(false);
});

test("/map lazy-loads selected venue detail through the API", async ({ page }) => {
  const requests = watchRequests(page);

  const detailResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/venue/${SEED_VENUE_ID}`) && response.status() === 200,
  );
  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await detailResponse;
  await expect(page.locator(".venueInspector")).toBeVisible({ timeout: 20_000 });

  expect(requested(requests, "/data/venues_slim.core.json")).toBe(true);
  expect(requested(requests, `/api/venue/${SEED_VENUE_ID}`)).toBe(true);
  expect(requested(requests, "/data/pint_prices_app_dataset.json")).toBe(false);
  expect(requested(requests, "/data/venue_detail_index.json")).toBe(false);
  expect(requested(requests, "/data/venue_details.jsonl")).toBe(false);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("selected map detail acquires Inspector code alongside its data", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Inspector ordering needs the configured production baseURL.");
  const origin = new URL(baseURL).origin;
  const selectedPath = "/map?sel=venue-4xlgb0";
  const detailPath = "/api/venue/venue-4xlgb0";
  const contextOptions = {
    baseURL,
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block" as const,
    storageState: {
      cookies: [],
      origins: [{
        origin,
        localStorage: [
          { name: "pubmaxx:analytics-consent:v1", value: "denied" },
          { name: "pubmax:map-first-visit-arrival:v1", value: "dismissed" },
        ],
      }],
    },
  };

  // Learn ownership from actual served code. Throw this context away so its
  // module/HTTP cache cannot satisfy the ordering assertion in the next one.
  const discovery = await browser.newContext(contextOptions);
  let inspectorPath: string;
  try {
    const page = await discovery.newPage();
    const probes: Promise<string | null>[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin !== origin || !/^\/_next\/static\/chunks\/.*\.js$/.test(url.pathname)) return;
      probes.push(response.text().then((body) =>
        body.includes("venueAddress") && body.includes("venueTabShort") ? url.pathname : null,
      ).catch(() => null));
    });
    await page.goto(selectedPath, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".venueInspector")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Princess Louise", exact: true })).toBeVisible();
    const owners = [...new Set((await Promise.all(probes)).filter((path) => path !== null))];
    expect(owners, "one served chunk must own Inspector markup").toHaveLength(1);
    inspectorPath = owners[0];
  } finally {
    await discovery.close();
  }

  const context = await browser.newContext(contextOptions);
  let releaseData!: () => void;
  const dataReleased = new Promise<void>((resolve) => { releaseData = resolve; });
  let released = false;
  const held: { pathname: string; status: number }[] = [];
  const delivered: string[] = [];
  let inspectorRequestsWhileHeld = 0;
  let detailRequests = 0;
  try {
    const page = await context.newPage();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin) return;
      if (url.pathname === inspectorPath && !released) inspectorRequestsWhileHeld++;
      if (url.pathname === detailPath) detailRequests++;
    });
    // Core, manifest, cells and the whole-index fallback can all carry the
    // selected venue. Preserve every real response, but deliver none yet.
    await page.route((url) => url.origin === origin && (
      url.pathname === detailPath || /^\/data\/venues_slim(?:\.(?:core|manifest|cell\..+))?\.json$/.test(url.pathname)
    ), async (route) => {
      const response = await route.fetch({ timeout: 15_000 });
      const pathname = new URL(route.request().url()).pathname;
      held.push({ pathname, status: response.status() });
      await dataReleased;
      await route.fulfill({ response });
      delivered.push(pathname);
    });
    await page.goto(selectedPath, { waitUntil: "domcontentloaded" });
    await expect.poll(() => held.some((item) => item.pathname === detailPath && item.status === 200), {
      timeout: 20_000,
    }).toBe(true);
    await expect(page.locator(".venueInspector")).toHaveCount(0);
    await expect.poll(() => inspectorRequestsWhileHeld, { timeout: 5_000 }).toBe(1);
    await expect(page.locator(".venueInspector")).toHaveCount(0);
    expect(delivered).toEqual([]);
    expect(released).toBe(false);

    released = true;
    releaseData();
    const inspector = page.locator(".venueInspector");
    await expect(inspector).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Princess Louise", exact: true })).toBeVisible();
    const estimate = inspector.locator('.trustPill[data-standing="estimate"]');
    await expect(estimate).toContainText("est. £6.50");
    await expect(estimate).toContainText("Estimated");
    const overview = inspector.getByRole("tab", { name: "Overview", exact: true });
    await overview.click();
    await expect(overview).toBeFocused();
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(inspector).toHaveCount(0);
    const more = page.locator(".mobileMapChrome").getByRole("button", { name: "More map controls" });
    await more.click();
    await expect(page.locator('.mobileSheetPortal[data-sheet-kind="layers"]:visible')).toHaveCount(1);
    expect(detailRequests).toBe(1);
  } finally {
    released = true;
    releaseData();
    try {
      await context.unrouteAll({ behavior: "wait" });
    } finally {
      await context.close();
    }
  }
});
