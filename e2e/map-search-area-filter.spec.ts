import { expect, test, type Page } from "@playwright/test";
import { mobileMapShellControl } from "./helpers/mobileMapShell";

const PHONE = { width: 393, height: 852 };

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: PHONE,
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

test.setTimeout(120_000);

async function settleStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:analytics-consent:v1", "denied");
    window.localStorage.removeItem("pubmaxx.mobile-map-session.v1");
  });
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ asOf: null, weather: null, tubeLines: [], signals: [] }),
    }),
  );
  await page.route("**/api/area-news?**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
}

async function openMapSearch(page: Page) {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  const searchToggle = await mobileMapShellControl(page, "search");
  await expect(async () => {
    if (!(await page.getByRole("combobox", { name: "Search pubs" }).count())) {
      await searchToggle.click();
    }
    await expect(page.getByRole("combobox", { name: "Search pubs" })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 20_000 });
  return page.getByRole("combobox", { name: "Search pubs" });
}

test("area picks clear the text filter before priced pins paint", async ({ page }) => {
  await settleStorage(page);
  const search = await openMapSearch(page);
  await search.fill("White");
  const whitechapel = page.getByRole("group", { name: "Areas", exact: true })
    .getByRole("option", { name: /Whitechapel/i });
  await expect(whitechapel).toBeVisible({ timeout: 20_000 });
  await whitechapel.click();

  await expect(page).toHaveURL((url) => url.searchParams.get("q") === null);
  // The pick opens the This area sheet once the camera settles. At that snap
  // its backdrop covers the whole canvas, and the painted-pin probe counts only
  // marks no app chrome covers. Close the sheet the way a reader would before
  // asking which pins the map is painting.
  const areaSheet = page.getByRole("dialog", { name: "This area" });
  await expect(areaSheet).toBeVisible({ timeout: 20_000 });
  await expect(areaSheet.getByRole("heading", { name: "Cheapest pints in Whitechapel" })).toBeVisible();
  await areaSheet.getByRole("button", { name: "Close and return to the map" }).click();
  await expect(areaSheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Dismiss This area backdrop" })).toBeHidden();

  await expect(
    page.getByRole("button", { name: /Map area: Whitechapel/i }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("map-filter-empty")).toHaveCount(0);
  await expect(page.locator(".mapSoftRetry")).toHaveCount(0);

  const paintedMarks = () =>
    page.evaluate(() => {
      const probe = (window as unknown as {
        __pubmaxPaintedMapTapPoints?: () => unknown[];
      }).__pubmaxPaintedMapTapPoints;
      return probe?.().length ?? 0;
    });
  await expect.poll(paintedMarks, { timeout: 45_000 }).toBeGreaterThan(0);

  const mapCanvas = page.locator(".mapCanvasWrap").first();
  await expect
    .poll(async () => Number(await mapCanvas.getAttribute("data-venue-count")), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  // The curated venue collection is the priced pin lane; a non-zero settled
  // collection plus a painted mark proves the Whitechapel pins returned.
  await expect(page.locator(".mapSoftRetry")).toHaveCount(0);
  await expect(page.getByText("Area updates are unavailable right now.", { exact: true })).toBeHidden();
});

type LayoutShift = PerformanceEntry & { value: number; hadRecentInput: boolean };

declare global {
  interface Window {
    __areaOpenShifts?: () => Array<{ startTime: number; value: number }>;
  }
}

// THE AREA SHEET OPENS AT ITS RESTING HEIGHT. Its body is a lazy chunk, and
// the sheet is as tall as its body up to its snap cap. Without a reserve it
// opened around an empty body (90px at 390x844) and grew to its cap when the
// chunk landed, and Chrome scored the move as a layout shift of 0.73. Every
// chunk asked for after Enter is held until the sheet is on screen, the way a
// slow phone network holds it, so the body always lands after the sheet rests.
// A service worker would answer the chunk before the route sees it.
test.describe(() => {
  test.use({ serviceWorkers: "block" });

  test("Enter on an area's name opens its sheet with no layout shift", async ({ page }) => {
    await settleStorage(page);
    await page.addInitScript(() => {
      const shifts: Array<{ startTime: number; value: number }> = [];
      const keep = (entries: PerformanceEntryList) => {
        for (const entry of entries as LayoutShift[]) {
          if (!entry.hadRecentInput) shifts.push({ startTime: entry.startTime, value: entry.value });
        }
      };
      const observer = new PerformanceObserver((list) => keep(list.getEntries()));
      observer.observe({ type: "layout-shift", buffered: true });
      window.__areaOpenShifts = () => {
        keep(observer.takeRecords());
        return shifts;
      };
    });
    const search = await openMapSearch(page);
    await search.fill("Clapham");
    await expect(
      page.getByRole("group", { name: "Areas", exact: true }).getByRole("option", { name: "Clapham", exact: true }),
    ).toBeVisible({ timeout: 20_000 });

    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/_next\/static\/chunks\/.+\.js(?:\?|$)/, async (route) => {
      await released;
      await route.fallback();
    });
    const enteredAt = await page.evaluate(() => performance.now());
    await search.press("Enter");

    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="area"] .mobileSharedSheet');
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(sheet).not.toHaveClass(/sheet-entering/);
    const resting = await sheet.boundingBox();
    expect(resting, "the area sheet has a box while its body loads").not.toBeNull();

    release();
    await expect(sheet.getByRole("heading", { name: "Cheapest pints in Clapham" })).toBeVisible({
      timeout: 20_000,
    });
    // One frame after the body paints, any shift it caused has been scored.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    expect(await sheet.boundingBox(), "the body lands inside the box the sheet opened at").toEqual(resting);
    const shifts = await page.evaluate(() => window.__areaOpenShifts?.() ?? []);
    const total = shifts
      .filter((shift) => shift.startTime >= enteredAt)
      .reduce((sum, shift) => sum + shift.value, 0);
    expect(total, "layout shift from Enter until the area sheet's body lands").toBeLessThan(0.01);
  });
});
