import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("keeps Near me painted when desktop city status arrives", async ({ page }) => {
  await page.route("**/api/citymcp/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-29T18:00:00.000Z",
        weather: null,
        signals: [],
        tubeLines: [{ line: "Central", status: "Severe delays" }],
      }),
    }),
  );

  for (const width of [800, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(`/map?near-me-regression=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    await expect(page.locator(".cityStatusBanner")).toBeVisible({
      timeout: 20_000,
    });

    const nearMe = page.locator("button.citySuggestBannerSwitch", {
      hasText: "Near me?",
    });
    await expect(nearMe).toHaveCount(1);
    await expect(nearMe).toBeVisible();
    await expect(nearMe).toHaveAccessibleName("Near me?");
    await expect
      .poll(() =>
        page.evaluate(() =>
          navigator.permissions
            .query({ name: "geolocation" })
            .then((permission) => permission.state),
        ),
      )
      .toBe("prompt");

    await expect
      .poll(async () => (await nearMe.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    const bounds = await nearMe.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? width) + (bounds?.width ?? width)).toBeLessThanOrEqual(
      width,
    );
  }
});
