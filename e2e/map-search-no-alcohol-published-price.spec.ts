import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapToolbarReady, mapToolbar } from "./helpers/mapToolbar";

type PublishedQuote = {
  venueId: string;
  category: string;
  priceGbp: number;
  standing?: string;
  sourceUrl: string;
  observedAt: string;
  servingSize?: string | null;
};

const publicPrices = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as PublishedQuote[];
const ploughSourceUrl = "https://www.theploughstjohnshill.co.uk/the-bar/";
const ploughId = "venue-13xdb1p";

test.use({
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

test("No alcohol search retains an owned published soft-drink quote when Pubs are hidden", async ({ page }, info) => {
  test.setTimeout(90_000);
  const quote = publicPrices.find((row) => row.venueId === ploughId
    && row.category === "soft-drink" && row.standing === "listed"
    && row.priceGbp === 4.35 && row.sourceUrl === ploughSourceUrl);
  expect(quote, "The Plough's official soft-drink row must remain in the committed publisher bundle").toBeDefined();
  expect(quote!.observedAt).toBe("2026-09-21T18:27:31.674Z");
  expect(quote!.servingSize?.trim() || null).toBeNull();
  // Read the real publisher index to prove this amount, category and date are
  // available to the app. This read supplies no response or component props.
  const publisherIndex = await page.request.get("/api/price-submit?drinkCategory=soft-drink");
  expect(publisherIndex.status()).toBe(200);
  const published = await publisherIndex.json() as { listedPrices: PublishedQuote[] };
  expect(published.listedPrices.some((row) => row.venueId === ploughId
    && row.category === "soft-drink" && row.priceGbp === 4.35
    && row.sourceUrl === ploughSourceUrl && row.observedAt === quote!.observedAt
    && (row.servingSize?.trim() || null) === null)).toBe(true);

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
  const indexResponse = page.waitForResponse((response) => response.request().method() === "GET"
    && new URL(response.url()).pathname === "/api/price-submit"
    && new URL(response.url()).searchParams.get("lens") === "no-alcohol");
  const noAlcohol = filters.getByRole("group", { name: "Map view" })
    .getByRole("button", { name: "No alcohol", exact: true });
  await noAlcohol.click();
  await expect(noAlcohol).toHaveAttribute("aria-pressed", "true");
  expect((await indexResponse).status()).toBe(200);
  const pubs = filters.getByRole("group", { name: "Venue types" })
    .getByRole("button", { name: "Pubs", exact: true });
  await expect(pubs).toHaveAttribute("aria-pressed", "true");
  await pubs.click();
  await expect(pubs).toHaveAttribute("aria-pressed", "false");
  await filterButton.click();
  await expect(filters).toHaveCount(0);

  await toolbar.getByRole("combobox", { name: "Search places" }).fill("The Plough");
  const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  const option = listbox.getByRole("group", { name: "Venues", exact: true })
    .locator(`[role="option"][data-venue-id="${ploughId}"]`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  await expect(option.locator(".mapSearchSuggestRowName")).toHaveText("The Plough");
  await expect(option.locator(".mapSearchSuggestPrice"))
    .toHaveText("Soft drinks · £4.35 · Serving not recorded");
  await expect(option).not.toContainText("£6.10");
  await expect(option).not.toContainText("330ml");
  await info.attach("no-alcohol-search-hidden-pub-published-quote", {
    contentType: "image/png", body: await page.screenshot(),
  });
  await option.click();
  await expect(page).toHaveURL((url) => url.searchParams.get("sel") === ploughId);
  await expect(page.getByRole("heading", { name: "The Plough", exact: true })).toBeVisible();
  await expect(listbox).toHaveCount(0);
  await page.getByRole("dialog", { name: "Pub detail", exact: true })
    .getByRole("button", { name: "Close pub detail", exact: true }).click();
  await filterButton.click();
  await expect(noAlcohol).toHaveAttribute("aria-pressed", "true");
  await expect(pubs).toHaveAttribute("aria-pressed", "false");
});
