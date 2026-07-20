import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.localStorage.removeItem("pubmax:nightPatch:v1");
    window.sessionStorage.removeItem("pubmax:plan-draft:v1");
  });
});

test("single-value intake fields advance with Enter without submitting the Plan", async ({ page }) => {
  let createRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans") {
      createRequests += 1;
    }
  });

  await page.goto("/plan");
  await page.getByRole("button", { name: "Clapham" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
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
  await page.getByRole("button", { name: "Clapham" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Evening/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Describe instead" }).click();
  await page.getByRole("button", { name: "Plan my night" }).click();
  await expect(page.getByText("Three grounded stops, shaped by the editable context below.")).toBeVisible();

  const firstPint = page.getByLabel("First pint");
  await firstPint.fill("2026-07-22T20:00");
  await expect(page.getByText("This route needs a refresh")).toBeVisible();
  await expect(page.locator("#plan-route-status")).toContainText("exact start time changed");
});
