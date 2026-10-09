import { expect, test } from "@playwright/test";

import { sortDescribeFirst } from "./helpers/planDescribeFirst";

for (const journey of [
  { category: "wine", query: "Quiet wine in Clapham for 2, not pricey", name: "Wine Browser" },
  { category: "cocktail", query: "Cheap cocktails in Clapham for 2", name: "Cocktail Browser" },
] as const) {
  test(`${journey.category} intent generates, previews, saves, and reloads without inventing a community price`, async ({ page }, testInfo) => {
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
    const generatedResponse = await sortDescribeFirst(page, journey.query);
    expect(generatedResponse.status()).toBe(200);
    const generated = await generatedResponse.json() as {
      inferredContext?: { drinkCategory?: string; zeroProof?: boolean };
      stops?: Array<{ venueId: string; selectedDrinkPriceEvidence?: unknown }>;
    };
    expect(generated.inferredContext).toMatchObject({ drinkCategory: journey.category, zeroProof: false });
    expect(generated.stops?.length).toBeGreaterThan(0);
    expect(generated.stops?.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
    // The settings sit behind Tune details now, and close again before the lock.
    await page.getByRole("button", { name: "Tune details" }).click();
    await expect(page.getByLabel("Drinks")).toHaveValue(journey.category);
    await page.keyboard.press("Escape");
    await expect(page.locator(".planComposer__stop")).toHaveCount(generated.stops!.length);
    await expect(page.locator(".planComposer__stopReason").filter({ hasText: "community report" })).toHaveCount(0);
    await page.locator(".planComposer__stop").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-preview.png`), animations: "disabled" });

    await page.getByLabel("Your name").fill(journey.name);
    const creation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans");
    await page.getByRole("button", { name: "Lock it in" }).click();
    const createdResponse = await creation;
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json() as {
      plan?: { context?: { drinkCategory?: string }; stops?: Array<{ selectedDrinkPriceEvidence?: unknown }> };
    };
    expect(created.plan?.context?.drinkCategory).toBe(journey.category);
    expect(created.plan?.stops).toHaveLength(generated.stops!.length);
    expect(created.plan?.stops?.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);

    const planId = new URL(page.url()).pathname.split("/").pop();
    await page.reload();
    await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();
    const read = await page.evaluate(async (id) => {
      const response = await fetch(`/api/plans/${id}`, { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    }, planId);
    expect(read.status).toBe(200);
    const reloaded = read.body as { context?: { drinkCategory?: string }; stops?: Array<{ selectedDrinkPriceEvidence?: unknown }> };
    expect(reloaded.context?.drinkCategory).toBe(journey.category);
    expect(reloaded.stops).toHaveLength(generated.stops!.length);
    expect(reloaded.stops?.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
    await expect(page.locator(".planRoute")).not.toContainText("community report");
    await page.locator(".planRoute").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-reloaded.png`), animations: "disabled" });
  });
}
