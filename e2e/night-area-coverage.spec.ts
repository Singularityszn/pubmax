import { expect, type Page, test } from "@playwright/test";

/**
 * /plan opens on the describe-first question (components/plan/PlanDescribeFirst.tsx).
 * These tests need the full composer, which only renders once composerVisible
 * is true, without first generating a route. So this reaches it through the
 * wizard's own "Describe instead" skip rather than trusting the describe-first
 * field's visibility, which would false-positive.
 */
async function openComposer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Step by step" }).click();
  await page.getByRole("button", { name: "Describe instead" }).click();
  await expect(page.getByLabel("Where, how many, what budget")).toBeVisible();
}

test("mobile planner announces concierge progress while it finds a route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  let releaseGenerate: () => void = () => {};
  const generatePaused = new Promise<void>((resolve) => {
    releaseGenerate = resolve;
  });
  await page.route("**/api/plans/generate", async (route) => {
    await generatePaused;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "The planner is unavailable right now. Try again in a moment." }),
    });
  });

  const response = await page.goto("/plan");
  expect(response?.status()).toBe(200);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await openComposer(page);

  const concierge = page.locator(".planComposer__concierge");
  const description = page.getByLabel("Where, how many, what budget");
  await description.fill("A calm, affordable night near Clapham");
  await expect(description).toHaveValue("A calm, affordable night near Clapham");
  const submit = page.getByRole("button", { name: "Make a plan" });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(concierge).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Planning…" })).toBeDisabled();
  await expect(page.locator("#plan-concierge-status")).toContainText(
    "picking stops we can back up",
  );
  releaseGenerate();
  await expect(page.locator(".planComposer__error")).toContainText("The planner is unavailable right now.");
  await expect(concierge).toHaveAttribute("aria-busy", "false");
});

test("mobile planner keeps the inferred Night Area context editable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.route("**/api/plans/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        inferredContext: {
          nightArea: "clapham",
          daypart: "evening",
          partyType: "friends",
          groupSize: 4,
          budget: "value",
          atmosphere: [],
          foodNeeds: [],
          accessibility: [],
          transportConstraints: [],
        },
        stops: [
          { venueId: "venue-1", venueName: "First Pub" },
          { venueId: "venue-2", venueName: "Second Pub" },
          { venueId: "venue-3", venueName: "Third Pub" },
        ],
      }),
    });
  });

  const response = await page.goto("/plan");
  expect(response?.status()).toBe(200);
  await openComposer(page);
  await page.getByLabel("Where, how many, what budget").fill("A calm night in Clapham for four");
  await page.getByRole("button", { name: "Make a plan" }).click();

  // The route comes first; the inferred context is one tap away, in the sheet.
  await page.getByRole("button", { name: "Tune details" }).click();
  await expect(page.getByRole("combobox", { name: "Area" })).toHaveValue("clapham");
  await page.getByRole("combobox", { name: "Area" }).selectOption("victoria");
  await page.getByRole("combobox", { name: "Time" }).selectOption("late_night");
  await page.getByRole("combobox", { name: "Group" }).selectOption("work");
  await page.getByRole("spinbutton", { name: "People" }).fill("6");
  await page.getByRole("combobox", { name: "Budget" }).selectOption("treat");

  await expect(page.getByRole("combobox", { name: "Area" })).toHaveValue("victoria");
  await expect(page.getByRole("combobox", { name: "Time" })).toHaveValue("late_night");
  await expect(page.getByRole("combobox", { name: "Group" })).toHaveValue("work");
  await expect(page.getByRole("spinbutton", { name: "People" })).toHaveValue("6");
  await expect(page.getByRole("combobox", { name: "Budget" })).toHaveValue("treat");
});
