import { expect, test } from "@playwright/test";

import { PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY } from "../lib/planDraft";
import { PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY } from "../lib/planRouteDraft";
import type { SelectedDrinkPriceEvidence } from "../lib/planSelectedDrinkPriceEvidence";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

type GeneratedStop = {
  venueId: string;
  venueName: string;
  selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence;
};

// Real generation and native route controls. Auth and basemap are doubled;
// this does not establish a real provider login or publisher verification.
test.use({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

test("reversed generated Vodka route hands the displayed order to Plan", async ({ page }) => {
  test.setTimeout(120_000);
  await installDeterministicMapBasemap(page);
  await page.addInitScript(({ draftKeys }) => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // Clear once. Map-to-Plan navigation must retain the application's writes.
    if (!sessionStorage.getItem("generated-reverse-transfer-cleared")) {
      for (const key of draftKeys) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
      localStorage.removeItem("pubmax:plan-intake:v1");
      localStorage.removeItem("pubmax_built_ids");
      sessionStorage.setItem("generated-reverse-transfer-cleared", "1");
    }
  }, { draftKeys: [PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY] });
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");

  expect((await page.goto("/map?plan=1&drink=vodka"))?.status()).toBe(200);
  await page.getByRole("textbox", { name: "Describe the outing" }).fill("Vodka in Shoreditch for 2");
  const generation = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans/generate",
  );
  await page.getByRole("button", { name: "Make a plan" }).click();
  const response = await generation;
  const generated = await response.json() as {
    inferredContext?: { nightArea?: string; drinkCategory?: string; zeroProof?: boolean };
    budgetSummary?: { estimatedPerPersonPence?: number | null; estimatedCrewPence?: number | null; basis?: string };
    stops?: GeneratedStop[];
  };
  expect(response.status(), JSON.stringify(generated)).toBe(200);
  expect(generated.inferredContext).toMatchObject({ nightArea: "shoreditch", drinkCategory: "vodka", zeroProof: false });
  expect(generated.budgetSummary).toMatchObject({
    estimatedPerPersonPence: null, estimatedCrewPence: null, basis: "selected-drink-price-unavailable",
  });
  expect(generated.stops?.length).toBeGreaterThanOrEqual(2);
  const stops = generated.stops!;
  const originalIds = stops.map((stop) => stop.venueId);
  const originalNames = stops.map((stop) => stop.venueName);
  expect(new Set(originalIds).size).toBe(stops.length);
  const quotedIndex = stops.findIndex((stop) => stop.selectedDrinkPriceEvidence);
  expect(quotedIndex, "Real generated primary route needs an attributable Vodka quote before exercising Reverse").toBeGreaterThanOrEqual(0);
  const quote = stops[quotedIndex]!.selectedDrinkPriceEvidence!;
  expect(quote.category).toBe("vodka");

  const panel = page.locator(".routePanel:visible");
  await expect(panel).toHaveCount(1);
  const names = panel.locator(".routeList > li > button strong");
  const readNames = () => names.evaluateAll((elements) => elements.map((element) =>
    Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "").join("").trim(),
  ));
  await expect.poll(readNames).toEqual(originalNames);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pubmax_built_ids") ?? "null")))
    .toEqual(originalIds);
  const originalQuote = panel.locator(".routeList > li").nth(quotedIndex).locator("button p");
  await expect(originalQuote).toContainText(`£${(quote.pence / 100).toFixed(2)}`);
  await expect(originalQuote).toContainText(quote.source === "listed" ? "published menu" : "community report");
  const date = new Date(quote.source === "listed" ? quote.observedAt : quote.reportedAt)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  await expect(originalQuote).toContainText(date);
  await expect(originalQuote).toContainText(quote.serving ? `Serving ${quote.serving}.` : "Serving size not recorded.");
  if (quote.source === "listed") {
    await expect(panel.locator(".routeList > li").nth(quotedIndex).getByRole("link", { name: "Menu source", exact: true }))
      .toHaveAttribute("href", quote.sourceUrl);
  }
  await expect(panel.locator(".routeMetrics")).not.toContainText("estimated round");
  await expect(panel.locator(".routeMetrics")).not.toContainText(/pint stops?/i);

  // Exactly one native action. Retrying this toggle could conceal a reversal.
  await panel.getByRole("button", { name: "Reverse route", exact: true }).click();
  const reversedIds = [...originalIds].reverse();
  const reversedNames = [...originalNames].reverse();
  await expect.poll(readNames).toEqual(reversedNames);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pubmax_built_ids") ?? "null")))
    .toEqual(reversedIds);
  await expect(page.getByRole("link", { name: "Open Plan to lock it in", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open Plan to lock it in", exact: true }).click();

  await expect(page).toHaveURL(/\/plan(?:\?|$)/);
  await expect(page.getByRole("combobox", { name: "Drinks", exact: true })).toHaveValue("vodka");
  await expect(page.locator(".planComposer__stop")).toHaveCount(stops.length);
  await expect.poll(() => page.locator(".planComposer__stop").getByRole("combobox", { name: "Venue name", exact: true })
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
    .toEqual(reversedNames);
  // Read the real hydrated form's own draft, rather than trusting only names
  // (two canonical venues can share a name). Never write IDs or a route proof.
  await expect.poll(() => page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { draft?: { stops?: Array<{ venueId: string }> } };
    return envelope.draft?.stops?.map((stop) => stop.venueId) ?? null;
  }, PLAN_DRAFT_V2_KEY)).toEqual(reversedIds);
});
