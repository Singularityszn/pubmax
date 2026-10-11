import { expect, test } from "@playwright/test";

import { paintedAmbientSurfaces } from "./helpers/ambientMapSurfaces";

test.use({ storageState: { cookies: [], origins: [] } });

const desktopCases = [
  {
    width: 800,
    tonightState: "empty",
    tonightBody: { rows: [], asOf: "2026-07-29T18:00:00.000Z" },
  },
  {
    width: 1600,
    tonightState: "degraded",
    tonightBody: { rows: [], error: "Store unavailable" },
  },
] as const;

for (const { width, tonightState, tonightBody } of desktopCases) {
  test(`keeps Near me actionable at ${width}px with consent decided and tour unseen when Tonight is ${tonightState}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "pubmaxx:analytics-consent:v1",
        "denied",
      );
      window.localStorage.removeItem("pubmax-tour-v1-done");
      // The first-visit arrival card owns the location ask while it is up,
      // and the suggest banner this spec drives stands down behind it
      // (mapBannerStaging.css). This spec is about the BANNER's Near me, so
      // the card has already been answered.
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    });
    await page.route("**/api/whats-on**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...tonightBody, servedAt: new Date().toISOString() }),
      }),
    );
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

    await page.setViewportSize({ width, height: 800 });
    const coreVenuesReady = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/data/venues_slim.core.json") &&
        candidate.ok(),
    );
    const response = await page.goto(`/map?near-me-regression=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    await coreVenuesReady;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.waitForTimeout(1_000);
    // The status rail is ELIGIBLE (the stub answers a Central line with severe
    // delays) and it WAITS: the location ask is first in the map's one ambient
    // cascade, because that ask is what the arrival strip is (UI review 17 Sep
    // 2026, finding 5; components/map/mapBannerStaging.css). This spec is about
    // the location ask's own control, so it is the surface that must be up.
    await expect(page.locator(".cityStatusBanner")).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(page.locator(".cityStatusBanner")).toBeHidden();
    await expect(page.locator(".appShell")).not.toHaveClass(/onboarding-open/);
    await expect(page.locator(".mapOnboarding")).toHaveCount(0);
    await expect(page.locator(".tourScrim")).toHaveCount(0);

    const nearMe = page.locator("button.citySuggestBannerSwitch", {
      hasText: "Near me?",
    });
    await expect(nearMe).toHaveCount(1);
    await expect(nearMe).toBeVisible();
    await expect(nearMe).toHaveAccessibleName("Near me?");
    await nearMe.click({ trial: true });
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

    // The prompt owns the map on its own, so there is no second banner to keep
    // eight pixels away from. What is measured instead is the count.
    const painted = await paintedAmbientSurfaces(page);
    expect(painted).toEqual([".citySuggestBanner"]);
  });
}

test("keeps the expanded city-status feed inside an 800px viewport", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem(
      "pubmaxx:analytics-consent:v1",
      "denied",
    );
    // THE FIRST-VISIT ARRIVAL STRIP IS THE FIRST MEMBER OF THE CASCADE, and it
    // is what this spec was missing: while `.mapArrivalCard` is present PubMap
    // never mounts the status rail at all, so the sheet, its rows and their
    // boxes are simply absent (measured at 800x800 on a production build, the
    // stack was not in the document). The spec then read that absence as a
    // geometry failure on the LAST row. Seed the same dismissal the sibling
    // desktop cases above seed (components/map/mapBannerStaging.css rule 1b).
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // The location ask is first in the map's one ambient cascade, so the status
    // rail owns the surface once that ask is answered
    // (components/map/mapBannerStaging.css). This test is about the rail's own
    // expanded geometry, so the ask is already answered.
    window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
  await page.setViewportSize({ width: 800, height: 800 });
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ servedAt: new Date().toISOString(), rows: [] }),
    }),
  );
  await page.route("**/api/citymcp/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-29T18:00:00.000Z",
        weather: null,
        signals: Array.from({ length: 14 }, (_, index) => ({
          headline: `Status item ${index + 1}`,
          detail: "Actionable city detail",
          kind: index % 2 === 0 ? "transport" : "event",
          severity: index === 0 ? "major" : "info",
        })),
        tubeLines: [{ line: "Central", status: "Severe delays" }],
      }),
    }),
  );

  const response = await page.goto("/map?status-sheet-viewport=800", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const statusToggle = page.locator(".cityStatusBannerLink");
  await expect(statusToggle).toBeVisible({ timeout: 20_000 });
  await statusToggle.click();

  const sheet = page.locator(".cityStatusSignalSheet");
  await expect(sheet).toBeVisible();
  // The sheet enters on a transform (cityStatusBanner.css), so its first box is
  // six pixels off its resting one. Measure the surface it settles at.
  await sheet.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  const bounds = await sheet.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.y ?? 800) + (bounds?.height ?? 800)).toBeLessThanOrEqual(784);

  await sheet.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const lastRow = sheet.locator(".cityStatusSignalRow").last();
  // A box inside the budget is not yet a row a reader can SEE, so the row has
  // to intersect the viewport as well as measure inside it.
  await expect(lastRow).toBeInViewport();
  const lastBounds = await lastRow.boundingBox();
  expect(lastBounds).not.toBeNull();
  expect(
    (lastBounds?.y ?? 800) + (lastBounds?.height ?? 800),
  ).toBeLessThanOrEqual(784);
});
