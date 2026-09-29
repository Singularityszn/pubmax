import { expect, test } from "@playwright/test";

import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";

test("wine intent generates, previews, saves, and reloads without inventing a community price", async ({ page }) => {
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
  await describeFirstQuery(page).fill("Quiet wine in Clapham for 2, not pricey");
  const generation = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans/generate");
  await describeFirstSubmit(page).click();
  const generatedResponse = await generation;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json() as {
    inferredContext?: { drinkCategory?: string; zeroProof?: boolean };
    stops?: Array<{ venueId: string; selectedDrinkPriceEvidence?: unknown }>;
  };
  expect(generated.inferredContext).toMatchObject({ drinkCategory: "wine", zeroProof: false });
  expect(generated.stops?.length).toBeGreaterThan(0);
  expect(generated.stops?.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
  await expect(page.getByLabel("Drinks")).toHaveValue("wine");
  await expect(page.locator(".planComposer__stop")).toHaveCount(generated.stops!.length);
  await expect(page.locator(".planComposer__stopReason").filter({ hasText: "community report" })).toHaveCount(0);

  await page.getByLabel("Your name").fill("Wine Browser");
  const creation = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans");
  await page.getByRole("button", { name: "Lock it in" }).click();
  const createdResponse = await creation;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as {
    plan?: { context?: { drinkCategory?: string }; stops?: Array<{ selectedDrinkPriceEvidence?: unknown }> };
  };
  expect(created.plan?.context?.drinkCategory).toBe("wine");
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
  expect(reloaded.context?.drinkCategory).toBe("wine");
  expect(reloaded.stops?.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
  await expect(page.locator(".planRoute")).not.toContainText("community report");
});
