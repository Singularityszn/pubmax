import { expect, test, type Page } from "@playwright/test";

// QA journeys, 6 Oct 2026, F09. "Sort it" on an empty box did nothing visible,
// and "Lock it in" sat disabled with its required "Your name" field a screen
// above and no reason given. Both now say what they need.

const HOST_ACTION_BUDGET_MS = 20_000;

async function openHydratedPlan(page: Page): Promise<void> {
  await page.goto("/plan");
  const stopCount = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "4", exact: true });
  await expect(async () => {
    await stopCount.click();
    await expect(stopCount).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: HOST_ACTION_BUDGET_MS });
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`Sort it and Lock it in say what they need at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await openHydratedPlan(page);

    const query = page.getByRole("textbox", { name: "Describe the outing" });
    await page.getByRole("button", { name: "Sort it", exact: true }).click();
    await expect(page.locator(".planDescribeFirst__empty")).toHaveText(/where and who with/i);
    await expect(query).toHaveAttribute("aria-invalid", "true");
    await expect(query).toBeFocused();

    await query.fill("Quiet in Clapham for 4, not pricey");
    await expect(page.locator(".planDescribeFirst__empty")).toHaveCount(0);
    await page.getByRole("button", { name: "Sort it", exact: true }).click();
    await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible({
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
