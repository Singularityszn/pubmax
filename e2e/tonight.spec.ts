import { test, expect, type Page } from "@playwright/test";

// First-class /tonight screen E2E. WebGL-agnostic. Fed by the PRIMARY What's-On
// spine (/api/whats-on) — same source as the map Tonight lane. Tolerant of a
// quiet upstream: always assert mount + heading; only exercise filter → map
// deep-link when rows actually returned.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
});

test("the /tonight screen mounts with an honest header and provenance", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/tonight");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("tonight-screen")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /what.?s on near you/i }),
  ).toBeVisible();

  // The screen resolves to exactly one of: list, empty, error status. Wait for
  // the loading status to clear into one of those terminal states.
  await expect(page.getByText("Reading tonight’s listings…")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.locator(".tonightStatus, .tonightList")).toHaveCount(1, {
    timeout: 10_000,
  });

  expect(errors).toEqual([]);
});

test("filtering by kind narrows the list and rows tap into a venue", async ({
  page,
}) => {
  await page.goto("/tonight");
  await expect(page.getByTestId("tonight-screen")).toBeVisible();

  const list = page.getByTestId("tonight-list");
  // Tolerate a quiet dataset: if no list rendered (empty/error/thin), there is
  // nothing to filter — the mount test already covered the honest fallback.
  if ((await list.count()) === 0) {
    test.info().annotations.push({
      type: "note",
      description: "Upstream returned no tonight rows — filter flow skipped.",
    });
    return;
  }

  const rows = page.getByTestId("tonight-row");
  const totalRows = await rows.count();
  expect(totalRows).toBeGreaterThan(0);

  // If a kind filter chip is present (needs >1 distinct kind), clicking it must
  // not grow the visible set.
  const chips = page.locator(".tonightChip[aria-pressed='false']");
  if ((await chips.count()) > 0) {
    await chips.first().click();
    await expect(rows).not.toHaveCount(0); // an active chip always has ≥1 row
    expect(await rows.count()).toBeLessThanOrEqual(totalRows);
    // Reset to All.
    await page.locator(".tonightChip", { hasText: /^All/ }).click();
    await expect(rows).toHaveCount(totalRows);
  }

  // The first row that links into the map is a real navigation target.
  const mapLink = page.locator(".tonightRowLink[href^='/map']").first();
  if ((await mapLink.count()) > 0) {
    const href = await mapLink.getAttribute("href");
    expect(href).toMatch(/^\/map\?sel=/);
  }
});

test("location is opt-in, removable, and only used for local walk times", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__tonightLocationRequests", {
      value: 0,
      writable: true,
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          const testWindow = window as Window & { __tonightLocationRequests: number };
          testWindow.__tonightLocationRequests += 1;
          success({
            coords: {
              latitude: 51.5074,
              longitude: -0.1278,
              accuracy: 20,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-15T18:00:00.000Z",
        rows: [
          {
            id: "quiz-1",
            venueId: "venue-xjf3n0",
            placeName: "The Test Arms",
            kind: "quiz",
            startsAt: "2026-07-15T20:00:00.000Z",
            title: "Quiz night",
            source: { label: "Pub listing", url: "https://example.com/quiz" },
            observedAt: "2026-07-14T18:00:00.000Z",
            confidence: "listed",
            lat: 51.51,
            lng: -0.13,
          },
        ],
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(page.getByTestId("tonight-list")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as Window & { __tonightLocationRequests: number })
        .__tonightLocationRequests,
    ),
  ).toBe(0);
  await expect(page.getByTestId("tonight-row")).not.toContainText("min walk");

  await page
    .getByRole("button", { name: "Share location for walk times" })
    .click();
  expect(
    await page.evaluate(() =>
      (window as Window & { __tonightLocationRequests: number })
        .__tonightLocationRequests,
    ),
  ).toBe(1);
  await expect(page.getByTestId("tonight-row")).toContainText("min walk");

  await page.getByRole("button", { name: "Remove location" }).click();
  await expect(page.getByTestId("tonight-row")).not.toContainText("min walk");
});

test("a failed listings request can be retried", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/whats-on?**", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rows: [], error: "Store unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [], asOf: "2026-07-15T18:00:00.000Z" }),
    });
  });

  await page.goto("/tonight");
  await page.getByRole("button", { name: "Retry listings" }).click();
  await expect(page.getByText(/Nothing confirmed in London tonight yet/)).toBeVisible();
  expect(requests).toBe(2);
});

test("mobile keeps Pubs as a root tab and reaches Tonight from Pint stories", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/discover");

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("link", { name: "Pubs" })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Tonight" })).toHaveCount(0);

  await page.getByRole("link", { name: "What’s on tonight →" }).click();
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByTestId("tonight-screen")).toBeVisible();
});
