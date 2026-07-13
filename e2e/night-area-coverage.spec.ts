import { expect, test } from "@playwright/test";

test("mobile planner explains route-ready and capture coverage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });

  const response = await page.goto("/plan");
  expect(response?.status()).toBe(200);

  const coverage = page.locator(".planComposer__coverage");
  await expect(coverage).toBeVisible();
  await expect(coverage.locator("details")).not.toHaveAttribute("open", "");

  await coverage.getByText("Night Area coverage", { exact: true }).click();

  await expect(coverage).toContainText(
    "Route-ready means the required evidence gate is complete and still within its review window.",
  );
  await expect(coverage.getByRole("heading", { name: "Ready to plan now" })).toBeVisible();
  await expect(coverage.getByRole("heading", { name: "Capture, review, and queue" })).toBeVisible();
  await expect(coverage.getByText("Clapham", { exact: true })).toBeVisible();
  await expect(coverage.getByText("Route-ready", { exact: true }).first()).toBeVisible();
  await expect(coverage.getByText("Shoreditch", { exact: true })).toBeVisible();
  await expect(coverage.getByText("Captured", { exact: true }).first()).toBeVisible();
  await expect(coverage.getByText("Discovered", { exact: true }).first()).toBeVisible();
  await expect(coverage.getByText("Reviewed", { exact: true }).first()).toBeVisible();
  await expect(coverage.getByText("Paused", { exact: true })).toBeVisible();
  await expect(coverage).toContainText("Not route-ready yet — missing opening hours and route feasibility + 2 more.");
  await expect(coverage.getByRole("link", { name: "Explore Shoreditch pubs on the map" })).toHaveAttribute(
    "href",
    "/map?q=Shoreditch",
  );
  await expect(coverage.getByText("Last checked 13 Jul 2026 · review through 1 Jan 2027.", { exact: true }).first()).toBeVisible();
  await expect(coverage.getByText("No reviewed snapshot yet.", { exact: true }).first()).toBeVisible();
  await expect(coverage.getByText("Last checked 1 Jan 2026 · review expired 1 Jun 2026.", { exact: true })).toBeVisible();
});

test("mobile planner announces concierge progress while it finds a route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
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

  const concierge = page.locator(".planComposer__concierge");
  await page.getByLabel("Describe the night").fill("A calm, affordable night near Clapham");
  await page.getByRole("button", { name: "Plan my night" }).click();

  await expect(concierge).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Planning…" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("checking route-ready areas");
  releaseGenerate();
  await expect(page.locator(".planComposer__error")).toContainText("The planner is unavailable right now.");
  await expect(concierge).toHaveAttribute("aria-busy", "false");
});

test("mobile planner keeps the inferred Night Area context editable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
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
  await page.getByLabel("Describe the night").fill("A calm night in Clapham for four");
  await page.getByRole("button", { name: "Plan my night" }).click();

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
