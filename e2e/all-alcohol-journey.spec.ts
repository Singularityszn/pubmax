import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { drivesMap, mapCandidateOf, type CommunityPrice } from "../lib/communityPrice";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

type Category = "whisky" | "gin" | "vodka" | "rum" | "shot";
type ListedQuote = {
  venueId: string;
  category: string;
  priceGbp: number;
  sourceUrl: string;
  observedAt: string;
};
type ListedEvidence = {
  category: string;
  pence: number;
  serving: string | null;
  source: "listed";
  sourceUrl: string;
  observedAt: string;
};
type CommunityEvidence = {
  category: string;
  pence: number;
  serving: null;
  source: "community";
  reportedAt: string;
};
type Evidence = ListedEvidence | CommunityEvidence;
type RouteCandidate = {
  venueId: string;
  selectedDrinkPriceEvidence?: Evidence | null;
};
type RouteStop = RouteCandidate & { alternatives?: RouteCandidate[] };

// These two pubs are inside Shoreditch Night Area's 1.6 km radius and carry
// current published-menu rows in the committed bundle. They are evidence
// anchors, not hard-coded price expectations.
const journeys = [
  { category: "whisky", label: "Whisky", noun: "whisky", query: "Whisky in Shoreditch for 2", anchor: "venue-ndc1rt" },
  { category: "gin", label: "Gin", noun: "gin", query: "Gin in Shoreditch for 2", anchor: "venue-ndc1rt" },
  { category: "vodka", label: "Vodka", noun: "vodka", query: "Vodka in Shoreditch for 2", anchor: "venue-t3ii33" },
  { category: "rum", label: "Rum", noun: "rum", query: "Rum in Shoreditch for 2", anchor: "venue-ndc1rt" },
  { category: "shot", label: "Shots", noun: "shot", query: "Shots in Shoreditch for 2", anchor: "venue-ndc1rt" },
] as const satisfies ReadonlyArray<{
  category: Category;
  label: string;
  noun: string;
  query: string;
  anchor: string;
}>;

const committedPrices = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as Array<
  ListedQuote & { standing: string; servingSize?: string | null }
>;

function committedMatch(candidate: RouteCandidate, evidence: ListedEvidence): boolean {
  return committedPrices.some((row) =>
    row.venueId === candidate.venueId
    && row.category === evidence.category
    && row.standing === "listed"
    && Math.round(row.priceGbp * 100) === evidence.pence
    && (row.servingSize ?? null) === evidence.serving
    && row.sourceUrl === evidence.sourceUrl
    && row.observedAt === evidence.observedAt,
  );
}

function communityMatch(candidate: RouteCandidate, evidence: CommunityEvidence, prices: CommunityPrice[]): boolean {
  return prices.some((price) => {
    if (price.venueId !== candidate.venueId || price.drinkCategory !== evidence.category) return false;
    const trusted = mapCandidateOf(price);
    return drivesMap(trusted)
      && Math.round(trusted.priceGbp * 100) === evidence.pence
      && new Date(trusted.submittedAt).toISOString() === evidence.reportedAt;
  });
}

for (const journey of journeys) {
  test(`${journey.label}: Map lane, New category, and Plan quote retain published evidence`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installDeterministicMapBasemap(page);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      // Clear only once: a full Map-to-Plan navigation must keep the generated
      // route draft that Map just handed to Plan.
      if (!sessionStorage.getItem("all-alcohol-journey-cleared")) {
        localStorage.removeItem("pubmax:plan-intake:v1");
        localStorage.removeItem("pubmaxx:plan-route-draft:v1");
        localStorage.removeItem("pubmax:plan-route-draft:v2");
        sessionStorage.removeItem("pubmax:plan-draft:v1");
        sessionStorage.setItem("all-alcohol-journey-cleared", "1");
      }
    });
    // New's price form is account-gated in the production auth environment.
    // Seed a browser session through the suite's GoTrue boundary double before
    // taking Create; never mistake the signed-out gate for a broken category.
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");

    const indexResponse = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/price-submit"
      && new URL(response.url()).searchParams.get("drinkCategory") === journey.category,
    );
    expect((await page.goto(`/map?drink=${journey.category}`))?.status()).toBe(200);
    await expect(page.locator(".mobileMapChrome").getByRole("button", {
      name: `Drink shown on the map: ${journey.label}. Choose another drink`,
    })).toBeVisible();
    const index = await (await indexResponse).json() as {
      listedPrices: ListedQuote[];
      prices: CommunityPrice[];
    };
    expect(index.listedPrices.length).toBeGreaterThan(0);
    expect(index.listedPrices.every((row) => row.category === journey.category)).toBe(true);
    expect(index.listedPrices.some((row) => row.venueId === journey.anchor
      && committedPrices.some((source) => source.venueId === row.venueId
        && source.category === row.category && source.standing === "listed"
        && source.priceGbp === row.priceGbp && source.sourceUrl === row.sourceUrl
        && source.observedAt === row.observedAt))).toBe(true);

    await expect(async () => {
      await page.getByTestId("create-fab").click();
      await expect(page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }))
        .toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
    await expect(page.getByText("Pick a pub to log a price", { exact: true })).toBeVisible({ timeout: 45_000 });
    expect(new URL(page.url()).searchParams.get("drink")).toBe(journey.category);
    await page.locator(".logIntentNearbyBtn").first().click();
    await expect(page.getByRole("textbox", { name: new RegExp(`Price of a ${journey.noun} at`) }))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Sign in to add a price" })).toHaveCount(0);
    await expect(page.getByTestId("spill-price-step")).toHaveCount(0);

    expect((await page.goto(`/map?plan=1&drink=${journey.category}`))?.status()).toBe(200);
    await page.getByRole("textbox", { name: "Describe the outing" }).fill(journey.query);
    const generation = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans/generate",
    );
    await page.getByRole("button", { name: "Make a plan" }).click();
    const generatedResponse = await generation;
    const generated = await generatedResponse.json() as {
      inferredContext?: { nightArea?: string; drinkCategory?: string; zeroProof?: boolean };
      budgetSummary?: { estimatedPerPersonPence?: number | null; estimatedCrewPence?: number | null; basis?: string };
      stops?: RouteStop[];
    };
    expect(generatedResponse.status(), JSON.stringify(generated)).toBe(200);
    expect(generated.budgetSummary).toMatchObject({
      estimatedPerPersonPence: null,
      estimatedCrewPence: null,
      basis: "selected-drink-price-unavailable",
    });
    expect(generated.inferredContext).toMatchObject({
      nightArea: "shoreditch", drinkCategory: journey.category, zeroProof: false,
    });
    expect(generated.stops?.length).toBeGreaterThan(0);
    const candidates = generated.stops!.flatMap((stop) => [stop, ...(stop.alternatives ?? [])]);
    const quoted = candidates.filter((candidate) => candidate.selectedDrinkPriceEvidence);
    expect(quoted.length, `Shoreditch route should surface a ${journey.category} attributable quote`).toBeGreaterThan(0);
    expect(generated.stops!.some((stop) => stop.selectedDrinkPriceEvidence),
      `Shoreditch primary route should show a ${journey.category} quote`).toBe(true);
    for (const candidate of quoted) {
      const evidence = candidate.selectedDrinkPriceEvidence!;
      expect(evidence).toMatchObject({ category: journey.category, serving: null });
      if (evidence.source === "listed") expect(committedMatch(candidate, evidence)).toBe(true);
      else expect(communityMatch(candidate, evidence, index.prices)).toBe(true);
    }
    await expect(page.getByRole("link", { name: "Open Plan to lock it in" })).toBeVisible();
    await page.getByRole("link", { name: "Open Plan to lock it in" }).click();
    await expect(page).toHaveURL(/\/plan(?:\?|$)/);
    await expect(page.getByRole("combobox", { name: "Drinks", exact: true })).toHaveValue(journey.category);
    await expect(page.locator(".planComposer__stopReason").filter({
      hasText: /(?:published menu|community report).*Serving size not recorded/,
    })).toHaveCount(generated.stops!.filter((stop) => stop.selectedDrinkPriceEvidence).length);
  });
}
