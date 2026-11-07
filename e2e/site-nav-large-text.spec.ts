import { expect, test, type Locator, type Page } from "@playwright/test";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased, expectMobileMapShellReady, mobileMapShellControl } from "./helpers/mobileMapShell";
import { storeThemeChoice } from "./helpers/themeClock";

test.use({ serviceWorkers: "block" });

async function expectHitTarget(link: Locator) {
  await expect(link).toBeVisible();
  const geometry = await link.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      label: node.textContent?.trim(),
      left: box.left, right: box.right,
      top: box.top, bottom: box.bottom,
      width: box.width, height: box.height,
      scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      ownsCentre: hit !== null && node.contains(hit),
    };
  });
  expect(geometry.scrollWidth, `${geometry.label}: clipped content`).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.scrollHeight, `${geometry.label}: clipped height`).toBeLessThanOrEqual(geometry.clientHeight + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.ownsCentre, `${geometry.label}: covered hit target`).toBe(true);
  return geometry;
}

async function expectWholeLabel(link: Locator, paintedLabel: Locator = link) {
  const geometry = await expectHitTarget(link);
  const textRects = await paintedLabel.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const rects = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      const { left, right, top, bottom, width, height } = range.getBoundingClientRect();
      rects.push({ left, right, top, bottom, width, height });
    }
    return rects;
  });
  expect(textRects.length, `${geometry.label}: painted label`).toBeGreaterThan(0);
  for (const text of textRects) {
    expect(text.width).toBeGreaterThan(0);
    expect(text.height).toBeGreaterThan(0);
    expect(text.left, `${geometry.label}: left edge`).toBeGreaterThanOrEqual(geometry.left - 1);
    expect(text.right, `${geometry.label}: right edge`).toBeLessThanOrEqual(geometry.right + 1);
    expect(text.top, `${geometry.label}: top edge`).toBeGreaterThanOrEqual(geometry.top - 1);
    expect(text.bottom, `${geometry.label}: bottom edge`).toBeLessThanOrEqual(geometry.bottom + 1);
  }
}

// At a large browser text size the phone tab bar shows its icons alone, as it
// does in the native shell (public/theme-init.js publishes the same
// data-text-scale bucket). Each door keeps its icon, its accessible name and
// its whole hit target, and no label is painted to break inside a word.
async function expectIconDoor(link: Locator) {
  await expectHitTarget(link);
  await expect(link.locator(".mobileTabIcon svg")).toBeVisible();
  await expect(link.locator(".mobileTabLabel")).toBeHidden();
}

async function expectDestinations(page: Page, primary: Locator, destinations: string[], iconOnly = false) {
  const links = primary.locator("a");
  await expect(links).toHaveCount(destinations.length);
  for (const destination of destinations) {
    const link = primary.locator(`a[href^="${destination}"]`).first();
    if (iconOnly) await expectIconDoor(link);
    else await expectWholeLabel(link);
    await expect(link).toHaveAccessibleName(/\S/);
    await link.focus();
    await expect(link).toBeFocused();
  }
  await links.first().focus();
  for (let index = 1; index < destinations.length; index++) {
    await page.keyboard.press("Tab");
    await expect(links.nth(index)).toBeFocused();
  }
}

async function expectMapClearance(page: Page, width: number, largeText = false) {
  if (width === 390) {
    await expectMobileMapShellReady(page);
    const topbar = page.locator(".mobileMapTopbar");
    const topbarBox = await topbar.boundingBox();
    expect(topbarBox).not.toBeNull();
    expect(topbarBox!.x).toBeGreaterThanOrEqual(0);
    expect(topbarBox!.x + topbarBox!.width).toBeLessThanOrEqual(width);
    const brand = topbar.getByRole("link", { name: "Open PUBMAXX landing page", exact: true });
    if (largeText) await expect(topbar.locator(".mobileMapBrand")).toBeHidden();
    const city = topbar.locator(".citySwitcherTrigger");
    const controls = [
      ...(largeText ? [] : [brand]),
      city,
      await mobileMapShellControl(page, "search"),
      await mobileMapShellControl(page, "filters"),
      await mobileMapShellControl(page, "more"),
    ];
    let previousRight = topbarBox!.x;
    for (const control of controls) {
      await expectHitTarget(control);
      await expect(control).toHaveAccessibleName(/\S/);
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(previousRight - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(topbarBox!.x + topbarBox!.width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(topbarBox!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(topbarBox!.y + topbarBox!.height + 1);
      previousRight = box!.x + box!.width;
    }
    if (!largeText) await expectWholeLabel(brand, brand.locator(".pubmaxxWordmarkLetters"));
    await expectWholeLabel(city, city.locator(".citySwitcherLabelFull"));
    return;
  }
  // Map arrivals can replace the first keyed row between visibility and
  // rectangle reads. Re-read every required rectangle together after a redraw.
  await expect(async () => {
    const header = page.locator(".siteNavBar");
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    for (const item of [page.locator(".mapToolbar"), page.locator(".mapSplitListTitle"), page.locator(".mapSplitListRow").first()]) {
      await expect(item).toBeVisible();
      const box = await item.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    }
  }).toPass({ timeout: 10_000 });
}

async function expectPreviewState(page: Page, width: number, selected: boolean) {
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pubmax-wild"))).toBe(selected ? "1" : null);
  if (width === 390) {
    const picker = page.getByLabel("Night preview", { exact: true });
    if (selected) {
      await expect(picker).toBeVisible();
      await expect(picker).toHaveValue("borough-bingo");
    } else {
      await expect(picker).toHaveCount(0);
    }
  } else {
    const trigger = page.getByRole("button", { name: "More pages", exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const menu = page.getByRole("menu", { name: "More pages", exact: true });
    await expect(menu).toBeVisible();
    if (selected) {
      await expect(menu.getByRole("menuitem", { name: /^Borough Bingo/ })).toContainText("Selected on this browser");
    } else {
      for (const name of [/^Previews off/, /^Round Rota/, /^Borough Bingo/]) {
        await expect(menu.getByRole("menuitem", { name })).toHaveCount(0);
      }
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pubmax-wild-night-preview"))).toBe("borough-bingo");
}

// The wrap above is for enlarged text only. At default text an inner page's
// bar holds one row from 1024px up: the brand, every door and every utility
// share one line, and the bar is no taller than one 44px target plus its
// padding. The 1100px cap once wrapped every inner page onto two rows from
// 1280px, and the laptop band (1024px to 1279px, an iPad held sideways at 1024
// and 1180) wrapped until its Pal and More doors took their compact shape.
for (const width of [1024, 1100, 1180, 1280, 1440, 1920]) {
  for (const signedIn of [false, true]) {
    test(`inner-page navigation is one row at ${width}px at default text, ${signedIn ? "signed in with a 10ch Pal name" : "signed out"}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await storeThemeChoice(page, "light");
      await page.addInitScript(() => {
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      });
      const palName = "WWWWWWWWWW";
      if (signedIn) {
        await installAuthDoubles(page);
        const now = "2026-11-06T12:00:00.000Z";
        const pal = {
          ...DEFAULT_PAL_DRAFT,
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          ownerId: ACCOUNTS.A.id,
          name: palName,
          adultAttestedAt: now,
          muted: false,
          hidden: false,
          proposalPreferences: {},
          masteryPoints: 0,
          createdAt: now,
          updatedAt: now,
        };
        await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal, adultOnFile: true } }));
        await page.addInitScript((storedPal) => {
          localStorage.setItem("pubmax_account_owner", storedPal.ownerId);
          localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(storedPal));
        }, pal);
        await seedSignedIn(page, "A");
      }
      for (const path of ["/plan", "/tonight"]) {
        await page.goto(path);
        const header = page.locator(".siteNavBar");
        await expect(header).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("16px");
        if (signedIn) {
          const pal = header.getByRole("link", { name: `Pub Pal, ${palName}`, exact: true });
          await expect(pal).toBeVisible();
          await expect(pal).toHaveText(palName);
          await expect(header.getByRole("button", { name: /Account options/ })).toBeVisible();
          await expectHitTarget(header.locator('a[href="/activity"]'));
          await expectHitTarget(header.locator('a[href="/messages"]'));
          await expectHitTarget(pal);
          const label = pal.locator(".siteNavPalName");
          const truncation = await label.evaluate((node) => ({
            width: node.getBoundingClientRect().width,
            clientWidth: node.clientWidth,
            contentWidth: node.scrollWidth,
            overflow: getComputedStyle(node).textOverflow,
          }));
          if (width < 1280) {
            // The laptop band shows the Pal's face alone, a 44px disc like
            // More, and keeps the name in the door's accessible name.
            expect(truncation.width).toBeLessThanOrEqual(1);
            expect((await pal.boundingBox())!.width).toBeLessThanOrEqual(45);
          } else {
            expect(truncation.clientWidth).toBeGreaterThan(0);
            expect(truncation.contentWidth).toBeGreaterThan(truncation.clientWidth);
            expect(truncation.overflow).toBe("ellipsis");
          }
        }
        const row = await header.evaluate((bar) => {
          const centre = (node: Element) => {
            const box = node.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, middle: box.top + box.height / 2 };
          };
          const parts = [...bar.children].filter((node) => node.getBoundingClientRect().width > 0);
          const doors = [...bar.querySelectorAll(".siteNavLinks a")];
          const utilities = [...bar.querySelectorAll(".siteNavActions > *")].filter((node) => node.getBoundingClientRect().width > 0);
          return {
            height: bar.getBoundingClientRect().height,
            middles: [...parts, ...doors, ...utilities].map((node) => centre(node).middle),
            doors: doors.length,
            utilities: utilities.length,
          };
        });
        await info.attach(`one-row-${width}-${signedIn ? "signed-in" : "signed-out"}${path.replace("/", "-")}`, {
          body: await page.screenshot({ clip: { x: 0, y: 0, width, height: 140 } }),
          contentType: "image/png",
        });
        expect(row.doors, `${path}: doors`).toBe(6);
        expect(row.utilities, `${path}: utilities`).toBeGreaterThan(0);
        expect(row.height, `${path}: bar height`).toBeLessThanOrEqual(66);
        const spread = Math.max(...row.middles) - Math.min(...row.middles);
        expect(spread, `${path}: every part shares one row`).toBeLessThanOrEqual(1);
      }
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const fontSize of [16, 32]) {
    for (const width of [390, 1440]) {
      test(`navigation preserves full destinations at ${width}px/${fontSize}px in ${theme}`, async ({ page, context }, info) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: fontSize === 32 ? "reduce" : "no-preference" });
        await context.route("**/*", (route) => {
          if (["GET", "HEAD"].includes(route.request().method())) return route.continue();
          return route.abort("blockedbyclient");
        });
        await storeThemeChoice(page, theme);
        await page.clock.install({ time: new Date("2026-11-03T18:00:00Z") });
        await page.addInitScript(() => {
          localStorage.setItem("pubmax-tour-v1-done", "1");
          localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
          localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
          sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
          sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontSize } });
        await installDeterministicMapBasemap(page);
        await page.goto("/map?wild=1");
        await expectMapLoadingFrameReleased(page);
        if (width === 390) await expectMobileMapShellReady(page);
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
        await info.attach("map-navigation-arrival-fixture-proof", { body: await page.screenshot(), contentType: "image/png" });

        const primary = width === 390 ? page.locator(".mobileTabBar") : page.locator(".siteNavLinks");
        const destinations = width === 390
          ? ["/map", "/tonight", "/plan", "/social", "/u/you"]
          : ["/map", "/tonight", "/plan", "/spoons-value", "/social", "/u/you"];
        // The browser's 200 percent text is the large bucket, so the phone tabs
        // are icons alone; the desktop row keeps its words and wraps instead.
        const iconOnly = width === 390 && fontSize === 32;
        if (fontSize === 32) await expect(page.locator("html")).toHaveAttribute("data-text-scale", "large");
        else await expect(page.locator("html")).not.toHaveAttribute("data-text-scale", /./);
        if (width === 1440) {
          const header = page.locator(".siteNavBar");
          const links = primary.locator("a");
          await expectDestinations(page, primary, destinations);
          const boxes = await links.evaluateAll((nodes) => nodes.map((node) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          }));
          const otherRow = boxes.findIndex((box) =>
            box.y >= boxes[0].y + boxes[0].height - 1 || box.y + box.height <= boxes[0].y + 1);
          const endpoint = otherRow === -1 ? boxes.length - 1 : otherRow;
          await info.attach("hover-row-geometry", {
            body: JSON.stringify({ boxes, endpoint, crossRow: otherRow !== -1 }),
            contentType: "application/json",
          });
          const pill = header.locator(".siteNavGlide");
          for (const link of [links.first(), links.nth(endpoint)]) {
            await link.hover();
            await expect(pill).toHaveAttribute("data-visible", "true");
            const linkBox = await link.boundingBox();
            await expect.poll(async () => {
              const box = await pill.boundingBox();
              return box ? Math.max(Math.abs(box.x - linkBox!.x), Math.abs(box.y - linkBox!.y), Math.abs(box.width - linkBox!.width), Math.abs(box.height - linkBox!.height)) : Infinity;
            }).toBeLessThan(1);
          }
          const more = header.getByRole("button", { name: "More pages", exact: true });
          await expect(more).toBeEnabled();
          await more.click();
          const menu = page.getByRole("menu", { name: "More pages", exact: true });
          await menu.getByRole("menuitem", { name: /^Borough Bingo/ }).click();
          await expect(menu).toHaveCount(0);
        } else {
          const picker = page.getByLabel("Night preview", { exact: true });
          await expect(picker).toHaveValue("off");
          await picker.selectOption("borough-bingo");
        }

        for (const selected of [true, false]) {
          const state = selected ? "selected-preview" : "master-off";
          if (!selected) {
            await page.goto("/map?wild=0");
            await expectMapLoadingFrameReleased(page);
          }
          await page.evaluate(() => document.fonts.ready);
          await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expectPreviewState(page, width, selected);
          await expectDestinations(page, primary, destinations, iconOnly);
          await expectMapClearance(page, width, fontSize === 32);
          if (width === 390 && selected) {
            const topbarBox = await page.locator(".mobileMapTopbar").boundingBox();
            const pickerBox = await page.locator(".wildNightPreviewMobile").boundingBox();
            const chromeBox = await page.locator(".mobileMapChrome").boundingBox();
            const canvasBox = await page.locator(".mapStage > .mapCanvasWrap").boundingBox();
            expect(pickerBox).not.toBeNull();
            expect(chromeBox).not.toBeNull();
            expect(canvasBox).not.toBeNull();
            expect(pickerBox!.y).toBeGreaterThanOrEqual(topbarBox!.y + topbarBox!.height - 1);
            expect(canvasBox!.y).toBeGreaterThanOrEqual(chromeBox!.y + chromeBox!.height - 1);
            expect(canvasBox!.height).toBeGreaterThan(0);
          }
          await info.attach(`map-navigation-${state}-fixture-proof`, { body: await page.screenshot(), contentType: "image/png" });

          await primary.locator('a[href="/tonight"]').click();
          await expect(page).toHaveURL(/\/tonight/);
          const nav = page.locator(".siteNavBar");
          await expect(nav).toBeVisible();
          expect(await nav.evaluate((node) => getComputedStyle(node).position)).not.toMatch(/^(absolute|fixed)$/);
          const contentHeading = page.getByRole("heading", { level: 1 });
          await expect(contentHeading).toBeVisible();
          await expectPreviewState(page, width, selected);
          await page.evaluate(() => document.fonts.ready);
          await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          const navBox = await nav.boundingBox();
          const headingBox = await contentHeading.boundingBox();
          expect(headingBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);
          if (width === 390 && selected) {
            const pickerBox = await page.locator(".wildNightPreviewMobile").boundingBox();
            expect(pickerBox).not.toBeNull();
            expect(headingBox!.y).toBeGreaterThanOrEqual(pickerBox!.y + pickerBox!.height);
          }
          await expectDestinations(page, primary, destinations, iconOnly);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
          await info.attach(`tonight-navigation-${state}`, { body: await page.screenshot(), contentType: "image/png" });
        }
      });
    }
  }
}
