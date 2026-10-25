import { expect, test, type Page } from "@playwright/test";

import { installNativeShell } from "./helpers/nativeShell";

async function expectHeaderThemeControl(page: Page, minimumSize = 44) {
  const button = page.locator(".siteNavActions").getByRole("button", {
    name: /Switch to (light|dark) theme/,
  });
  await expect(button).toBeVisible();
  await expect(button).toBeInViewport();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(minimumSize);
  expect(box!.height).toBeGreaterThanOrEqual(minimumSize);
  expect(await button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  // Each visible header control must keep its own tap area.
  const overlaps = await page.locator(".siteNavBar, .lpNav").first().evaluate((header) => {
    const controls = [...header.querySelectorAll("a, button")]
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    return controls.some((box, i) => controls.slice(i + 1).some((other) =>
      Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 &&
      Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1));
  });
  expect(overlaps).toBe(false);
  return button;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const width of [320, 390, 641, 768, 1440]) {
  test(`${width}px: the header exposes a saved theme choice on Home and Tonight`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const button = await expectHeaderThemeControl(page);
    await expect(button).toHaveAccessibleName("Switch to light theme");
    // Retry the tap until hydration attaches the server-painted control.
    await expect(async () => {
      await button.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light", { timeout: 1_000 });
    }).toPass();
    await expect(button).toHaveAccessibleName("Switch to dark theme");
    if (width === 390) await page.screenshot({ path: test.info().outputPath("home-light.png") });
    await page.goto("/tonight");
    await expectHeaderThemeControl(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    if (width === 390) await page.screenshot({ path: test.info().outputPath("tonight-light.png") });
    await page.reload();
    const reloaded = await expectHeaderThemeControl(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await reloaded.focus();
    await reloaded.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("pubmax-theme"))).toBe("dark");
  });
}

for (const platform of ["ios", "android"]) {
  test(`${platform}: the native header respects system appearance until a person chooses`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installNativeShell(page, platform);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax:nativeFirstRun:done:v2", "1");
    });
    await page.goto("/tonight");
    await expect(page.locator("html")).toHaveAttribute("data-native-shell", platform);
    const button = await expectHeaderThemeControl(page, 48);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: test.info().outputPath("native-dark.png") });
    expect(await page.evaluate(() => localStorage.getItem("pubmax-theme"))).toBeNull();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(button).toHaveAccessibleName("Switch to dark theme");
    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.goto("/u/you");
    await expectHeaderThemeControl(page, 48);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expectHeaderThemeControl(page, 48);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
}
