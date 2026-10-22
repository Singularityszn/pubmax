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
  drinkLabel?: string | null;
  servingSize?: string | null;
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

// Four journeys retain their Shoreditch source anchors. Gin requires the
// Albion's named offer inside Hammersmith's existing radius and cannot pass
// until the official harvest and builder publish that captured menu reading.
const journeys = [
  { category: "whisky", label: "Whisky", noun: "whisky", query: "Whisky in Shoreditch for 2", nightArea: "shoreditch", anchor: "venue-ndc1rt" },
  { category: "gin", label: "Gin", noun: "gin", query: "Gin in Hammersmith for 2", nightArea: "hammersmith", anchor: "venue-1qge8u" },
  { category: "vodka", label: "Vodka", noun: "vodka", query: "Vodka in Shoreditch for 2", nightArea: "shoreditch", anchor: "venue-t3ii33" },
  { category: "rum", label: "Rum", noun: "rum", query: "Rum in Shoreditch for 2", nightArea: "shoreditch", anchor: "venue-ndc1rt" },
  { category: "shot", label: "Shots", noun: "shot", query: "Shots in Shoreditch for 2", nightArea: "shoreditch", anchor: "venue-ndc1rt" },
] as const satisfies ReadonlyArray<{
  category: Category;
  label: string;
  noun: string;
  query: string;
  nightArea: "shoreditch" | "hammersmith";
  anchor: string;
}>;

// Publisher PDF captured through the permission-checked official reader.
// The observation date is read from the committed row, never supplied here.
const albionGinSourceUrl = "https://www.thealbionpub.com/uploads/drink.pdf?v=1772220206";

const aliasDocument = JSON.parse(readFileSync("public/data/venue_id_aliases.json", "utf8")) as {
  aliases: Record<string, string>;
};
function canonicalVenueId(id: string): string {
  return aliasDocument.aliases[id] ?? id;
}

const committedPrices = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as Array<
  ListedQuote & { standing: string; servingSize?: string | null }
>;

function committedMatch(candidate: RouteCandidate, evidence: ListedEvidence): boolean {
  return committedPrices.some((row) =>
    canonicalVenueId(row.venueId) === canonicalVenueId(candidate.venueId)
    && row.category === evidence.category
    && row.standing === "listed"
    && Math.round(row.priceGbp * 100) === evidence.pence
    && (row.servingSize?.trim() || null) === evidence.serving
    && row.sourceUrl === evidence.sourceUrl
    && row.observedAt === evidence.observedAt,
  );
}

function communityMatch(candidate: RouteCandidate, evidence: CommunityEvidence, prices: CommunityPrice[]): boolean {
  return prices.some((price) => {
    if (canonicalVenueId(price.venueId) !== canonicalVenueId(candidate.venueId) || price.drinkCategory !== evidence.category) return false;
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
    const ginSource = journey.category === "gin" ? committedPrices.find((row) =>
      canonicalVenueId(row.venueId) === canonicalVenueId(journey.anchor)
      && row.category === "gin" && row.standing === "listed"
      && Math.round(row.priceGbp * 100) === 400 && row.drinkLabel === "GORDONS"
      && row.servingSize === "25ml" && row.sourceUrl === albionGinSourceUrl,
    ) : undefined;
    if (journey.category === "gin") {
      expect(ginSource, "Official bundle must retain the captured Albion GORDONS £4.00 / 25ml offer").toBeDefined();
      expect(index.listedPrices.some((row) =>
        canonicalVenueId(row.venueId) === canonicalVenueId(journey.anchor)
        && row.category === "gin" && Math.round(row.priceGbp * 100) === 400
        && row.drinkLabel === "GORDONS" && row.servingSize === "25ml"
        && row.sourceUrl === albionGinSourceUrl && row.observedAt === ginSource?.observedAt,
      ), "Map Gin index must preserve the exact committed named offer and its real observation date").toBe(true);
    }

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
      nightArea: journey.nightArea, drinkCategory: journey.category, zeroProof: false,
    });
    expect(generated.stops?.length).toBeGreaterThan(0);
    // The generated non-beer route has no comparable serving/budget. Its
    // generic Map summary must not replace that with a default pint bill.
    await expect(page.locator(".routePanel .routeList > li")).toHaveCount(generated.stops!.length);
    const generatedRouteMetrics = page.locator(".routePanel .routeMetrics");
    await expect(generatedRouteMetrics).toBeVisible();
    await expect(generatedRouteMetrics).not.toContainText(/estimated round/i);
    await expect(generatedRouteMetrics).not.toContainText(/\bpint stops?\b/i);
    const candidates = generated.stops!.flatMap((stop) => [stop, ...(stop.alternatives ?? [])]);
    const quoted = candidates.filter((candidate) => candidate.selectedDrinkPriceEvidence);
    expect(quoted.length, `The ${journey.nightArea} route should surface a ${journey.category} attributable quote`).toBeGreaterThan(0);
    expect(generated.stops!.some((stop) => stop.selectedDrinkPriceEvidence),
      `The ${journey.nightArea} primary route should show a ${journey.category} quote`).toBe(true);
    if (journey.category === "gin") {
      expect(generated.stops!.some((stop) => {
        const evidence = stop.selectedDrinkPriceEvidence;
        return canonicalVenueId(stop.venueId) === canonicalVenueId(journey.anchor)
          && evidence?.source === "listed" && evidence.category === "gin"
          && evidence.pence === 400 && evidence.serving === "25ml"
          && evidence.sourceUrl === albionGinSourceUrl
          && evidence.observedAt === ginSource?.observedAt;
      }), "Hammersmith primary route must deliver the committed Albion GORDONS quote").toBe(true);
    }
    for (const candidate of quoted) {
      const evidence = candidate.selectedDrinkPriceEvidence!;
      expect(evidence).toMatchObject({ category: journey.category });
      if (evidence.source === "listed") {
        expect(committedMatch(candidate, evidence), "Exact canonical venue, category, pence, source, date and source-stated serving must match the committed menu").toBe(true);
      } else {
        expect(evidence.serving).toBeNull();
        expect(communityMatch(candidate, evidence, index.prices)).toBe(true);
      }
    }
    await expect(page.getByRole("link", { name: "Open Plan to lock it in" })).toBeVisible();
    await page.getByRole("link", { name: "Open Plan to lock it in" }).click();
    await expect(page).toHaveURL(/\/plan(?:\?|$)/);
    await expect(page.getByRole("combobox", { name: "Drinks", exact: true })).toHaveValue(journey.category);
    await expect(page.locator(".planComposer__stop")).toHaveCount(generated.stops!.length);
    for (const [index, stop] of generated.stops!.entries()) {
      const evidence = stop.selectedDrinkPriceEvidence;
      const displayedQuote = page.locator(".planComposer__stop").nth(index).locator(".planComposer__stopReason").filter({
        hasText: /(?:published menu|community report)/,
      });
      if (!evidence) {
        await expect(displayedQuote).toHaveCount(0);
        continue;
      }
      const reported = new Date(evidence.source === "listed" ? evidence.observedAt : evidence.reportedAt)
        .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      await expect(displayedQuote).toHaveCount(1);
      await expect(displayedQuote).toContainText(`£${(evidence.pence / 100).toFixed(2)}`);
      await expect(displayedQuote).toContainText(evidence.source === "listed" ? "published menu" : "community report");
      await expect(displayedQuote).toContainText(reported);
      await expect(displayedQuote).toContainText(evidence.serving ? `Serving ${evidence.serving}.` : "Serving size not recorded.");
    }
  });
}
