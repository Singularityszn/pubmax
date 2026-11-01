import { expect, test } from "@playwright/test";
import { installNativeShell } from "./helpers/nativeShell";

// The main tab uses the clock. The two page links remain explicit choices.
test.use({ viewport: { width: 390, height: 844 }, timezoneId: "America/New_York" });

const dock = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Primary", exact: true });

test("the main Tonight tab opens Day before 16:00 in London", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-15T14:59:59.000Z"));
  await page.goto("/today");
  await expect(dock(page).getByRole("link", { name: "Tonight", exact: true })).toHaveAttribute("href", "/today");
  await dock(page).getByRole("link", { name: "Tonight", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("navigation", { name: "Now", exact: true }).getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
});

for (const [time, target] of [
  ["2026-01-15T16:00:00Z", "/tonight"],
  ["2026-07-15T15:00:00Z", "/tonight"],
  ["2026-03-29T14:59:59Z", "/today"],
  ["2026-03-29T15:00:00Z", "/tonight"],
  ["2026-10-25T15:59:59Z", "/today"],
  ["2026-10-25T16:00:00Z", "/tonight"],
  ["2026-07-16T08:00:00Z", "/today"],
  ["2026-01-15T00:00:00Z", "/tonight"],
  ["2026-01-15T03:59:59Z", "/tonight"],
  ["2026-01-15T04:00:00Z", "/today"],
  ["2026-07-15T23:00:00Z", "/tonight"],
  ["2026-07-16T02:59:59Z", "/tonight"],
  ["2026-07-16T03:00:00Z", "/today"],
] as const) {
  test(`the main tab uses ${target} at ${time} from a device abroad`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(time));
    await page.goto("/today");
    const tab = dock(page).getByRole("link", { name: "Tonight", exact: true });
    await expect(tab).toHaveAttribute("href", target);
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(tab).toHaveAttribute("aria-current", "page");
  });
}

test("explicit links and manual choices survive the automatic cutoff and reload", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-15T14:58:00Z") });
  await page.goto("/tonight?day=tomorrow#tonight-list");
  const segment = page.getByRole("navigation", { name: "Now", exact: true });
  const tab = dock(page).getByRole("link", { name: "Tonight", exact: true });
  await expect(tab).toHaveAttribute("href", "/today");
  await expect(page).toHaveURL(/\/tonight\?day=tomorrow#tonight-list$/);
  await expect(segment.getByRole("link", { name: "Tonight", exact: true })).toHaveAttribute("aria-current", "page");
  await segment.getByRole("link", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.clock.pauseAt(new Date("2026-07-15T14:59:59Z"));
  await page.clock.runFor(1_000);
  await expect(tab).toHaveAttribute("href", "/tonight");
  await expect(page).toHaveURL(/\/today$/);
  await page.reload();
  await expect(segment.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
  await segment.getByRole("link", { name: "Tonight", exact: true }).click();
  await expect(page).toHaveURL(/\/tonight$/);
});

test("desktop and landing links use the same daytime default", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-07-15T08:00:00Z"));
  await page.goto("/");
  const landing = page.getByRole("navigation", { name: "Landing navigation", exact: true });
  await expect(landing.getByRole("link", { name: "Tonight", exact: true })).toHaveAttribute("href", "/today");
  await landing.getByRole("link", { name: "Tonight", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  const desktop = page.getByRole("navigation", { name: "Site navigation", exact: true });
  await expect(desktop.getByRole("link", { name: "Tonight", exact: true })).toHaveAttribute("href", "/today");
  await expect(desktop.getByRole("link", { name: "Tonight", exact: true })).toHaveAttribute("aria-current", "page");
});

for (const instant of ["2026-01-15T03:59:59Z", "2026-07-16T02:59:59Z"]) {
  test(`the main link changes at the 04:00 service rollover without rerouting at ${instant}`, async ({ page }) => {
    await page.clock.install({ time: new Date(Date.parse(instant) - 120_000) });
    await page.goto("/tonight");
    const tab = dock(page).getByRole("link", { name: "Tonight", exact: true });
    await page.clock.pauseAt(new Date(instant));
    await expect(tab).toHaveAttribute("href", "/tonight");
    await page.clock.runFor(1_000);
    await expect(tab).toHaveAttribute("href", "/today");
    await expect(page).toHaveURL(/\/tonight$/);
    await expect(page.getByRole("navigation", { name: "Now", exact: true }).getByRole("link", { name: "Tonight", exact: true }))
      .toHaveAttribute("aria-current", "page");
  });
}

for (const platform of ["ios", "android"] as const) {
  test(`a returning ${platform} launch keeps Home and the chosen city before opening Day`, async ({ page }) => {
    await installNativeShell(page, platform);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax:nativeFirstRun:done:v2", "1");
      localStorage.setItem("pubmax:preferredCity:v1", "glasgow");
    });
    await page.clock.setFixedTime(new Date("2026-07-15T08:00:00Z"));
    await page.goto("/app-entry");
    await expect(page).toHaveURL(/\/$/);
    const tab = dock(page).getByRole("link", { name: "Tonight", exact: true });
    await expect(tab).toHaveAttribute("href", "/today");
    await expect(page.locator("html")).toHaveAttribute("data-native-shell", platform);
    await expect(dock(page).getByRole("link", { name: "Explore", exact: true })).toHaveAttribute("href", "/map/glasgow");
    await tab.click();
    await expect(page).toHaveURL(/\/today$/);
    expect(await page.evaluate(() => localStorage.getItem("pubmax:preferredCity:v1"))).toBe("glasgow");
  });
}
