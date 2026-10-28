import { expect, test } from "@playwright/test";

import {
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "./helpers/communitySheetFixture";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { mobileMapShellControl } from "./helpers/mobileMapShell";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  serviceWorkers: "block",
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

const VENUE_ID = COMMUNITY_SHEET_FIXTURE_VENUE_ID;
const LOCATION = { latitude: 51.517, longitude: -0.12 };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Control the external venue payload, without replacing the mounted map's filter pipeline. */
function withoutLegacyAmenities(row: unknown): unknown {
  if (!record(row) || row.id !== VENUE_ID) return row;
  const hints = record(row.filterHints) ? row.filterHints : {};
  return {
    ...row,
    amenities: { ...(record(row.amenities) ? row.amenities : {}), nonAlcoholic: false, food: false },
    filterHints: {
      ...hints,
      amenities: { ...(record(hints.amenities) ? hints.amenities : {}), nonAlcoholic: false, food: false },
    },
  };
}

for (const requireFood of [false, true]) {
  test(requireFood
    ? "nearby prices preserve a real food constraint when drink evidence overrides a legacy flag"
    : "the mounted map retains a trusted soft-drink price without a legacy non-alcohol amenity", async ({ page, context }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    const blockedWrites: string[] = [];
    let fixtureRowsServed = 0;
    let categoryReadServed = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(LOCATION);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });
    await installDeterministicMapBasemap(page);
    await page.route("**/api/**", async (route) => {
      if (!["GET", "HEAD"].includes(route.request().method())) {
        blockedWrites.push(new URL(route.request().url()).pathname);
        await route.abort("blockedbyclient");
        return;
      }
      await route.fallback();
    });
    await page.route("**/api/price-submit**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const url = new URL(route.request().url());
      const forVenue = url.searchParams.get("venueId");
      categoryReadServed ||= !forVenue;
      await route.fulfill({ json: {
        prices: forVenue && forVenue !== VENUE_ID ? [] : [{
          venueId: VENUE_ID,
          drinkCategory: "soft-drink",
          priceGbp: 2.8,
          submittedAt: Date.now() - 60_000,
          source: "community",
          corroborations: 2,
        }],
        signals: [],
        truncated: false,
      } });
    });
    await page.route("**/data/**", async (route) => {
      if (!new URL(route.request().url()).pathname.endsWith(".json")) {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const payload: unknown = await response.json();
      const rows = Array.isArray(payload) ? payload : record(payload) && Array.isArray(payload.rows) ? payload.rows : null;
      if (!rows || !rows.some((row) => record(row) && row.id === VENUE_ID)) {
        await route.fulfill({ response });
        return;
      }
      fixtureRowsServed += 1;
      const updated = rows.map(withoutLegacyAmenities);
      await route.fulfill({ response, json: Array.isArray(payload) ? updated : { ...payload as Record<string, unknown>, rows: updated } });
    });

    await page.goto(`/map?low=1&drink=soft-drink${requireFood ? "&food=1" : ""}`);
    await expect.poll(() => fixtureRowsServed, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => categoryReadServed, { timeout: 30_000 }).toBe(true);
    const nearMe = await mobileMapShellControl(page, "nearMe", 30_000);
    await nearMe.tap();
    const answer = page.getByRole("region", { name: "Nearby pub matches" });
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await testInfo.attach("mounted-nearby-price-membership", { body: await page.screenshot(), contentType: "image/png" });

    const target = answer.locator(`[data-venue-id="${VENUE_ID}"]`);
    if (requireFood) {
      await expect(target).toHaveCount(0);
      await expect(answer).toContainText("No priced pub matches these choices within 2.5 km.");
    } else {
      await expect(target).toBeVisible();
      await expect(target).toContainText(COMMUNITY_SHEET_FIXTURE_VENUE_NAME);
      await expect(target).toContainText("£2.80");
      await expect(target).toContainText("Soft drinks");
      await expect(target).toContainText("Serving size not recorded");
    }
    expect(blockedWrites).toEqual([]);
    expect(errors).toEqual([]);
  });
}
