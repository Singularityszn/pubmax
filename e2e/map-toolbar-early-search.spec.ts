import { expect, test } from "@playwright/test";

// The desktop search loads beside the toolbar, rather than after its render.
// Discover the actual shipped chunks from their response bodies, following the
// existing map-search-chunk-failure spec without hard-coding bundle filenames.
const TOOLBAR_MARKER = '"mapToolbarSearch"';
const SEARCH_MARKER = "mapSearchSuggestScroll";

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("desktop search is requested before the held toolbar can render", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let toolbarHeld = false;
  let searchRequested = false;
  const sequence: { kind: string; url: string }[] = [];
  await page.route("**/_next/static/chunks/**", async (route) => {
    if (!route.request().url().includes(".js")) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    const isToolbar = body.includes(TOOLBAR_MARKER);
    const isSearch = body.includes(SEARCH_MARKER);
    if (isToolbar && isSearch) throw new Error("Search and toolbar must have distinct compiled owners for this sequencing proof.");
    if (isSearch) {
      searchRequested = true;
      sequence.push({ kind: "search-request", url: route.request().url() });
    }
    if (isToolbar) {
      toolbarHeld = true;
      sequence.push({ kind: "toolbar-held", url: route.request().url() });
      await held;
      sequence.push({ kind: "toolbar-released", url: route.request().url() });
    }
    await route.fulfill({ response, body });
  });
  try {
    await page.goto("/map", { waitUntil: "domcontentloaded" });
    await expect.poll(() => toolbarHeld && searchRequested, { timeout: 30_000 }).toBe(true);
    await expect(page.locator("#mapSearchInput")).toHaveCount(0);
    release();
    await expect(page.locator("#mapSearchInput")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Spilled." })).toHaveCount(0);
  } finally {
    release();
    await testInfo.attach("request-sequence.json", {
      body: JSON.stringify(sequence), contentType: "application/json",
    });
  }
});

test("refused search keeps the toolbar and explicit retry restores typed input", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  let refuse = true;
  const requests: { url: string; refused: boolean }[] = [];
  await page.route("**/_next/static/chunks/**", async (route) => {
    if (!route.request().url().includes(".js")) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes(SEARCH_MARKER)) {
      requests.push({ url: route.request().url(), refused: refuse });
      if (refuse) return route.abort("failed");
    }
    await route.fulfill({ response, body });
  });
  try {
    await page.goto("/map", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 45_000 });
    const failed = page.locator(".mapToolbar .lazyPanelFailed");
    await expect(failed).toBeVisible({ timeout: 30_000 });
    await expect(failed).toContainText("Search did not open.");
    expect(requests.some((request) => request.refused)).toBe(true);
    await expect(page.getByRole("heading", { name: "Spilled." })).toHaveCount(0);
    await expect(page.locator("canvas.maplibregl-canvas").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("refused-search-map-stays-up.png") });

    refuse = false;
    await failed.getByRole("button", { name: "Try again" }).click();
    const input = page.locator("#mapSearchInput");
    await expect(input).toBeEditable({ timeout: 30_000 });
    await input.click();
    await input.pressSequentially("Ice Wharf", { delay: 20 });
    await expect(input).toHaveValue("Ice Wharf");
    await expect(input).toBeFocused();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("Ice Wharf");
    await expect(failed).toHaveCount(0);
    expect(requests.some((request) => !request.refused)).toBe(true);
    await expect(page.getByRole("heading", { name: "Spilled." })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("retry-search-keeps-typed-query.png") });
  } finally {
    await testInfo.attach("actual-refusal-retry.json", {
      body: JSON.stringify(requests), contentType: "application/json",
    });
  }
});
