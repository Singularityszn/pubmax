import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { uiUxChromiumProjectUse } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

test.use(uiUxChromiumProjectUse(process.env.UI_UX_BROWSER_CHANNEL));

const KINGSTON = "Kingston Market Place closed following fire";
const KINGSTON_ROUTE = "/map?mode=build&pubs=venue-ydvsco%2Cvenue-122zap1";

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1440]) {
    test(`${width}px ${theme} news follows the viewed area and leaves route and modal controls clear`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await installDeterministicMapBasemap(page);
      await page.addInitScript((choice) => {
        localStorage.setItem("pubmax-theme", choice);
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      }, theme);
      await page.route("**/api/citymcp/status**", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ asOf: "2026-10-08T11:00:00Z", signals: [{
          headline: KINGSTON, severity: "major", kind: "alert", areas: ["Kingston"],
          sourceUrl: "https://example.com/kingston-fire",
        }], tubeLines: [], weather: null }),
      }));

      const initialStatus = width === 1440 ? page.waitForResponse("**/api/citymcp/status**") : null;
      await page.goto("/map");
      await initialStatus;
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
      const cityDismiss = page.getByRole("button", { name: "Dismiss city suggestion" });
      if (await cityDismiss.isVisible()) {
        await expect(async () => {
          await cityDismiss.click();
          await expect(cityDismiss).toBeHidden({ timeout: 1_000 });
        }).toPass({ timeout: 30_000 });
      }
      await expect(page.locator(".cityStatusBannerCopy")).toHaveCount(0);

      // Choose the actual public place through the visible map controls.
      const choose = page.locator(".citySwitcherTrigger").filter({ visible: true });
      await expect(async () => {
        await choose.click();
        await expect(page.getByRole("button", { name: "This area", exact: true })).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      await page.getByRole("button", { name: "This area", exact: true }).click();
      const areaSearch = page.getByRole("searchbox", { name: "Search areas and postcodes" });
      await expect(areaSearch).toBeVisible();
      await areaSearch.fill("Kingston");
      await page.locator(".chooseAreaSheet").filter({ visible: true }).getByRole("button", {
        name: "Kingston upon Thames", exact: true,
      }).click();
      await expect(areaSearch).toBeHidden();
      await expect(choose).toHaveAttribute("aria-label", /Map area: Kingston upon Thames/i);
      const banner = page.locator(".cityStatusBannerCopy");
      if (width === 390) {
        await expect(banner).toHaveCount(0);
      } else {
        await expect(banner).toHaveText(KINGSTON, { timeout: 45_000 });
        await expect(banner).toBeVisible();
        await page.locator(".cityStatusBannerLink").click();
        await expect(page.locator(".cityStatusSignalSheet")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".cityStatusSignalSheet")).toHaveCount(0);
      }
      await page.screenshot({ path: `artifacts/area-news-toast/fixture-${width}-${theme}-kingston.png` });

      await page.keyboard.press("Control+k");
      const modal = page.getByRole("dialog", { name: "Command palette" });
      await expect(modal).toBeVisible();
      await expect(modal).toHaveAttribute("aria-modal", "true");
      if (width === 1440) expect(await page.evaluate(() => {
        const toast = document.querySelector(".cityStatusBannerLink");
        if (!toast || toast.getBoundingClientRect().height === 0) return false;
        const box = toast.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !toast.contains(hit);
      })).toBe(true);
      await page.keyboard.press("Tab");
      await expect(modal.getByRole("combobox", { name: "Search commands" })).toBeFocused();
      await page.screenshot({ path: `artifacts/area-news-toast/fixture-${width}-${theme}-modal.png` });
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);

      await page.goto(KINGSTON_ROUTE);
      if (width === 1440) {
        await expect(banner).toHaveText(KINGSTON, { timeout: 45_000 });
        await expect(banner).toBeVisible();
      }
      const edit = width === 390
        ? page.getByRole("button", { name: "Edit active 2-stop plan" })
        : page.locator(".mappedRouteChip").getByRole("button", { name: "Edit", exact: true });
      await expect(edit).toBeVisible({ timeout: 45_000 });
      await expect(async () => {
        await edit.click();
        await expect(page.locator(".routeList").filter({ visible: true })).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      const stop = page.locator(".routeList").filter({ visible: true }).locator("li > button").first();
      if (width === 1440) {
        await expect(banner).toHaveText(KINGSTON);
        await expect(banner).toBeVisible();
      }
      await stop.scrollIntoViewIfNeeded();
      await expect(stop).toBeVisible();
      await page.screenshot({ path: `artifacts/area-news-toast/fixture-${width}-${theme}-route-editor.png` });
      expect(await stop.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await stop.click();
      await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe("venue-ydvsco");
      await page.screenshot({ path: `artifacts/area-news-toast/fixture-${width}-${theme}-route-stop.png` });

      // A new route visit must not carry Kingston's old place or expanded feed.
      await page.goto("/tonight");
      await page.goto("/map?mode=build&pubs=venue-yl1a48%2Cvenue-1vle947");
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
      await expect(choose).not.toHaveAttribute("aria-label", /Kingston/i);
      await expect(banner).toHaveCount(0);
      await expect(page.locator(".cityStatusSignalSheet")).toHaveCount(0);
      await choose.click();
      await page.getByRole("button", { name: "This area", exact: true }).click();
      await areaSearch.fill("Soho");
      await page.locator(".chooseAreaSheet").filter({ visible: true }).getByRole("button", {
        name: /^Piccadilly & Soho/,
      }).click();
      await expect(choose).toHaveAttribute("aria-label", /Map area: Piccadilly & Soho/i);
      await expect(banner).toHaveCount(0);
      // The previously read status may come from the normal session cache.
      await page.goto("/map");
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
      await expect(choose).not.toHaveAttribute("aria-label", /Kingston/i);
      await expect(banner).toHaveCount(0);
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`1440px ${theme} Near me keeps its label and shows news for the settled locality`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.504, longitude: -0.082 });
    await installDeterministicMapBasemap(page);
    await page.addInitScript((choice) => {
      localStorage.setItem("pubmax-theme", choice);
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    }, theme);
    await page.route("**/api/citymcp/status**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ signals: [{
        headline: "Bermondsey fire", severity: "major", areas: ["Bermondsey"],
        sourceUrl: "https://example.com/bermondsey-fire",
      }], tubeLines: [], weather: null }),
    }));
    const initialStatus = page.waitForResponse("**/api/citymcp/status**");
    await page.goto("/map");
    await initialStatus;
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    const cityDismiss = page.getByRole("button", { name: "Dismiss city suggestion" });
    if (await cityDismiss.isVisible()) {
      await expect(async () => {
        await cityDismiss.click();
        await expect(cityDismiss).toBeHidden({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
    }
    const choose = page.locator(".citySwitcherTrigger").filter({ visible: true });
    await expect(async () => {
      await choose.click();
      await expect(page.getByRole("button", { name: "This area", exact: true })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "This area", exact: true }).click();
    const areaSheet = page.locator(".chooseAreaSheet").filter({ visible: true });
    await expect(areaSheet).toBeVisible();
    await areaSheet.getByRole("button", { name: "Near me", exact: true }).click();
    await expect(areaSheet).toBeHidden();
    await expect(choose).toHaveAttribute("aria-label", /Map area: Near me/i);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(page.locator(".cityStatusBannerCopy")).toHaveText("Bermondsey fire", { timeout: 30_000 });
    await expect(page.locator(".cityStatusBannerCopy")).toBeVisible();
    await expect(choose).toHaveAttribute("aria-label", /Map area: Near me/i);
    await page.locator(".cityStatusBannerLink").click();
    await expect(page.locator(".cityStatusSignalRowHeadline")).toHaveText("Bermondsey fire");
    await expect(page.locator(".cityStatusSignalRowSource a")).toHaveAttribute("href", "https://example.com/bermondsey-fire");
    await page.keyboard.press("Escape");
    await choose.click();
    await page.getByRole("button", { name: "This area", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search areas and postcodes" }).fill("Soho");
    await page.locator(".chooseAreaSheet").filter({ visible: true }).getByRole("button", { name: /^Piccadilly & Soho/ }).click();
    await expect(choose).toHaveAttribute("aria-label", /Map area: Piccadilly & Soho/i);
    await expect(page.locator(".cityStatusBannerCopy")).toHaveCount(0);
    await expect(page.locator(".cityStatusSignalSheet")).toHaveCount(0);
  });
}
