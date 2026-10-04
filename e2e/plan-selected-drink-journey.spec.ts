import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { isPlanActiveNow } from "../lib/activePlan";
import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

test.use({ serviceWorkers: "block" });

const journeys = [
  { intent: "wine", drinkCategory: "wine", zeroProof: false, routeKey: "routeDrink", routeValue: "wine", query: "Quiet wine in Clapham for 2, not pricey", name: "Wine Browser", mapHeading: "Wine plan" },
  { intent: "cocktail", drinkCategory: "cocktail", zeroProof: false, routeKey: "routeDrink", routeValue: "cocktail", query: "Cheap cocktails in Clapham for 2", name: "Cocktail Browser", mapHeading: "Cocktails plan" },
  { intent: "alcohol-free", drinkCategory: null, zeroProof: true, routeKey: "routeLow", routeValue: "1", query: "Quiet alcohol-free drinks in Clapham for 2, not pricey", name: "Alcohol-free Browser", mapHeading: "Alcohol-free plan" },
] as const;

type Journey = (typeof journeys)[number];

async function prepareSavedJourney(page: Page, journey: Journey, testInfo: TestInfo) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    localStorage.removeItem("pubmax:plan-intake:v1");
    localStorage.removeItem("pubmaxx:plan-route-draft:v1");
    localStorage.removeItem("pubmax_built_ids");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.removeItem("pubmax:plan-draft:v1");
  });

  expect((await page.goto("/plan"))?.status()).toBe(200);
  await describeFirstQuery(page).fill(journey.query);
  const generation = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans/generate");
  await describeFirstSubmit(page).click();
  const generatedResponse = await generation;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json() as {
    inferredContext?: { drinkCategory?: string | null; zeroProof?: boolean };
    budgetSummary?: { estimatedPerPersonPence?: number | null; estimatedCrewPence?: number | null; withinLimit?: boolean | null; basis?: string };
    stops?: Array<{ venueId: string; estimatedPintPricePence?: number | null; priceEvidence?: unknown; selectedDrinkPriceEvidence?: unknown }>;
  };
  expect(generated.inferredContext).toMatchObject({ drinkCategory: journey.drinkCategory, zeroProof: journey.zeroProof });
  expect(generated.stops?.length).toBeGreaterThan(0);
  expect(generated.stops?.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
  if (journey.zeroProof) {
    expect(generated.budgetSummary).toMatchObject({
      estimatedPerPersonPence: null,
      estimatedCrewPence: null,
      withinLimit: null,
      basis: "selected-drink-price-unavailable",
    });
    expect(generated.stops?.every((stop) => stop.estimatedPintPricePence === null && stop.priceEvidence === null)).toBe(true);
  }
  await expect(page.getByLabel("Drinks")).toHaveValue(journey.zeroProof ? "zero-proof" : journey.drinkCategory);
  await expect(page.locator(".planComposer__stop")).toHaveCount(generated.stops!.length);
  await expect(page.locator(".planComposer__stopReason").filter({ hasText: "community report" })).toHaveCount(0);
  await page.locator(".planComposer__stop").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`${journey.intent}-preview.png`), animations: "disabled" });

  await page.getByLabel("Your name").fill(journey.name);
  const creation = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans");
  await page.getByRole("button", { name: "Lock it in" }).click();
  const createdResponse = await creation;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as {
    plan?: { context?: { drinkCategory?: string | null; zeroProof?: boolean }; stops?: Array<{ selectedDrinkPriceEvidence?: unknown }> };
  };
  expect(created.plan?.context?.drinkCategory ?? null).toBe(journey.drinkCategory);
  if (journey.zeroProof) expect(created.plan?.context?.zeroProof).toBe(true);
  expect(created.plan?.stops).toHaveLength(generated.stops!.length);
  expect(created.plan?.stops?.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);

  const planId = new URL(page.url()).pathname.split("/").pop();
  const sessionRestore = page.waitForResponse((response) => response.request().method() === "GET"
    && new URL(response.url()).pathname === `/api/plans/${planId}/session`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();
  const sessionResponse = await sessionRestore;
  const restoredSession = sessionResponse.ok()
    ? await sessionResponse.json() as { active?: unknown }
    : null;
  const read = await page.evaluate(async (id) => {
    const response = await fetch(`/api/plans/${id}`, { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, planId);
  expect(read.status).toBe(200);
  const reloaded = read.body as {
    plan?: { startTime?: string };
    context?: { drinkCategory?: string | null; zeroProof?: boolean };
    stops?: Array<{ venueId?: string; venueName?: string; selectedDrinkPriceEvidence?: unknown }>;
  };
  expect(reloaded.context?.drinkCategory ?? null).toBe(journey.drinkCategory);
  if (journey.zeroProof) expect(reloaded.context?.zeroProof).toBe(true);
  expect(reloaded.stops).toHaveLength(generated.stops!.length);
  expect(reloaded.stops?.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
  const currentStops = reloaded.stops!;
  const currentIds = currentStops.map((stop) => stop.venueId);
  expect(currentIds.every((id): id is string => typeof id === "string" && id.length > 0)).toBe(true);
  const orderedIds = currentIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  expect(orderedIds).toHaveLength(currentStops.length);
  expect(orderedIds).toEqual(generated.stops!.map((stop) => stop.venueId));
  expect(restoredSession?.active).toBe(true);
  const startTime = reloaded.plan?.startTime;
  expect(startTime).toEqual(expect.any(String));
  await expect(page.locator(".planRoute")).not.toContainText("community report");
  await page.locator(".planRoute").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`${journey.intent}-reloaded.png`), animations: "disabled" });

  const nightMode = page.getByRole("dialog", { name: "Night mode", exact: true });
  const browserNow = await page.evaluate(() => Date.now());
  const nightIsActive = isPlanActiveNow({ id: planId!, startTime: startTime!, stopIndex: 0 }, browserNow);
  if (nightIsActive) {
    await expect(nightMode).toBeVisible();
    await nightMode.getByRole("button", { name: "View full plan", exact: true }).click();
  }
  await expect(nightMode).toBeHidden();
  return { planId: planId!, currentStops, orderedIds };
}

for (const journey of journeys) {
  test(`${journey.intent} intent generates, previews, saves, and reloads without inventing a community price`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { planId, currentStops, orderedIds } = await prepareSavedJourney(page, journey, testInfo);
    const nightMode = page.getByRole("dialog", { name: "Night mode", exact: true });

    const walkingLink = page.locator("a.planRoute__walk");
    const miniMapLink = page.locator("a.planRouteMiniMap__routeLink");
    await expect(walkingLink).toBeVisible();
    await expect(miniMapLink).toBeVisible();
    const href = await walkingLink.getAttribute("href");
    expect(href).toBe(await miniMapLink.getAttribute("href"));
    expect(href).not.toBeNull();
    const routeUrl = new URL(href!, page.url());
    expect(routeUrl.pathname).toBe("/map");
    expect(routeUrl.searchParams.get("mode")).toBe("build");
    expect(routeUrl.searchParams.get("pubs")?.split(",")).toEqual(orderedIds);
    expect(routeUrl.searchParams.get(journey.routeKey)).toBe(journey.routeValue);
    expect([...routeUrl.searchParams.keys()].sort()).toEqual(["mode", "pubs", journey.routeKey].sort());

    let mapUrlAfterOpeningPlan = "";
    for (const [index, selector] of ["a.planRoute__walk", "a.planRouteMiniMap__routeLink"].entries()) {
      if (index > 0) {
        await page.goBack();
        await expect(page).toHaveURL(mapUrlAfterOpeningPlan);
        await expect(page.locator(".routePanel:visible")).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Edit active \d+-stop plan/ })).toBeVisible();

        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/plan/${planId}(?:#share)?$`));
        await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();
        await expect(nightMode).toBeHidden();
      }
      const link = page.locator(selector);
      await expect(link).toBeVisible();
      expect(await link.getAttribute("href")).toBe(href);
      await link.click();
      await expect(page).toHaveURL((url) => url.pathname === "/map"
        && url.searchParams.get("mode") === "build"
        && url.searchParams.get(journey.routeKey) === journey.routeValue);
      const receivingUrl = new URL(page.url());
      expect([...receivingUrl.searchParams.keys()].sort()).toEqual(["mode", "pubs", journey.routeKey].sort());
      expect(receivingUrl.searchParams.get("pubs")?.split(",")).toEqual(orderedIds);

      const mapPanel = page.locator(".routePanel:visible");
      await expect(async () => {
        if (!await mapPanel.isVisible()) {
          await page.getByRole("button", { name: /Edit active \d+-stop plan/ }).click({ timeout: 1_000 });
        }
        await expect(mapPanel).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      await expect(mapPanel).toHaveCount(1);
      if (index === 0) mapUrlAfterOpeningPlan = page.url();

      await expect.poll(() => page.evaluate(() => {
        const raw = localStorage.getItem("pubmax_built_ids");
        return raw ? JSON.parse(raw) as string[] : null;
      })).toEqual(orderedIds);
      await expect(mapPanel.locator(".routeList > li")).toHaveCount(currentStops.length);
      await expect.poll(() => mapPanel.locator(".routeList > li > button strong").evaluateAll((elements) =>
        elements.map((element) => Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "").join("").trim()),
      )).toEqual(currentStops.map((stop) => stop.venueName));
      await expect(mapPanel.locator(".routeHeader h2")).toHaveText(journey.mapHeading);
      const metrics = mapPanel.locator(".routeMetrics");
      await expect(metrics).toContainText("Not recorded");
      await expect(metrics).not.toContainText(/£|estimated round|\bpint stops?\b/i);
      await expect(mapPanel.getByRole("radio", { name: "Pint", exact: true })).toHaveCount(0);
    }
  });
}

for (const journey of [journeys[0], journeys[2]]) {
  test(journey.intent + " single-stop map link opens saved venue and preserves route", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { currentStops, orderedIds } = await prepareSavedJourney(page, journey, testInfo);
    const firstStop = currentStops[0];
    expect(firstStop?.venueId).toEqual(expect.any(String));
    expect(firstStop?.venueName).toEqual(expect.any(String));
    if (!firstStop?.venueId || !firstStop.venueName) {
      throw new Error("Saved route must include a named first stop");
    }

    const firstRow = page.locator(".planRoute .planSummary__stops > li").first();
    await expect(firstRow.locator("strong")).toHaveText(firstStop.venueName);
    const openOnMap = firstRow.getByRole("link", { name: "Open on the map", exact: true });
    await expect(openOnMap).toBeVisible();

    // First Map visit is this stop action; no prior pin selection can satisfy
    // the receiving detail assertion.
    await openOnMap.click();
    await expect(page).toHaveURL((url) => url.pathname === "/map");

    const receivingUrl = new URL(page.url());
    expect([...receivingUrl.searchParams.keys()].sort()).toEqual([
      "mode",
      "pubs",
      "sel",
      journey.routeKey,
    ].sort());
    expect(receivingUrl.searchParams.get("mode")).toBe("build");
    expect(receivingUrl.searchParams.get("pubs")?.split(",")).toEqual(orderedIds);
    expect(receivingUrl.searchParams.get("sel")).toBe(firstStop.venueId);
    expect(receivingUrl.searchParams.get(journey.routeKey)).toBe(journey.routeValue);

    const selectedVenue = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]:visible');
    await expect(selectedVenue.locator(".mobileSharedSheet.open")).toBeVisible();
    await expect(
      selectedVenue.getByRole("heading", { level: 2, name: firstStop.venueName, exact: true }),
    ).toBeVisible();
    await expect(selectedVenue.locator(".venueInspector")).toBeVisible();

    await selectedVenue.getByRole("button", { name: /^Close .+ detail$/ }).click();
    await expect(selectedVenue).toBeHidden();

    const mapPanel = page.locator(".routePanel:visible");
    await expect(async () => {
      if (!await mapPanel.isVisible()) {
        await page.getByRole("button", { name: new RegExp(`Edit active ${orderedIds.length}-stop plan`) }).click({ timeout: 1_000 });
      }
      await expect(mapPanel).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(mapPanel.locator(".routeList > li")).toHaveCount(currentStops.length);
    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem("pubmax_built_ids");
      return raw ? JSON.parse(raw) as string[] : null;
    })).toEqual(orderedIds);
    await expect.poll(() => mapPanel.locator(".routeList > li > button strong").evaluateAll((elements) =>
      elements.map((element) => Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "").join("").trim()),
    )).toEqual(currentStops.map((stop) => stop.venueName));
    await expect(mapPanel.locator(".routeHeader h2")).toHaveText(journey.mapHeading);
    await expect(mapPanel.locator(".routeMetrics")).toContainText("Not recorded");
    await expect(mapPanel.locator(".routeMetrics")).not.toContainText(/£|estimated round|\bpint stops?\b/i);
    await expect(mapPanel.getByRole("radio", { name: "Pint", exact: true })).toHaveCount(0);
  });
}
