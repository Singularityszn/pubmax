import { expect, test } from "@playwright/test";

import { selectFirstToolbarVenue, expectMapToolbarReady } from "../helpers/mapToolbar";
import { asReturningVisitor, evidence, expectPaintedPins, watchPageErrors } from "./smokeSession";

// The read-only half of the production smoke suite. Every journey here only
// reads, so it runs with or without the smoke account.

// The Admiralty carries copied Google Places hours and address
// (data/places_enrichment.json), so its sheet proves the enrichment reached
// production. The Arnos Arms is the search target: one unambiguous name.
const PLACES_VENUE = { id: "venue-1t2cfa2", name: "The Admiralty", postcode: "WC2N 5DS" };
const SEARCH_VENUE = "Arnos Arms";
// Crosstown is a hand-checked row of the Shoreditch coffee pilot
// (data/coffee_pilot/shoreditch.json).
const COFFEE_CAFE = { id: "venue-osm-w271641406", name: "Crosstown" };

test.beforeEach(async ({ context }) => {
  await asReturningVisitor(context);
});

test("landing page loads with its hero and a way onto the map", async ({ page }) => {
  const assertNoPageErrors = watchPageErrors(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "What a pint costs, pub by pub.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the map", exact: true })).toHaveAttribute(
    "href",
    "/map",
  );
  await evidence(page, "landing");
  assertNoPageErrors();
});

for (const city of [
  { path: "/map", name: "London" },
  { path: "/map/manchester", name: "Manchester" },
]) {
  test(`${city.name} map paints pins`, async ({ page }) => {
    const assertNoPageErrors = watchPageErrors(page);
    const response = await page.goto(city.path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(new RegExp(city.name));
    await expectPaintedPins(page);
    await evidence(page, `map-${city.name.toLowerCase()}`);
    assertNoPageErrors();
  });
}

test("searching a pub opens its sheet", async ({ page }) => {
  const assertNoPageErrors = watchPageErrors(page);
  await page.goto("/map");
  await expectMapToolbarReady(page);
  await selectFirstToolbarVenue(page, SEARCH_VENUE);
  const sheet = page.getByRole("dialog", { name: "Pub detail" });
  await expect(sheet).toBeVisible();
  // The drawer slides in after it mounts, so visible is not yet on screen.
  await expect(sheet.getByRole("heading", { name: SEARCH_VENUE })).toBeInViewport();
  await evidence(page, "search-sheet");
  assertNoPageErrors();
});

test("a venue sheet shows Google Places hours and address", async ({ page }) => {
  const assertNoPageErrors = watchPageErrors(page);
  await page.goto(`/map?sel=${PLACES_VENUE.id}`);
  const sheet = page.getByRole("dialog", { name: "Pub detail" });
  await expect(sheet.getByRole("heading", { name: PLACES_VENUE.name })).toBeInViewport();
  await expect(sheet.locator(".venueAddress")).toContainText(PLACES_VENUE.postcode);
  await sheet.getByText("Details and practical info").click();
  const places = sheet.locator(".venuePlacesDetails");
  await expect(places).toBeVisible();
  await places.getByText("Opening hours", { exact: true }).click();
  await expect(places.locator("dt").first()).toHaveText("Monday");
  await expect(places.locator("dd").first()).toHaveText(/\d{2}:\d{2} to \d{2}:\d{2}|Closed/);
  await places.locator("dl").scrollIntoViewIfNeeded();
  await expect(places.getByText(/Google Places · Checked/).first()).toBeVisible();
  await evidence(page, "places-hours");
  assertNoPageErrors();
});

test("the coffee lens shows a cafe's listed prices", async ({ page }) => {
  const assertNoPageErrors = watchPageErrors(page);
  await page.goto(`/map?drink=coffee&sel=${COFFEE_CAFE.id}`);
  const cafe = page.locator(`.coffeePilot[data-coffee-pilot-cafe="${COFFEE_CAFE.id}"]`);
  await expect(cafe.locator(".coffeePilotName")).toBeInViewport();
  await expect(cafe.locator(".coffeePilotName")).toHaveText(COFFEE_CAFE.name);
  await expect(cafe.locator(".coffeePilotPrice").first()).toContainText("£");
  await expect(page).toHaveURL(/[?&]drink=coffee/);
  await evidence(page, "coffee-lens");
  assertNoPageErrors();
});
