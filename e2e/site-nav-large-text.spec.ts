import { expect, test, type Locator } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { storeThemeChoice } from "./helpers/themeClock";

test.use({ serviceWorkers: "block" });

/** Check the painted text, not only the link's accessible name. */
async function expectWholeLabel(link: Locator) {
  await expect(link).toBeVisible();
  const geometry = await link.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const text = range.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      label: node.textContent?.trim(),
      textLeft: text.left, textRight: text.right,
      left: box.left, right: box.right,
      scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      viewportWidth: innerWidth,
      ownsCentre: hit !== null && node.contains(hit),
    };
  });
  expect(geometry.textLeft, `${geometry.label}: left edge`).toBeGreaterThanOrEqual(geometry.left - 1);
  expect(geometry.textRight, `${geometry.label}: right edge`).toBeLessThanOrEqual(geometry.right + 1);
  expect(geometry.scrollWidth, `${geometry.label}: clipped content`).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.ownsCentre, `${geometry.label}: covered hit target`).toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  for (const fontSize of [16, 32]) {
    for (const width of [390, 1440]) {
      test(`navigation preserves full destinations at ${width}px/${fontSize}px in ${theme}`, async ({ page, context }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await context.route("**/*", (route) => {
          if (["GET", "HEAD"].includes(route.request().method())) return route.continue();
          return route.abort("blockedbyclient");
        });
        await storeThemeChoice(page, theme);
        await page.clock.install({ time: new Date("2026-11-03T18:00:00Z") });
        await page.addInitScript(() => {
          localStorage.setItem("pubmax-tour-v1-done", "1");
          localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
          sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
          sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontSize } });
        await installDeterministicMapBasemap(page);
        await page.goto("/map?wild=1");
        await expectMapLoadingFrameReleased(page);
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
        await info.attach("map-navigation-arrival", { body: await page.screenshot(), contentType: "image/png" });

        const primary = width === 390 ? page.locator(".mobileTabBar") : page.locator(".siteNavLinks");
        const destinations = width === 390
          ? ["/map", "/tonight", "/plan", "/social", "/u/you"]
          : ["/map", "/tonight", "/plan", "/spoons-value", "/social", "/u/you"];
        for (const destination of destinations) {
          const link = primary.locator(`a[href^="${destination}"]`).first();
          await expectWholeLabel(link);
          await link.focus();
          await expect(link).toBeFocused();
        }
        const links = primary.locator("a");
        await links.first().focus();
        for (let index = 1; index < destinations.length; index++) {
          await page.keyboard.press("Tab");
          await expect(links.nth(index)).toBeFocused();
        }

        const header = page.locator(".siteNavBar");
        const headerBox = await header.boundingBox();
        const toolbarBox = await page.locator(".mapToolbar").boundingBox();
        expect(headerBox).not.toBeNull();
        expect(toolbarBox).not.toBeNull();
        expect(toolbarBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
        if (width === 1440) {
          for (const item of [page.locator(".mapSplitListTitle"), page.locator(".mapSplitListRow").first()]) {
            await expect(item).toBeVisible();
            const box = await item.boundingBox();
            expect(box!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
          }
          const lastLink = links.last();
          await lastLink.hover();
          const pill = header.locator(".siteNavGlide");
          await expect(pill).toHaveAttribute("data-visible", "true");
          const linkBox = await lastLink.boundingBox();
          await expect.poll(async () => {
            const box = await pill.boundingBox();
            return box ? Math.max(Math.abs(box.x - linkBox!.x), Math.abs(box.y - linkBox!.y), Math.abs(box.height - linkBox!.height)) : Infinity;
          }).toBeLessThan(1);
          await header.getByRole("button", { name: "More pages", exact: true }).click();
          await expect(page.getByRole("menuitem", { name: /Borough Bingo/ })).toBeVisible();
          await page.keyboard.press("Escape");
        } else {
          await expect(page.getByLabel("Night preview", { exact: true })).toBeVisible();
        }
        await info.attach("map-navigation", { body: await page.screenshot(), contentType: "image/png" });

        await primary.locator('a[href="/tonight"]').click();
        await expect(page).toHaveURL(/\/tonight/);
        await expect(page.locator(".siteNavBar")).toBeVisible();
        const contentHeading = page.getByRole("heading", { level: 1 });
        await expect(contentHeading).toBeVisible();
        const navBox = await page.locator(".siteNavBar").boundingBox();
        const headingBox = await contentHeading.boundingBox();
        expect(headingBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);
        for (const link of await primary.locator("a").all()) await expectWholeLabel(link);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await info.attach("tonight-navigation", { body: await page.screenshot(), contentType: "image/png" });
      });
    }
  }
}
