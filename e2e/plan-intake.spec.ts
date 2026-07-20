import { expect, test, type Page } from "@playwright/test";

async function continueIntake(page: Page): Promise<void> {
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
}

async function chooseClaphamAndContinue(page: Page): Promise<void> {
  const timeHeading = page.getByRole("heading", { name: "When are you heading out?" });
  await page.getByRole("button", { name: "Clapham" }).click();
  if (await timeHeading.isVisible()) return;
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  try {
    await continueButton.click({ timeout: 2_000 });
  } catch (error) {
    if (!(await timeHeading.isVisible())) throw error;
  }
  await expect(timeHeading).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("pubmax:test-preserve-intake") === "1") return;
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.localStorage.removeItem("pubmax:nightPatch:v1");
    window.sessionStorage.removeItem("pubmax:plan-draft:v1");
  });
});

test("reloading a recovered draft does not extend its near expiry", async ({ page }) => {
  await page.goto("/plan");
  const expiresAt = await page.evaluate(() => {
    const now = Date.now();
    const expires = new Date(now + 60_000).toISOString();
    window.sessionStorage.setItem("pubmax:test-preserve-intake", "1");
    window.localStorage.setItem("pubmax:plan-intake:v1", JSON.stringify({
      storageVersion: 1,
      savedAt: new Date(now - 24 * 60 * 60 * 1000 + 60_000).toISOString(),
      expiresAt: expires,
      draft: {
        version: 1,
        currentStep: "time-window",
        settledSteps: ["area"],
        skippedSteps: [],
        completed: false,
        answers: {
          area: "clapham",
          timeWindow: null,
          exactStartIso: null,
          groupSize: null,
          budget: null,
          budgetLimitPence: null,
          accessibilityNeeds: [],
        },
      },
    }));
    return expires;
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "When are you heading out?" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem("pubmax:plan-intake:v1");
    return raw ? JSON.parse(raw).expiresAt as string : null;
  })).toBe(expiresAt);
});

test("a typed exact time rejects an autumn overlap once both occurrences have passed", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-25T01:30:00.000Z"));
  await page.goto("/plan");
  await chooseClaphamAndContinue(page);
  await page.getByRole("button", { name: /Evening/ }).click();

  await page.getByLabel("Exact first pint").fill("2026-10-25T01:30");
  await expect(page.getByLabel("Exact first pint")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("single-value intake fields advance with Enter without submitting the Plan", async ({ page }) => {
  let createRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans") {
      createRequests += 1;
    }
  });

  await page.goto("/plan");
  await chooseClaphamAndContinue(page);
  await page.getByRole("button", { name: /Evening/ }).click();

  const exactTime = page.getByLabel("Exact first pint");
  await expect(exactTime).toBeVisible();
  await exactTime.press("Enter");

  const groupHeading = page.getByRole("heading", { name: "How many people?" });
  await expect(groupHeading).toBeFocused();
  await expect.poll(async () => groupHeading.evaluate((element) => ({
    style: getComputedStyle(element).outlineStyle,
    width: getComputedStyle(element).outlineWidth,
  }))).toEqual({ style: "solid", width: "3px" });

  const groupSize = page.getByLabel("Or enter a group size");
  await groupSize.fill("7");
  await groupSize.press("Enter");
  await expect(page.getByRole("heading", { name: "What should the night cost?" })).toBeFocused();

  const budget = page.getByLabel("Optional ceiling per person");
  await budget.fill("25");
  await budget.press("Enter");
  await expect(page.getByRole("heading", { name: "Any access needs to protect?" })).toBeFocused();
  expect(createRequests).toBe(0);
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.locator(".planComposer__error")).toHaveCount(0);
});

test("editing the exact start marks a generated preview stale", async ({ page }) => {
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
          budget: "standard",
          budgetLimitPence: null,
          zeroProof: false,
          atmosphere: [],
          foodNeeds: [],
          accessibility: [],
          transportConstraints: [],
        },
        routeRevision: 1,
        stops: [
          { venueId: "v1", venueName: "One" },
          { venueId: "v2", venueName: "Two" },
          { venueId: "v3", venueName: "Three" },
        ],
        alternatives: [],
      }),
    });
  });

  await page.goto("/plan");
  await chooseClaphamAndContinue(page);
  await page.getByRole("button", { name: /Evening/ }).click();
  await continueIntake(page);
  await page.getByRole("button", { name: "Describe instead" }).click();
  await page.getByRole("button", { name: "Plan my night" }).click();
  await expect(page.getByText("Three grounded stops, shaped by the editable context below.")).toBeVisible();

  const firstPint = page.getByLabel("First pint");
  await firstPint.fill("2026-07-22T20:00");
  await expect(page.getByText("This route needs a refresh")).toBeVisible();
  await expect(page.locator("#plan-route-status")).toContainText("exact start time changed");
});

test("submission revalidates that the exact start is still in the future", async ({ page }) => {
  let createRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans") {
      createRequests += 1;
    }
  });
  await page.clock.setFixedTime(new Date("2026-07-20T17:00:00.000Z"));
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
          budget: "standard",
          budgetLimitPence: null,
          zeroProof: false,
          atmosphere: [],
          foodNeeds: [],
          accessibility: [],
          transportConstraints: [],
        },
        routeRevision: 1,
        stops: [
          { venueId: "v1", venueName: "One" },
          { venueId: "v2", venueName: "Two" },
          { venueId: "v3", venueName: "Three" },
        ],
        alternatives: [],
      }),
    });
  });

  await page.goto("/plan");
  await chooseClaphamAndContinue(page);
  await page.getByRole("button", { name: /Evening/ }).click();
  await continueIntake(page);
  await page.getByRole("button", { name: "Describe instead" }).click();
  await page.getByRole("button", { name: "Plan my night" }).click();
  await expect(page.getByText("Three grounded stops, shaped by the editable context below.")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");

  await page.clock.setFixedTime(new Date("2026-07-20T18:00:00.000Z"));
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.locator(".planComposer__error")).toContainText("valid future London start time");
  expect(createRequests).toBe(0);
});
