import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { sortDescribeFirst } from "./helpers/planDescribeFirst";

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
    const response = await sortDescribeFirst(page, journey.query);
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
