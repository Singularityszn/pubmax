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

    await page.getByRole("button", { name: "More map controls" }).click();
    await page.getByRole("button", { name: "Plan an outing" }).click();
    await expect(page.locator(".appShell")).toHaveClass(/planning-open/);
    await expect(page.locator(".mapDrawer.left")).toHaveClass(/open/);
    await expect(nav).toHaveCSS("opacity", "0");
    await expect(nav).toHaveCSS("pointer-events", "none");

    await page.getByRole("button", { name: "Close planner" }).click();
    await expect(page.locator(".appShell")).not.toHaveClass(/planning-open/);
    await expect(nav).toHaveCSS("opacity", "1");
  });

  test("Map tab routes to /map and exposes the map search control", async ({ page }) => {
    await page.goto("/tonight");

    await primaryNav(page).getByRole("link", { name: "Map", exact: true }).click();

    await expect(page).toHaveURL(/\/map$/);
    await page.getByRole("button", { name: "Search the map" }).click();
    await expect(page.getByRole("searchbox", { name: "Search pubs" })).toBeVisible();
  });

  test("Tonight tab routes to /tonight and exposes the tonight screen", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Tonight", exact: true }).click();

    await expect(page).toHaveURL(/\/tonight$/);
    await expect(page.getByTestId("tonight-screen")).toBeVisible();
  });

  test("Moment opens the capture chooser without silently returning to the map", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Moment", exact: true }).click();

    await expect(page).toHaveURL(/\/moment\?returnTo=%2Fmap$/);
    await expect(page.getByRole("heading", { name: "Keep this one." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log a Pint Drop" })).toHaveAttribute("href", "/map?log=1");
    await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/map");
  });

  test("Stories routes directly to the social feed", async ({ page }) => {
    await page.goto("/map");

    const stories = primaryNav(page).getByRole("link", { name: "Stories", exact: true });
    await stories.click();

    await expect(page).toHaveURL(/\/feed$/);
    await expect(page.getByRole("heading", { name: "Stories", exact: true })).toBeVisible();
    // Active-state contract: landing on /feed must light Stories (aria-current
    // + isActive), not leave the bar with no current tab.
    await expect(stories).toHaveAttribute("aria-current", "page");
    await expect(stories).toHaveClass(/isActive/);
  });

  test("You tab routes to the owned profile surface", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "You", exact: true }).click();

    await expect(page).toHaveURL(/\/u\/you$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Make the night yours." })).toBeVisible();
  });
});
