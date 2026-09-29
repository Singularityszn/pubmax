import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

type ListedEvidence = {
  category: string;
  pence: number;
  serving: string | null;
  source: "listed";
  sourceUrl: string;
  observedAt: string;
};

type JourneyStop = {
  venueId: string;
  venueName: string;
  selectedDrinkPriceEvidence?: ListedEvidence | null;
  alternatives?: Array<{ venueId: string; venueName?: string; selectedDrinkPriceEvidence?: ListedEvidence | null }>;
};

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
  test(`${journey.category} intent carries a committed listing from Map through Plan save and reload`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      if (!sessionStorage.getItem("listed-journey-cleared")) {
        localStorage.removeItem("pubmax:plan-intake:v1");
        localStorage.removeItem("pubmaxx:plan-route-draft:v1");
        localStorage.removeItem("pubmax:plan-route-draft:v2");
        sessionStorage.removeItem("pubmax:plan-draft:v1");
        sessionStorage.setItem("listed-journey-cleared", "1");
      }
    });

    // Controlled replay: move one real generated, committed-price stop into its
    // own backup pool. Its evidence came from the live generator and exact row
    // is checked against committed rows below; Plan save must re-resolve it.
    let replayedVenueId: string | null = null;
    let replayedEvidence: ListedEvidence | null = null;
    await page.route("**/api/plans/generate", async (route) => {
      const response = await route.fetch();
      const body = await response.json() as { stops?: JourneyStop[] };
      const source = body.stops?.find((stop) => stop.selectedDrinkPriceEvidence?.source === "listed"
        && (stop.alternatives?.length ?? 0) > 0);
      if (!source?.selectedDrinkPriceEvidence || !source.alternatives?.length) {
        throw new Error("Live planner returned no listed stop with a backup for controlled replay");
      }
      const originalVenue = { venueId: source.venueId, venueName: source.venueName };
      const replacement = source.alternatives.shift()!;
      replayedVenueId = originalVenue.venueId;
      replayedEvidence = source.selectedDrinkPriceEvidence;
      source.venueId = replacement.venueId;
      source.venueName = replacement.venueName;
      source.selectedDrinkPriceEvidence = replacement.selectedDrinkPriceEvidence ?? null;
      source.alternatives = [
        ...(source.alternatives ?? []),
        { ...originalVenue, selectedDrinkPriceEvidence: replayedEvidence },
      ];
      await route.fulfill({ response, body: JSON.stringify(body) });
    });

    expect((await page.goto("/map?plan=1"))?.status()).toBe(200);
    await page.getByRole("textbox", { name: "Describe the outing" }).fill(journey.query);
    const generation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans/generate");
    await page.getByRole("button", { name: "Make a plan" }).click();
    const generatedResponse = await generation;
    const generated = await generatedResponse.json() as {
      inferredContext?: { nightArea?: string; drinkCategory?: string; zeroProof?: boolean };
      stops?: JourneyStop[];
    };
    expect(generatedResponse.status(), JSON.stringify(generated)).toBe(200);
    expect(generated.inferredContext).toMatchObject({ nightArea: "shoreditch", drinkCategory: journey.category, zeroProof: false });
    expect(generated.stops?.length).toBeGreaterThan(0);
    const listedStops = generated.stops!.filter((stop) => stop.selectedDrinkPriceEvidence?.source === "listed");
    expect(generated.stops!.some((stop) => (stop.alternatives?.length ?? 0) > 0)).toBe(true);
    const citedCandidates = generated.stops!.flatMap((stop) => [stop, ...(stop.alternatives ?? [])]);
    const listedCandidates = citedCandidates.filter((candidate) => candidate.selectedDrinkPriceEvidence?.source === "listed");
    expect(listedCandidates.length).toBeGreaterThan(0);
    for (const stop of citedCandidates.filter((candidate) => candidate.selectedDrinkPriceEvidence?.source === "listed")) {
      const evidence = stop.selectedDrinkPriceEvidence!;
      expect(evidence).toMatchObject({ category: journey.category, serving: null, source: "listed" });
      expect(committedPrices.some((row) => row.venueId === stop.venueId
        && row.category === journey.category && row.standing === "listed"
        && Math.round(row.priceGbp * 100) === evidence.pence
        && row.sourceUrl === evidence.sourceUrl && row.observedAt === evidence.observedAt)).toBe(true);
    }
    expect(generated.stops!.some((stop) => stop.alternatives?.some((alternative) =>
      alternative.venueId === replayedVenueId
      && JSON.stringify(alternative.selectedDrinkPriceEvidence) === JSON.stringify(replayedEvidence))),
    "controlled committed listing must enter Map route as a priced backup").toBe(true);
    await expect(page.getByRole("link", { name: "Open Plan to lock it in" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-map.png`), animations: "disabled" });
    let extraGenerations = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans/generate") extraGenerations += 1;
    });
    await page.getByRole("link", { name: "Open Plan to lock it in" }).click();
    await expect(page).toHaveURL(/\/plan\?src=mobile-route-preview$/);
    await expect(page.getByLabel("Drinks")).toHaveValue(journey.category);
    await expect(page.locator(".planComposer__stop")).toHaveCount(generated.stops!.length);
    expect(extraGenerations, "Map transfer should keep its generated route without another request").toBe(0);
    await expect(page.locator(".planComposer__stopReason").filter({ hasText: "community report" })).toHaveCount(0);
    await expect(page.locator(".planComposer__stopReason").filter({ hasText: "published menu" })).toHaveCount(listedStops.length);
    await page.locator(".planComposer__stop").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-preview.png`), animations: "disabled" });

    await page.getByLabel("Your name").fill(journey.name);
    const creation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans");
    await page.getByRole("button", { name: "Lock it in" }).click();
    const createdResponse = await creation;
    const submitted = createdResponse.request().postDataJSON() as { stops: JourneyStop[] };
    const backups = (stops: JourneyStop[]) => stops.map((stop) => (stop.alternatives ?? []).map((alternative) => ({
      venueId: alternative.venueId,
      selectedDrinkPriceEvidence: alternative.selectedDrinkPriceEvidence ?? null,
    })));
    expect(backups(submitted.stops)).toEqual(backups(generated.stops!));
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json() as {
      plan?: { context?: { drinkCategory?: string }; stops?: JourneyStop[] };
    };
    expect(created.plan?.context?.drinkCategory).toBe(journey.category);
    expect(created.plan?.stops).toHaveLength(generated.stops!.length);
    expect(created.plan?.stops?.map((stop) => stop.venueId)).toEqual(generated.stops?.map((stop) => stop.venueId));
    expect(created.plan?.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null))
      .toEqual(generated.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null));
    expect(backups(created.plan!.stops!)).toEqual(backups(generated.stops!));
    expect(created.plan?.stops?.find((stop) => stop.alternatives?.some((alternative) => alternative.venueId === replayedVenueId))
      ?.alternatives?.find((alternative) => alternative.venueId === replayedVenueId)
      ?.selectedDrinkPriceEvidence).toEqual(replayedEvidence);
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
    expect(reloaded.stops?.map((stop) => stop.venueId)).toEqual(generated.stops?.map((stop) => stop.venueId));
    expect(reloaded.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null))
      .toEqual(generated.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null));
    expect(backups(reloaded.stops!)).toEqual(backups(generated.stops!));
    expect(reloaded.stops?.find((stop) => stop.alternatives?.some((alternative) => alternative.venueId === replayedVenueId))
      ?.alternatives?.find((alternative) => alternative.venueId === replayedVenueId)
      ?.selectedDrinkPriceEvidence).toEqual(replayedEvidence);
    await expect(page.locator(".planRoute")).not.toContainText("community report");
    await page.locator(".planRoute").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-reloaded.png`), animations: "disabled" });
  });
}
