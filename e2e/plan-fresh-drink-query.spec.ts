import { expect, test } from "@playwright/test";
import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";

// Exercise the real composer and HTTP request; generation stays on the local server.
test("a new typed wine query releases the prior cocktail correction", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  expect((await page.goto("/plan"))?.status()).toBe(200);
  const count = page.getByRole("group", { name: "Number of pub stops" }).getByRole("button", { name: "3", exact: true });
  await expect(async () => {
    await count.click();
    await expect(count).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await describeFirstQuery(page).fill("Beer in Clapham for 2");
  const firstResponse = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/plans/generate");
  await describeFirstSubmit(page).click();
  const first = await firstResponse;
  const initial = await first.json();
  expect(first.status(), JSON.stringify(initial)).toBe(200);
  expect(initial.stops?.length).toBeGreaterThan(0);
  await page.locator("#plan-context-zero-proof").selectOption("cocktail");
  await expect(page.locator("#plan-context-zero-proof")).toHaveValue("cocktail");
  await page.locator("#plan-concierge-query").fill("Wine in Clapham for 2");
  const nextResponse = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/plans/generate");
  await page.getByRole("button", { name: "Regenerate route", exact: true }).click();
  const next = await nextResponse;
  const sent = next.request().postDataJSON();
  expect(sent.query).toBe("Wine in Clapham for 2");
  expect(sent.context?.drinkCategory ?? null).toBeNull();
  const generated = await next.json();
  expect(next.status(), JSON.stringify(generated)).toBe(200);
  expect(generated.inferredContext.drinkCategory).toBe("wine");
  await expect(page.locator("#plan-context-zero-proof")).toHaveValue("wine");
});
