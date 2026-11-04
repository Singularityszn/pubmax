import { test, expect, type Page } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { mobileMapShellControl, tapMapLogPrice } from "./helpers/mobileMapShell";

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

    // On a phone the planner opens from the map's own Plan a pub crawl
    // action; More map controls holds layers only. The button is server-painted,
    // so retry the tap until the sheet answers (e2e/AGENTS.md).
    const describe = page.getByRole("button", { name: "Plan a pub crawl" });
    const shell = page.locator(".appShell");
    await expect(async () => {
      if (!/planning-open/.test((await shell.getAttribute("class")) ?? "")) {
        await describe.click();
      }
      await expect(shell).toHaveClass(/planning-open/, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.locator(".mapDrawer.left")).toHaveClass(/open/);
    await expect(nav).toHaveCSS("opacity", "1");
    await expect(nav.locator(".mobileTabList")).toHaveCSS("pointer-events", "auto");

    await page.getByRole("button", { name: "Close planner" }).click();
    await expect(page.locator(".appShell")).not.toHaveClass(/planning-open/);
    await expect(nav).toHaveCSS("opacity", "1");
  });

  test("Explore tab routes to /map and exposes the map search control", async ({ page }) => {
    await page.goto("/tonight");

    await primaryNav(page).getByRole("link", { name: "Explore", exact: true }).click();

    await expect(page).toHaveURL(/\/map$/);
    await (await mobileMapShellControl(page, "search")).click();
    await expect(page.getByRole("combobox", { name: "Search pubs" })).toBeVisible();
  });

  // The floating Create left with the five-tab dock (captain, 1 Nov 2026).
  // Log a price is one of the map's own destinations now, in More map
  // controls, and it asks which pub on the city map the reader is on.
  test("Explore logs a price in the city chosen from Places", async ({ page }) => {
    test.slow();
    await installDeterministicMapBasemap(page);
    // Manchester is no longer a row on the list (it has no listed prices), so
    // its panel is reached by its own address.
    await page.goto("/places?city=manchester");
    await page.getByTestId("places-set-city").click();
    await expect(page.getByText("The map and Near now open on Manchester.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create", exact: true })).toHaveCount(0);

    const explore = primaryNav(page).getByRole("link", { name: "Explore", exact: true });
    await expect(explore).toHaveAttribute("href", "/map/manchester");
    await explore.click();
    await expect(page).toHaveURL(/\/map\/manchester$/);
    await tapMapLogPrice(page);
    await expect(page).toHaveURL(/\/map\/manchester\?contribute=price$/);
    const picker = page.getByRole("list", { name: "Pubs near the map centre" });
    await expect(picker).toBeVisible({ timeout: 45_000 });
    await expect(picker.getByRole("button", { name: /The Bank/ })).toBeVisible();
    await expect(picker.getByRole("button", { name: /Dolphin Tavern|Enterprise/ })).toHaveCount(0);
  });

  test("Tonight tab routes to /tonight after 16:00", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-01-15T18:00:00Z"));
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Tonight", exact: true }).click();

    await expect(page).toHaveURL(/\/tonight$/);
    await expect(page.getByTestId("tonight-screen")).toBeVisible();
  });

  test("the dock is five doors in loop order, and Out is Tonight", async ({ page }) => {
    await page.goto("/map");

    const tabs = primaryNav(page).locator(".mobileTab");
    await expect(tabs).toHaveCount(5);
    expect(
      await tabs.evaluateAll((links) => links.map((link) => link.getAttribute("aria-label"))),
    ).toEqual(["Explore", "Tonight", "Plan", "Social", "You"]);
    await expect(primaryNav(page).getByRole("link", { name: "Out", exact: true })).toHaveCount(0);
    await expect(primaryNav(page).getByRole("link", { name: "Places", exact: true })).toHaveCount(0);

    // An old /out link lands on Tonight, which lights the Tonight tab.
    await page.goto("/out");
    await expect(page).toHaveURL(/\/tonight$/);
    await expect(page.getByTestId("tonight-screen")).toBeVisible();
    await expect(
      primaryNav(page).getByRole("link", { name: "Tonight", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  // The Moment composer keeps its route and its way back now that Social and
  // You carry its door (the floating create action left on 1 Nov 2026).
  test("the Moment route opens with its return path", async ({ page }) => {
    await page.goto("/moment?returnTo=%2Fmap");

    await expect(page).toHaveURL(/\/moment\?returnTo=%2Fmap$/);
    await expect(page.getByRole("heading", { name: "Keep this one." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log a Pint Drop" })).toHaveAttribute("href", "/map?log=1");
    await expect(page.getByRole("link", { name: "Back", exact: true })).toHaveAttribute("href", "/map");
  });

  // Captain, 16 Oct 2026: Social is a main tab, and it lights for its aliases.
  test("Social is one tab in the primary row and lights on its aliases", async ({ page }) => {
    await page.goto("/map");

    await expect(primaryNav(page).locator('a[href="/social"]')).toHaveCount(1);
    await page.goto("/feed");
    await expect(primaryNav(page).locator('a[href="/social"]')).toHaveAttribute("aria-current", "page");
  });

  test("You tab routes to the owned profile surface", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "You", exact: true }).click();

    await expect(page).toHaveURL(/\/u\/you$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Claim your @handle." })).toBeVisible();
  });
});
