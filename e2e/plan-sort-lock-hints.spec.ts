import { expect, test, type Page } from "@playwright/test";

import { chooseDescribeFirstStopCount } from "./helpers/planDescribeFirst";

// QA journeys, 6 Oct 2026, F09. "Plan it" on an empty box did nothing visible,
// and "Lock it in" sat disabled with its required "Your name" field a screen
// above and no reason given. Both now say what they need.

const HOST_ACTION_BUDGET_MS = 20_000;

async function openHydratedPlan(page: Page): Promise<void> {
  await page.goto("/plan");
  await chooseDescribeFirstStopCount(page, 4, HOST_ACTION_BUDGET_MS);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`Plan it and Lock it in say what they need at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await openHydratedPlan(page);

    // The page leads with a priced route, so Plan it on an empty field has
    // words to plan and asks for none (#3035). __tests__/planOneTap.test.tsx
    // holds the hint a page with no route still gives.
    await expect(page.locator(".planStarter")).toContainText("each for pints");
    const query = page.getByRole("textbox", { name: "Where, how many, what budget" });
    await query.fill("Quiet in Clapham for 4, not pricey");
    await page.getByRole("button", { name: "Plan it", exact: true }).click();
    await expect(page.getByText("Route ready. Review the preview")).toBeVisible({
      timeout: HOST_ACTION_BUDGET_MS,
    });

    // The button stays tappable while the form still needs a name, and the line
    // under it names the field.
    const lock = page.getByRole("button", { name: "Lock it in" });
    await expect(lock).toHaveAttribute("aria-disabled", "true");
    await expect(lock).toHaveAccessibleDescription("Add your name.");
    await expect(page.locator("#plan-lock-hint")).toHaveText("Add your name.");

    await lock.dispatchEvent("click");
    await expect(page.getByLabel("Your name")).toBeFocused();
    await expect(page.locator(".planComposer__error")).toHaveText("Add your name.");

    await page.getByLabel("Your name").fill("Karan");
    await expect(lock).toBeEnabled();
    await expect(page.locator("#plan-lock-hint")).toHaveCount(0);
  });
}
