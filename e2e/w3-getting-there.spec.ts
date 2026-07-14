import { expect, test } from "@playwright/test";

const VENUE_ID = "venue-xjf3n0";
const USER_LOCATION = { latitude: 51.6074, longitude: -0.1278 };

test.use({
  geolocation: USER_LOCATION,
  permissions: ["geolocation"],
  viewport: { width: 390, height: 844 },
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

test("shares location once and shows walk, TfL, and origin-aware directions", async ({
  page,
}) => {
  let journeyRequests = 0;
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
  await page.route("**/api/citymcp/journey?**", async (route) => {
    const url = new URL(route.request().url());
    const isVenueJourney = url.searchParams.get("limit") === "3";
    if (isVenueJourney) {
      journeyRequests += 1;
      expect(url.searchParams.get("fromLat")).toBe(String(USER_LOCATION.latitude));
      expect(url.searchParams.get("fromLng")).toBe(String(USER_LOCATION.longitude));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        journeys: isVenueJourney ? [
          {
            durationMinutes: 21,
            legs: [{ mode: "walking" }, { mode: "tube" }],
          },
          {
            durationMinutes: 14,
            legs: [
              { mode: "walking" },
              { mode: "bus" },
              { mode: "walking" },
            ],
          },
        ] : [],
      }),
    });
  });

  const response = await page.goto(`/map?sel=${VENUE_ID}`);
  expect(response?.status()).toBe(200);
  await page.getByRole("tab", { name: "Pub" }).click();

  const shareLocation = page.getByRole("button", {
    name: "Share location for travel times",
  });
  await expect(shareLocation).toBeVisible();
  await shareLocation.click();

  const gettingThere = page.getByRole("region", { name: "Getting there" });
  await expect(gettingThere).toContainText("Walk");
  await expect(gettingThere).toContainText("TfL");
  await expect(gettingThere).toContainText("14 min · walk → bus → walk");
  await expect.poll(() => journeyRequests).toBe(1);

  const maps = gettingThere.getByRole("link", { name: /Open directions/ });
  const href = await maps.getAttribute("href");
  expect(href).toBeTruthy();
  const directions = new URL(href!);
  expect(directions.searchParams.get("origin")).toBe(
    `${USER_LOCATION.latitude},${USER_LOCATION.longitude}`,
  );
});
