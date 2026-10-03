import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type { PlanState } from "../lib/plan";
import type { UkPriceBundleRow } from "../lib/ukPriceBundle";

import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const journey of [
  { category: "wine", query: "Quiet wine in Clapham for 2, not pricey", name: "Disposable Wine", venueId: "venue-11e0hkh", pence: 675 },
  { category: "cocktail", query: "Cheap cocktails in Clapham for 2", name: "Disposable Cocktail", venueId: "venue-11e0hkh", pence: 895 },
] as const) {
  test(`${journey.category} browser saves and reloads corroborated disposable PostgREST price`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
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
    const response = await generation;
    expect(response.status()).toBe(200);
    const generated = await response.json() as {
      inferredContext?: { drinkCategory?: string };
      stops?: Array<{ venueId: string; selectedDrinkPriceEvidence?: { category: string; pence: number; source: string; reportedAt: string } }>;
    };
    expect(generated.inferredContext?.drinkCategory).toBe(journey.category);
    const pricedStop = generated.stops?.find((stop) => stop.venueId === journey.venueId);
    expect(pricedStop?.selectedDrinkPriceEvidence).toMatchObject({
      category: journey.category, pence: journey.pence, source: "community",
    });
    await expect(page.locator(".planComposer__stopReason").filter({ hasText: "community report" })).toBeVisible();
    await page.locator(".planComposer__stopReason").filter({ hasText: "community report" }).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-priced-preview.png`), animations: "disabled" });

    await page.getByLabel("Your name").fill(journey.name);
    const creation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans");
    await page.getByRole("button", { name: "Lock it in" }).click();
    const createdResponse = await creation;
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json() as {
      memberToken?: string;
      plan?: { plan?: { id?: string }; context?: { drinkCategory?: string }; stops?: Array<{ venueId: string; selectedDrinkPriceEvidence?: unknown }> };
    };
    expect(created.plan?.context?.drinkCategory).toBe(journey.category);
    expect(created.plan?.stops?.find((stop) => stop.venueId === journey.venueId)?.selectedDrinkPriceEvidence)
      .toEqual(pricedStop?.selectedDrinkPriceEvidence);
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);
    const planId = new URL(page.url()).pathname.split("/").pop();
    expect(planId).toBe(created.plan?.plan?.id);

    const restUrl = process.env.PW_DISPOSABLE_SUPABASE_URL;
    const serviceRoleKey = process.env.PW_DISPOSABLE_SERVICE_ROLE_KEY;
    expect(restUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
    expect(serviceRoleKey).toBeTruthy();
    const stopQuery = new URL("/rest/v1/plan_stops", restUrl);
    stopQuery.searchParams.set("select", "venue_id,selected_drink_price_evidence");
    stopQuery.searchParams.set("plan_id", `eq.${planId}`);
    stopQuery.searchParams.set("venue_id", `eq.${journey.venueId}`);
    const storedResponse = await fetch(stopQuery, { headers: { Authorization: `Bearer ${serviceRoleKey}` } });
    expect(storedResponse.status).toBe(200);
    const stored = await storedResponse.json() as Array<{ selected_drink_price_evidence: unknown }>;
    expect(stored).toHaveLength(1);
    expect(stored[0].selected_drink_price_evidence).toEqual(pricedStop?.selectedDrinkPriceEvidence);

    await page.reload();
    await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();
    const read = await page.evaluate(async (id) => {
      const response = await fetch(`/api/plans/${id}`, { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    }, planId);
    expect(read.status).toBe(200);
    const reloaded = read.body as { context?: { drinkCategory?: string }; stops?: Array<{ venueId: string; selectedDrinkPriceEvidence?: unknown }> };
    expect(reloaded.context?.drinkCategory).toBe(journey.category);
    expect(reloaded.stops?.find((stop) => stop.venueId === journey.venueId)?.selectedDrinkPriceEvidence)
      .toEqual(pricedStop?.selectedDrinkPriceEvidence);
    await expect(page.locator(".planRoute")).toContainText("community report");
    await expect(page.locator(".planRoute__signal--loading")).toHaveCount(0);
    await page.locator(".planRoute").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-priced-reloaded.png`), animations: "disabled" });

    const submitted = createdResponse.request().postDataJSON() as Record<string, unknown> & {
      stops: Array<{ venueId: string; selectedDrinkPriceEvidence?: unknown }>;
    };
    for (const badHint of ["wrong-price", "wrong-category"] as const) {
      const forged = structuredClone(submitted);
      delete forged.anchor;
      delete forged.groundingProof;
      forged.stops = forged.stops.map((stop) => stop.venueId === journey.venueId
        ? {
            ...stop,
            selectedDrinkPriceEvidence: {
              ...pricedStop!.selectedDrinkPriceEvidence,
              ...(badHint === "wrong-price"
                ? { pence: journey.pence + 1 }
                : { category: journey.category === "wine" ? "cocktail" : "wine" }),
            },
          }
        : stop);
      const rejectedHint = await page.evaluate(async ({ body, key }) => {
        const response = await fetch("/api/plans", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": key },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      }, { body: forged, key: randomUUID() });
      expect(rejectedHint.status, badHint).toBe(201);
      const forgedPlan = rejectedHint.body as {
        plan?: { plan?: { id?: string }; stops?: Array<{ venueId: string; selectedDrinkPriceEvidence?: unknown }> };
      };
      expect(forgedPlan.plan?.stops?.find((stop) => stop.venueId === journey.venueId)?.selectedDrinkPriceEvidence, badHint)
        .toBeUndefined();
      expect(forgedPlan.plan?.plan?.id, badHint).toMatch(/^[0-9a-f-]{36}$/);
      const forgedStopQuery = new URL(stopQuery);
      forgedStopQuery.searchParams.set("plan_id", `eq.${forgedPlan.plan!.plan!.id}`);
      const forgedStoredResponse = await fetch(forgedStopQuery, { headers: { Authorization: `Bearer ${serviceRoleKey}` } });
      expect(forgedStoredResponse.status, badHint).toBe(200);
      const forgedStored = await forgedStoredResponse.json() as Array<{ selected_drink_price_evidence: unknown }>;
      expect(forgedStored, badHint).toHaveLength(1);
      expect(forgedStored[0].selected_drink_price_evidence, badHint).toBeNull();
    }

    if (journey.category === "wine") {
      const proposalResponse = await page.request.post(`/api/plans/${planId}/proposals`, {
        headers: { "idempotency-key": randomUUID() },
        data: { memberToken: created.memberToken, expectedRouteRevision: 1,
          stops: generated.stops, reason: "Keep the quoted wine route", resolvedConstraintIds: [] },
      });
      expect(proposalResponse.status()).toBe(201);
      const proposal = await proposalResponse.json();
      const contextResponse = await page.request.patch(`/api/plans/${planId}`, {
        data: { memberToken: created.memberToken, context: { ...created.plan?.context, drinkCategory: "beer", zeroProof: false } },
      });
      expect(contextResponse.status()).toBe(200);
      const accepted = await page.request.post(`/api/plans/${planId}/proposals/${proposal.proposal.id}/decision`, {
        headers: { "idempotency-key": randomUUID() },
        data: { memberToken: created.memberToken, decision: "accepted" },
      });
      expect(accepted.status()).toBe(200);
      const after = await fetch(stopQuery, { headers: { Authorization: `Bearer ${serviceRoleKey}` } });
      expect(after.status).toBe(200);
      expect((await after.json())[0].selected_drink_price_evidence).toBeNull();
      await page.reload();
      await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();
      await expect(page.locator(".planRoute")).not.toContainText("Wine £6.75");
    }
  });
}


test("named White wine survives Map, durable save, reload and host route refresh", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const venueId = "venue-uk-n8308248176";
  const rows = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as UkPriceBundleRow[];
  const printed = rows.find((row) => row.venueId === venueId && row.category === "wine"
    && row.standing === "listed" && row.drinkLabel === "Chardonnay, Pays D’oc, France"
    && row.servingSize === "125ml");
  expect(printed, "Committed Sydney menu supplies the real named quote").toBeDefined();
  expect(printed).toMatchObject({ priceGbp: 5.5,
    sourceUrl: "https://www.sydneyarmschelsea.com/menu/", observedAt: "2026-09-29T10:40:17.846Z" });
  const evidence = { category: "wine", pence: Math.round(printed!.priceGbp * 100),
    serving: printed!.servingSize, source: "listed", sourceUrl: printed!.sourceUrl,
    observedAt: printed!.observedAt, drinkLabel: printed!.drinkLabel, drinkSubtype: "wine-white" };
  expect(Object.keys(evidence)).toHaveLength(8);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  // Viewport coordinates belong to the published pub, never a viewer position.
  expect((await page.goto(`/map?drink=wine&sub=wine-white&serving=125ml&sel=${venueId}&at=51.4888,-0.1695&uk=1`))?.status()).toBe(200);
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet.getByRole("heading", { name: "The Sydney Arms", exact: true })).toBeVisible();
  await expect(sheet).toContainText(printed!.drinkLabel!);
  await expect(sheet).toContainText("£5.50");
  await expect(sheet).toContainText("125ml");
  await expect(sheet.locator(`a[href="${printed!.sourceUrl}"]`)).toBeVisible();
  await expect(async () => {
    await sheet.getByRole("button", { name: "Make The Sydney Arms Stop 1" }).click();
    await expect(page).toHaveURL(/\/plan(?:\?|$)/, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Accepted plan context" })).toContainText(printed!.drinkLabel!);
  await describeFirstQuery(page).fill("Quiet white wine in Clapham for 2, keep my first stop");
  const generation = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans/generate");
  await page.locator(".planComposer__conciergeInput button").click();
  const generatedResponse = await generation;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json() as { stops: PlanState["stops"] };
  expect(generated.stops[0]).toMatchObject({ venueId, selectedDrinkPriceEvidence: evidence });
  expect(generated.stops[0].selectedDrinkPriceEvidence).toEqual(evidence);
  await expect(page.locator(".planComposer__stop").first()).toContainText(printed!.drinkLabel!);
  await page.getByLabel("Your name").fill("Named Wine Browser");
  const creation = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans");
  await page.getByRole("button", { name: "Lock it in" }).click();
  const createdResponse = await creation;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as { memberToken: string; plan: PlanState };
  const planId = created.plan.plan.id;
  expect(created.plan.stops[0].selectedDrinkPriceEvidence).toEqual(evidence);
  await expect(page).toHaveURL(new RegExp(`/plan/${planId}(?:#share)?$`));

  const restUrl = process.env.PW_DISPOSABLE_SUPABASE_URL;
  const serviceRoleKey = process.env.PW_DISPOSABLE_SERVICE_ROLE_KEY;
  expect(restUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
  expect(serviceRoleKey).toBeTruthy();
  const stopQuery = new URL("/rest/v1/plan_stops", restUrl);
  stopQuery.searchParams.set("select", "venue_id,position,selected_drink_price_evidence");
  stopQuery.searchParams.set("plan_id", `eq.${planId}`);
  stopQuery.searchParams.set("order", "position.asc");
  async function storedStops() {
    const response = await fetch(stopQuery, { headers: { Authorization: `Bearer ${serviceRoleKey}` } });
    expect(response.status).toBe(200);
    return await response.json() as Array<{ venue_id: string; selected_drink_price_evidence: unknown }>;
  }
  expect((await storedStops())[0]).toMatchObject({ venue_id: venueId, selected_drink_price_evidence: evidence });
  await page.reload();
  await expect(page.getByRole("heading", { name: "The route", exact: true })).toBeVisible();
  await expect(page.locator(".planRoute")).toContainText(printed!.drinkLabel!);
  await page.screenshot({ path: testInfo.outputPath("named-white-durable-reloaded.png"), animations: "disabled" });

  // Use the real host capability API to request a shorter route. This creates
  // a changed preview without inventing stops, quotes or a grounding proof.
  const contextResponse = await page.request.patch(`/api/plans/${planId}`, {
    data: { memberToken: created.memberToken, context: { ...created.plan.context, stopCount: 2 } },
  });
  expect(contextResponse.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit route", exact: true })).toBeVisible();
  const refresh = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans/generate");
  await page.getByRole("button", { name: "Edit route", exact: true }).click();
  const refreshedResponse = await refresh;
  expect(refreshedResponse.status()).toBe(200);
  expect(refreshedResponse.request().postDataJSON().anchor.selectedDrinkPriceEvidence).toEqual(evidence);
  const refreshed = await refreshedResponse.json() as { stops: PlanState["stops"] };
  expect(refreshed.stops).toHaveLength(2);
  expect(refreshed.stops[0]).toMatchObject({ venueId, selectedDrinkPriceEvidence: evidence });
  expect(refreshed.stops[0].selectedDrinkPriceEvidence).toEqual(evidence);
  const save = page.getByRole("button", { name: "Save route changes", exact: true });
  await expect(save).toBeEnabled();
  const replacement = page.waitForResponse((response) => response.request().method() === "PATCH"
    && new URL(response.url()).pathname === `/api/plans/${planId}`);
  await save.click();
  const savedResponse = await replacement;
  expect(savedResponse.status()).toBe(200);
  const saved = await savedResponse.json() as PlanState;
  expect(saved.stops).toHaveLength(2);
  expect(saved.stops[0].selectedDrinkPriceEvidence).toEqual(evidence);
  const durable = await storedStops();
  expect(durable).toHaveLength(2);
  expect(durable[0]).toMatchObject({ venue_id: venueId, selected_drink_price_evidence: evidence });
  await page.reload();
  await expect(page.getByRole("heading", { name: "The route", exact: true })).toBeVisible();
  await expect(page.locator(".planRoute .planSummary__stops > li")).toHaveCount(2);
  await expect(page.locator(".planRoute")).toContainText(printed!.drinkLabel!);
  await page.screenshot({ path: testInfo.outputPath("named-white-durable-refreshed.png"), animations: "disabled" });
});
