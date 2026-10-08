import { test, expect, type Page } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

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
  test("keeps computed route clearance while keyboard state hides the bar", async ({ page }) => {
    await page.goto("/privacy");

    const nav = primaryNav(page);
    await expect(nav).toBeVisible();
    const visiblePadding = await page.evaluate(() =>
      getComputedStyle(document.body).paddingBottom,
    );
    expect(Number.parseFloat(visiblePadding)).toBeGreaterThan(0);

    await nav.evaluate((element) => element.classList.add("isKeyboardHidden"));
    await expect(nav).toHaveCSS("opacity", "0");
    const keyboardPadding = await page.evaluate(() =>
      getComputedStyle(document.body).paddingBottom,
    );
    expect(keyboardPadding).toBe(visiblePadding);

    await nav.evaluate((element) => element.classList.remove("isKeyboardHidden"));
    await expect(nav).toHaveCSS("opacity", "1");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).paddingBottom))
      .toBe(visiblePadding);
  });

  test("stays usable while the planner bottom sheet is open", async ({ page }) => {
    await page.goto("/map");

    const nav = primaryNav(page);
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS("opacity", "1");

    // On a phone the planner opens from the map's own Describe the outing
    // action; More map controls holds layers only. The button is server-painted,
    // so retry the tap until the sheet answers (e2e/AGENTS.md).
    const describe = page.getByRole("button", { name: "Describe the outing" });
    const shell = page.locator(".appShell");
    await expect(async () => {
      if (!/planning-open/.test((await shell.getAttribute("class")) ?? "")) {
        await describe.click();
      }
      await expect(shell).toHaveClass(/planning-open/, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.locator(".mapDrawer.left")).toHaveClass(/open/);
    // The sheet portal stops above the dock, so the primary destinations stay
    // visible and tappable under an open map sheet.
    await expect(nav).toHaveCSS("opacity", "1");
    await expect(nav.locator(".mobileTabList")).toHaveCSS("pointer-events", "auto");

    await page.getByRole("button", { name: "Close planner" }).click();
    await expect(page.locator(".appShell")).not.toHaveClass(/planning-open/);
    await expect(nav).toHaveCSS("opacity", "1");
  });

  test("Map tab routes to /map and exposes the map search control", async ({ page }) => {
    await page.goto("/tonight");

    await primaryNav(page).getByRole("link", { name: "Map", exact: true }).click();

    await expect(page).toHaveURL(/\/map$/);
    await page.getByRole("button", { name: "Search the map" }).click();
    await expect(page.getByRole("combobox", { name: "Search pubs" })).toBeVisible();
  });

  test("Create logs a price in the city chosen from Places", async ({ page }) => {
    test.slow();
    await installDeterministicMapBasemap(page);
    await page.goto("/places");
    await page.getByRole("link", { name: /Manchester/ }).click();
    await expect(page).toHaveURL(/\/places\?city=manchester$/);
    await page.getByTestId("places-set-city").click();
    await expect(page.getByText("The map, Out and Near now open on Manchester.")).toBeVisible();

    const create = page.getByRole("button", { name: "Create", exact: true });
    await create.click();
    const price = page.getByRole("link", { name: "Log a price", exact: true });
    await expect(price).toHaveAttribute("href", "/map/manchester?contribute=price");

    const otherTab = await page.context().newPage();
    await otherTab.goto("/places?city=london");
    await otherTab.getByTestId("places-set-city").click();
    await expect(price).toHaveAttribute("href", "/map?contribute=price");
    await otherTab.goto("/places?city=manchester");
    await otherTab.getByTestId("places-set-city").click();
    await expect(price).toHaveAttribute("href", "/map/manchester?contribute=price");
    await otherTab.close();

    await price.click();
    await expect(page).toHaveURL(/\/map\/manchester\?contribute=price$/);
    const picker = page.getByRole("list", { name: "Pubs near the map centre" });
    await expect(picker).toBeVisible({ timeout: 45_000 });
    await expect(picker.getByRole("button", { name: /The Bank/ })).toBeVisible();
    await expect(picker.getByRole("button", { name: /Dolphin Tavern|Enterprise/ })).toHaveCount(0);
  });

  test("Tonight tab routes to /tonight", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Tonight", exact: true }).click();

    await expect(page).toHaveURL(/\/tonight$/);
    await expect(page.getByTestId("tonight-screen")).toBeVisible();
  });

  test("Out tab routes to /out", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Out", exact: true }).click();

    await expect(page).toHaveURL(/\/out$/);
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "What’s on tonight." })).toBeVisible();
  });

  test("create action opens Moment with the live return path", async ({ page }) => {
    await page.goto("/map");

    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name: "Post a moment", exact: true }).click();

    await expect(page).toHaveURL(/\/moment\?returnTo=%2Fmap$/);
    await expect(page.getByRole("heading", { name: "Keep this one." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log a Pint Drop" })).toHaveAttribute("href", "/map?log=1");
    await expect(page.getByRole("link", { name: "Back", exact: true })).toHaveAttribute("href", "/map");
  });

  test("gated Social stays out of the primary tab row", async ({ page }) => {
    await page.goto("/map");

    await expect(primaryNav(page).locator('a[href="/social"]')).toHaveCount(0);
  });

  test("You tab routes to the owned profile surface", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "You", exact: true }).click();

    await expect(page).toHaveURL(/\/u\/you$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Make the night yours." })).toBeVisible();
  });
});
