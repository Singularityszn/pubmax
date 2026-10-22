import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapToolbarReady, mapToolbar } from "./helpers/mapToolbar";

const publicVenues = JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")) as {
  rows: Array<{
    id: string;
    name: string;
    kind?: string;
    cheapestPrice?: number;
    anchorLabel?: string;
    anchorObservedAt?: string;
    anchorSourceUrl?: string;
  }>;
};

test.use({
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

test("Food search retains a published meal quote when Restaurants are hidden", async ({ page }, info) => {
  test.setTimeout(90_000);
  // A committed publisher anchor is the expectation, not a price response
  // double or a correctly wired map handed directly to the search helper.
  const rules = publicVenues.rows.find((venue) => venue.id === "restaurant-rules");
  expect(rules).toMatchObject({
    id: "restaurant-rules",
    name: "Rules",
    kind: "restaurant",
    cheapestPrice: 26.25,
    anchorLabel: "Steak & Kidney Pudding",
    anchorObservedAt: "2026-08-25",
    anchorSourceUrl: "https://rules.co.uk/our-menus",
  });
  await page.setViewportSize({ width: 1440, height: 984 });
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });

  expect((await page.goto("/map"))?.status()).toBe(200);
  await expectMapToolbarReady(page);
  const toolbar = mapToolbar(page);
  const filterButton = toolbar.getByRole("button", { name: /^Filters/ });
  const filters = page.getByRole("dialog", { name: "Filters", exact: true });
  await expect(async () => {
    if (!(await filters.isVisible())) await filterButton.click();
    await expect(filters).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const food = filters.getByRole("group", { name: "Map view" })
    .getByRole("button", { name: "Food", exact: true });
  await food.click();
  await expect(food).toHaveAttribute("aria-pressed", "true");
  const restaurants = filters.getByRole("group", { name: "Venue types" })
    .getByRole("button", { name: "Restaurants", exact: true });
  await expect(restaurants).toHaveAttribute("aria-pressed", "true");
  await restaurants.click();
  await expect(restaurants).toHaveAttribute("aria-pressed", "false");
  await filterButton.click();
  await expect(filters).toHaveCount(0);

  await toolbar.getByRole("combobox", { name: "Search places" }).fill("Rules");
  const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  const option = listbox.getByRole("group", { name: "Venues", exact: true })
    .locator('[role="option"][data-venue-id="restaurant-rules"]');
  await expect(option).toBeVisible({ timeout: 30_000 });
  await expect(option.locator(".mapSearchSuggestRowName")).toHaveText("Rules");
  await expect(option.locator(".mapSearchSuggestPrice > span"))
    .toHaveText("Steak & Kidney Pudding · £26.25");
  const observed = new Date(rules!.anchorObservedAt!);
  const month = observed.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const observedLabel = observed.getUTCFullYear() === new Date().getUTCFullYear()
    ? month : `${month} ${observed.getUTCFullYear()}`;
  await expect(option.locator(".mapSearchSuggestPriceProvenance"))
    .toHaveText(`${observedLabel} · rules.co.uk`);
  await expect(option).not.toContainText("No meal price logged");
  await info.attach("food-search-hidden-restaurant-published-quote", {
    contentType: "image/png", body: await page.screenshot(),
  });
  await option.click();
  await expect(page).toHaveURL((url) => url.searchParams.get("sel") === "restaurant-rules");
  await expect(page.getByRole("heading", { name: "Rules", exact: true })).toBeVisible();
  await expect(listbox).toHaveCount(0);
  await page.getByRole("dialog", { name: "Restaurant detail", exact: true })
    .getByRole("button", { name: "Close restaurant detail", exact: true }).click();
  await filterButton.click();
  await expect(food).toHaveAttribute("aria-pressed", "true");
  await expect(restaurants).toHaveAttribute("aria-pressed", "false");
});
