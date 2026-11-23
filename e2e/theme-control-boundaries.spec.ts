import { expect, test } from "@playwright/test";

import { desktopVenueDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { openHeaderThemeControl } from "./helpers/headerThemeControl";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { holdLondonAfternoon } from "./helpers/themeClock";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

// Oracle: the theme repair must preserve the independent Day/Tonight route,
// follow the system without a saved choice, and accept keyboard activation.
// The system decides by day; London's night default would answer instead.
test.beforeEach(async ({ page }) => {
  await holdLondonAfternoon(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const width of [390, 1440]) {
  test(`${width}px: keyboard theme changes preserve Day and Tonight selection`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/today");
    const button = await openHeaderThemeControl(page);
    await expect(button).toHaveAccessibleName(/^Switch to light theme/);
    await expect(button).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Escape");
    const more = page.getByRole("navigation", { name: "Site navigation" }).getByRole("button", { name: "More pages", exact: true });
    await more.focus();
    await more.press("ArrowUp");
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    await page.screenshot({ path: test.info().outputPath("day-dark-keyboard-focus.png") });
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page).toHaveURL(/\/today$/);
    const now = page.getByRole("navigation", { name: "Now", exact: true });
    await expect(now.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
    await now.getByRole("link", { name: "Tonight", exact: true }).click();
    await expect(page).toHaveURL(/\/tonight$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const darkButton = await openHeaderThemeControl(page);
    await expect(darkButton).toHaveAccessibleName(/^Switch to dark theme/);
    await darkButton.focus();
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page).toHaveURL(/\/tonight$/);
    await expect(now.getByRole("link", { name: "Tonight", exact: true })).toHaveAttribute("aria-current", "page");
    await now.getByRole("link", { name: "Day", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: test.info().outputPath("day-dark-saved.png") });
  });
}

test("a fresh web visitor follows system appearance without saving a choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/tonight");
  await expect(await openHeaderThemeControl(page)).toHaveAccessibleName(/^Switch to dark theme/);
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("pubmax-theme"))).toBeNull();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(await openHeaderThemeControl(page)).toHaveAccessibleName(/^Switch to light theme/);
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("pubmax-theme"))).toBeNull();
});

test("a visitor with blocked preference storage can still switch the visible theme", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "pubmax-theme") throw new DOMException("Storage blocked", "SecurityError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/tonight");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const button = await openHeaderThemeControl(page);
  await expect(button).toHaveAccessibleName(/^Switch to light theme/);
  await expect(async () => {
    await (await openHeaderThemeControl(page)).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light", { timeout: 1000 });
  }).toPass();
  await expect(await openHeaderThemeControl(page)).toHaveAccessibleName(/^Switch to dark theme/);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => localStorage.getItem("pubmax-theme"))).toBeNull();
  await page.screenshot({ path: test.info().outputPath("blocked-storage-light.png") });
  await page.getByRole("navigation", { name: "Now", exact: true }).getByRole("link", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(await openHeaderThemeControl(page)).toHaveAccessibleName(/^Switch to dark theme/);
  await page.keyboard.press("Escape");
});

test("a signed-out phone reader keeps Appearance and the header in sync", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/u/you");
  const appearance = page.getByTestId("appearance-pref");
  await expect(appearance).toBeVisible();
  await appearance.getByRole("button", { name: "Switch to light theme", exact: true }).click();
  await expect(await openHeaderThemeControl(page)).toHaveAccessibleName(/^Switch to dark theme/);
  await expect(appearance).toContainText("Light theme on this device.");
  await (await openHeaderThemeControl(page)).click();
  await expect(appearance.getByRole("button", { name: "Switch to light theme", exact: true })).toBeVisible();
  await expect(appearance).toContainText("Dark theme on this device.");
  await appearance.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("you-appearance-dark.png") });
});

test.describe("the map header beside a selected pub", () => {
  test("a desktop reader changes theme without closing the selected pub", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?sel=venue-xjf3n0");
    await expectSoleDesktopDrawer(page, "venue");
    await expectMapLoadingFrameReleased(page);
    const button = await openHeaderThemeControl(page);
    await expect(button).toHaveAccessibleName(/^Switch to light theme/);
    await expect(button).toBeVisible();
    await (await openHeaderThemeControl(page)).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expectSoleDesktopDrawer(page, "venue");
    await expect(desktopVenueDrawer(page)).toBeVisible();
    await expect(page).toHaveURL(/sel=venue-xjf3n0/);
    await expectMapLoadingFrameReleased(page);
    // A light surface must finish with dark heading text, not the previous
    // theme's near-white ink. Wait for the rendered colours before the shot.
    const heading = desktopVenueDrawer(page).getByRole("heading", { name: "Arnos Arms", exact: true });
    await expect.poll(() => heading.evaluate((element) => {
      const channels = getComputedStyle(element).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      return channels?.length === 3 && channels.every((channel) => channel < 128);
    })).toBe(true);
    await page.screenshot({ path: test.info().outputPath("map-selected-pub-light.png"), animations: "disabled" });
  });
});
