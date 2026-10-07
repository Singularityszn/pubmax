import { expect, test } from "@playwright/test";

const PHONE = { width: 393, height: 852 };

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: PHONE,
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

test("area picks clear the text filter before priced pins paint", async ({ page }) => {
  test.setTimeout(120_000);
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

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  const searchToggle = page.getByRole("button", { name: "Search the map" });
  await expect(async () => {
    if (!(await page.getByRole("combobox", { name: "Search pubs" }).count())) {
      await searchToggle.click();
    }
    await expect(page.getByRole("combobox", { name: "Search pubs" })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 20_000 });

  const search = page.getByRole("combobox", { name: "Search pubs" });
  await search.fill("White");
  const whitechapel = page.getByRole("option", { name: /Whitechapel/i }).first();
  await expect(whitechapel).toBeVisible({ timeout: 20_000 });
  await whitechapel.click();

  await expect(page).toHaveURL((url) => url.searchParams.get("q") === null);
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
