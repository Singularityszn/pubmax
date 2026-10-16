import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test.describe(`generation feedback at ${viewport.width}px with ${reducedMotion} motion`, () => {
      test.use({ viewport, reducedMotion });

      test("reveals a generation failure after the Tune sheet restores focus", async ({ page }) => {
        await page.addInitScript(() => {
          localStorage.clear();
          sessionStorage.clear();
          localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
          localStorage.setItem("pubmax-tour-v1-done", "1");
        });
        await page.goto("/plan");
        const query = page.getByRole("textbox", { name: "Where, how many, what budget" }).first();
        await expect(query).not.toHaveAttribute("readonly");
        await query.fill("3 pubs in Clapham");
        const initialResponse = page.waitForResponse((response) => response.url().endsWith("/api/plans/generate") && response.request().method() === "POST");
        await page.getByRole("button", { name: "Plan it", exact: true }).click();
        expect((await initialResponse).status()).toBe(200);
        await expect(page.locator("#plan-route-status")).toContainText("Route refreshed.");
        const tune = page.getByRole("button", { name: "Tune details", exact: true }).and(page.locator('[aria-haspopup="dialog"]'));
        await expect(tune).toBeVisible();
        await tune.click();
        const sheet = page.getByRole("dialog", { name: "Tune details" });
        await sheet.getByRole("textbox", { name: "Where, how many, what budget" }).fill("One pizza and a pint under £10 in Soho");
        const response = page.waitForResponse((response) => response.url().endsWith("/api/plans/generate") && response.request().method() === "POST");
        await sheet.getByRole("button", { name: "Plan it again", exact: true }).click();
        expect((await response).status()).toBe(422);
        await expect(sheet).toBeHidden();
        const limitation = page.getByRole("alert").filter({ hasText: "This route planner cannot verify meal prices" });
        await expect(limitation).toHaveCount(1);
        await expect(limitation).toBeInViewport({ ratio: 1 });
        await expect(limitation).toBeFocused();
        await expect(page.locator("#plan-route-status")).toBeEmpty();
        await expect(page.getByRole("status").filter({ hasText: "This route planner cannot verify meal prices" })).toHaveCount(0);
        await tune.click();
        await expect(sheet).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
        await expect(tune).toBeFocused();
      });

      test("reveals the actual meal limitation after submitting an outing", async ({ page }, testInfo) => {
        await page.addInitScript(() => {
          localStorage.clear();
          sessionStorage.clear();
          localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
          localStorage.setItem("pubmax-tour-v1-done", "1");
        });
        await page.goto("/plan");
        const query = page.getByRole("textbox", { name: "Where, how many, what budget" }).first();
        await expect(query).not.toHaveAttribute("readonly");
        await query.fill("One pizza and a pint under £10 in Soho");
        await page.getByRole("group", { name: "Number of pub stops" }).getByRole("button", { name: "1", exact: true }).click();
        for (const action of ["Plan it", "Make a plan"]) {
          const response = page.waitForResponse((response) => response.url().endsWith("/api/plans/generate") && response.request().method() === "POST");
          await page.getByRole("button", { name: action, exact: true }).click();
          const actual = await response;
          expect(actual.status()).toBe(422);
          expect(await actual.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
          const limitation = page.getByRole("alert").filter({ hasText: "This route planner cannot verify meal prices" });
          await expect(limitation).toHaveCount(1);
          try {
            await expect(limitation).toBeInViewport({ ratio: 1 });
            await expect(limitation).toBeFocused();
            await expect(page.locator("#plan-route-status")).toBeEmpty();
            await expect(page.getByRole("status").filter({ hasText: "This route planner cannot verify meal prices" })).toHaveCount(0);
          } finally {
            await page.screenshot({ path: testInfo.outputPath("meal-feedback.png"), fullPage: false });
          }
        }
      });
    });
  }
}
