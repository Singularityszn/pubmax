import { test, expect, type Page } from "@playwright/test";

// Mobile bottom-tab navigation coverage. The assertions deliberately target
// route DOM and accessible controls, never MapLibre's canvas or WebGL state.

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // Keep the global first-run tour from intercepting the tab bar.
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    // Keep the map's separate, session-scoped story overlay from intercepting
    // the same tab bar when a test starts on /map.
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test.describe("mobile bottom-tab navigation", () => {
  test("hides while the planner bottom sheet owns the bottom edge", async ({ page }) => {
    await page.goto("/map");

    const nav = primaryNav(page);
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS("opacity", "1");

    await page.getByRole("button", { name: "Plan tonight" }).click();
    await expect(page.locator(".appShell")).toHaveClass(/planning-open/);
    await expect(page.locator(".mapDrawer.left")).toHaveClass(/open/);
    await expect(nav).toHaveCSS("opacity", "0");
    await expect(nav).toHaveCSS("pointer-events", "none");

    await page.getByRole("button", { name: "View London map" }).click();
    await expect(page.locator(".appShell")).not.toHaveClass(/planning-open/);
    await expect(nav).toHaveCSS("opacity", "1");
  });

  test("Map tab routes to /map and exposes the map search control", async ({ page }) => {
    await page.goto("/pubs");

    await primaryNav(page).getByRole("link", { name: "Map", exact: true }).click();

    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByLabel("Search pubs by name, area, borough or drink")).toBeVisible();
  });

  test("Pubs tab routes to /pubs and exposes the pubs heading", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Pubs", exact: true }).click();

    await expect(page).toHaveURL(/\/pubs$/);
    await expect(
      page.getByRole("heading", { name: "Pubs with a drink on every card", exact: true }),
    ).toBeVisible();
  });

  test("Pint Drop tab routes to /map?log=1 and opens the drop intent surface", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Pint Drop", exact: true }).click();

    await expect(page).toHaveURL(/\/map\?log=1$/);
    const composer = page.getByRole("form", { name: "Pint Drop composer" });
    const fallback = page.locator(".logIntentFallback");
    await expect
      .poll(async () => (await composer.isVisible()) || (await fallback.isVisible()), {
        timeout: 15_000,
      })
      .toBe(true);
    if (await composer.isVisible()) {
      await expect(composer).toBeVisible();
    } else {
      await expect(fallback).toContainText("Pick a pub to log a Pint Drop");
    }
  });

  test("Pint stories tab routes to /discover and exposes the story headline", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page)
      .getByRole("link", { name: "Pint stories", exact: true })
      .click();

    await expect(page).toHaveURL(/\/discover$/);
    await expect(
      page.getByRole("heading", { name: "There is a story behind every pint.", exact: true }),
    ).toBeVisible();
  });

  test("You tab routes to /u/you and exposes the profile heading", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "You", exact: true }).click();

    await expect(page).toHaveURL(/\/u\/you$/);
    // The anonymous profile can fall back to its error-state header when the
    // optional Pint Drops API is unavailable; the route's own heading remains
    // stable in both states.
    await expect(page.getByRole("heading", { name: "You", exact: true })).toBeVisible();
  });
});
