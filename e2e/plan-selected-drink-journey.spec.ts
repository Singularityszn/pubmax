import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";

type ListedEvidence = {
  category: string;
  pence: number;
  serving: string | null;
  source: "listed";
  sourceUrl: string;
  observedAt: string;
};

type JourneyStop = { venueId: string; selectedDrinkPriceEvidence?: ListedEvidence | null };

const committedPrices = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as Array<{
  venueId: string;
  category: string;
  priceGbp: number;
  standing: string;
  sourceUrl: string | null;
  observedAt: string;
}>;

for (const journey of [
  { category: "wine", query: "wine in Shoreditch for 2", name: "Wine Browser" },
  { category: "cocktail", query: "cocktails in Shoreditch for 2", name: "Cocktail Browser" },
] as const) {
  test(`${journey.category} intent carries a committed listing through browser preview, save, and reload`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
      localStorage.removeItem("pubmax:plan-intake:v1");
      localStorage.removeItem("pubmaxx:plan-route-draft:v1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.removeItem("pubmax:plan-draft:v1");
    });

    expect((await page.goto("/plan"))?.status()).toBe(200);
    await describeFirstQuery(page).fill(journey.query);
    const generation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans/generate");
    await describeFirstSubmit(page).click();
    const generatedResponse = await generation;
    const generated = await generatedResponse.json() as {
      inferredContext?: { nightArea?: string; drinkCategory?: string; zeroProof?: boolean };
      stops?: JourneyStop[];
    };
    expect(generatedResponse.status(), JSON.stringify(generated)).toBe(200);
    expect(generated.inferredContext).toMatchObject({ nightArea: "shoreditch", drinkCategory: journey.category, zeroProof: false });
    expect(generated.stops?.length).toBeGreaterThan(0);
    const listedStops = generated.stops!.filter((stop) => stop.selectedDrinkPriceEvidence?.source === "listed");
    expect(listedStops.length).toBeGreaterThan(0);
    for (const stop of listedStops) {
      const evidence = stop.selectedDrinkPriceEvidence!;
      expect(evidence).toMatchObject({ category: journey.category, serving: null, source: "listed" });
      expect(committedPrices.some((row) => row.venueId === stop.venueId
        && row.category === journey.category && row.standing === "listed"
        && Math.round(row.priceGbp * 100) === evidence.pence
        && row.sourceUrl === evidence.sourceUrl && row.observedAt === evidence.observedAt)).toBe(true);
    }
    await expect(page.getByLabel("Drinks")).toHaveValue(journey.category);
    await expect(page.locator(".planComposer__stop")).toHaveCount(generated.stops!.length);
    await expect(page.locator(".planComposer__stopReason").filter({ hasText: "community report" })).toHaveCount(0);
    await expect(page.locator(".planComposer__stopReason").filter({ hasText: "published menu" })).toHaveCount(listedStops.length);
    await page.locator(".planComposer__stop").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-preview.png`), animations: "disabled" });

    await page.getByLabel("Your name").fill(journey.name);
    const creation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans");
    await page.getByRole("button", { name: "Lock it in" }).click();
    const createdResponse = await creation;
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json() as {
      plan?: { context?: { drinkCategory?: string }; stops?: JourneyStop[] };
    };
    expect(created.plan?.context?.drinkCategory).toBe(journey.category);
    expect(created.plan?.stops).toHaveLength(generated.stops!.length);
    expect(created.plan?.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null))
      .toEqual(generated.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null));
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);

    const planId = new URL(page.url()).pathname.split("/").pop();
    await page.reload();
    await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();
    const read = await page.evaluate(async (id) => {
      const response = await fetch(`/api/plans/${id}`, { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    }, planId);
    expect(read.status).toBe(200);
    const reloaded = read.body as { context?: { drinkCategory?: string }; stops?: JourneyStop[] };
    expect(reloaded.context?.drinkCategory).toBe(journey.category);
    expect(reloaded.stops).toHaveLength(generated.stops!.length);
    expect(reloaded.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null))
      .toEqual(generated.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null));
    await expect(page.locator(".planRoute")).not.toContainText("community report");
    await expect(page.locator(".planRoute")).toContainText("published menu");
    await page.locator(".planRoute").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-reloaded.png`), animations: "disabled" });
  });
}
