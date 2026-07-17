import { test, expect, type Page } from "@playwright/test";

// Accessible-venue filters E2E (PRD issue #28). WebGL-AGNOSTIC and read-only:
// the controls now live inside the single coordinated planner sheet. Assert
// the checkboxes stay labelled and keyboard-operable without touching canvas.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function openPlanner(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();
  const activation = page.getByRole("button", { name: "Describe your night" });
  await expect(activation).toBeEnabled();
  await activation.click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

test("the Step-free planning need is labelled and keyboard-operable", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const planner = await openPlanner(page);
  const stepFree = planner.getByRole("button", { name: "Step-free", exact: true });
  await expect(stepFree).toHaveAttribute("aria-pressed", "false");
  await stepFree.focus();
  await page.keyboard.press("Enter");
  await expect(stepFree).toHaveAttribute("aria-pressed", "true");

  expect(errors).toEqual([]);
});

test("a Step-free route surfaces unknown accessibility evidence instead of claiming a match", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchPageErrors(page);
  const planner = await openPlanner(page);
  const stepFreeChip = planner.getByRole("button", { name: "Step-free", exact: true });
  await stepFreeChip.click();
  await expect(stepFreeChip).toHaveAttribute("aria-pressed", "true");
  await planner.getByRole("button", { name: "Build 3-stop route" }).click();
  await expect(planner.getByText("Check venue accessibility before relying on this route.")).toBeVisible({ timeout: 45_000 });
  await expect(planner.locator(".mobilePlannerRouteTotal")).toBeVisible();

  expect(errors).toEqual([]);
});
