import { expect, test, type Page } from "@playwright/test";

const VENUE_ID = "venue-p7p18j";
const PHONE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

test.setTimeout(120_000);

async function openVenueTabs(page: Page) {
  await page.goto(`/map?sel=${VENUE_ID}`);
  const tablist = page.getByRole("tablist", {
    name: "Venue detail sections",
  });
  await expect(tablist).toBeVisible({ timeout: 45_000 });
  return {
    tablist,
    lastTrain: tablist.getByRole("tab", {
      name: "Last train",
      exact: true,
    }),
  };
}

async function expectTabFullyInsideRail(page: Page) {
  const { tablist, lastTrain } = await openVenueTabs(page);
  await expect(lastTrain).toBeVisible();

  const [railBox, tabBox] = await Promise.all([
    tablist.boundingBox(),
    lastTrain.boundingBox(),
  ]);
  expect(railBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  expect(tabBox!.x).toBeGreaterThanOrEqual(railBox!.x - 0.5);
  expect(
    tabBox!.x + tabBox!.width,
    "Last train is not clipped by the tab rail",
  ).toBeLessThanOrEqual(railBox!.x + railBox!.width + 0.5);
  return { tablist, lastTrain, railBox: railBox!, tabBox: tabBox! };
}

test.describe("Today mobile block geometry", () => {
  for (const viewport of PHONE_VIEWPORTS) {
    test(`${viewport.width}px has one tab-bar reserve and no oversized layout block`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/today");

      const pageMain = page.getByTestId("today-screen");
      const nearEntry = page.getByRole("link", { name: "Find pubs near you" });
      const mobileTabBar = page.getByRole("navigation", { name: "Primary" });
      await expect(pageMain).toBeVisible({ timeout: 45_000 });
      await expect(mobileTabBar).toBeVisible();

      const geometry = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>(".todayPage")!;
        const entry = document.querySelector<HTMLElement>(".todayNearEntry")!;
        const tabBar = document.querySelector<HTMLElement>(".mobileTabBar")!;
        const rootStyle = getComputedStyle(document.documentElement);
        return {
          bodyPaddingBottom: Number.parseFloat(getComputedStyle(document.body).paddingBottom),
          mainPaddingBottom: Number.parseFloat(getComputedStyle(main).paddingBottom),
          nearEntryMargin: Number.parseFloat(getComputedStyle(entry).marginBlockStart),
          tabBarHeight: Number.parseFloat(rootStyle.getPropertyValue("--tabbar-h")),
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
          tabBarTop: tabBar.getBoundingClientRect().top,
        };
      });

      expect(geometry.bodyPaddingBottom).toBeCloseTo(geometry.tabBarHeight, 0);
      expect(
        geometry.mainPaddingBottom,
        "Today must not reserve the fixed tab bar a second time",
      ).toBeLessThanOrEqual(32);
      expect(
        geometry.nearEntryMargin,
        "responsive spacer must stay inside the 96px layout-block ceiling",
      ).toBeLessThanOrEqual(96);
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);

      await nearEntry.scrollIntoViewIfNeeded();
      await expect(nearEntry).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const [footBox, tabBox] = await Promise.all([
        page.locator(".todayFoot").boundingBox(),
        mobileTabBar.boundingBox(),
      ]);
      expect(footBox).not.toBeNull();
      expect(tabBox).not.toBeNull();
      expect(footBox!.y + footBox!.height).toBeLessThanOrEqual(tabBox!.y + 0.5);
    });
  }

  test("desktop keeps Today actions reachable without mobile navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/today");
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".mobileTabBar")).toBeHidden();
    const actions = page.locator(".todayFoot a");
    await actions.last().scrollIntoViewIfNeeded();
    await expect(actions).toHaveCount(3);
    await expect(actions.last()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("Android install prompt", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36",
  });

  test("is a compact non-modal card while map stays visible and interactive", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax:analytics-consent:v1", "denied");
      localStorage.setItem(
        "pubmax:a2hs:v1",
        JSON.stringify({
          firstDayBucket: 1,
          secondDayBucket: 2,
          declinedDayBucket: null,
          outcome: "none",
        }),
      );
      sessionStorage.clear();
    });
    await page.goto(`/map?sel=${VENUE_ID}`);

    const map = page.getByRole("region", { name: "Interactive pub map of London" });
    const expandSheet = page.getByRole("button", { name: "Expand sheet" });
    await expect(map).toBeVisible({ timeout: 45_000 });
    await expect(expandSheet).toBeVisible();
    await expandSheet.focus();
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperties(event, {
        platforms: { value: ["web"] },
        prompt: { value: () => Promise.resolve() },
        userChoice: {
          value: Promise.resolve({ outcome: "dismissed", platform: "web" }),
        },
      });
      window.dispatchEvent(event);
    });

    const card = page.getByRole("region", { name: "Put PUBMAXX on your home screen" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".a2hsScrim")).toHaveCount(0);
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
    await expect(map).toBeVisible();

    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.height).toBeLessThanOrEqual(844 * 0.3);
    expect(cardBox!.y).toBeGreaterThan(844 * 0.45);

    const install = card.getByRole("button", { name: "Add to home screen" });
    const close = card.getByRole("button", { name: "Not now", exact: true }).first();
    const [installBox, closeBox] = await Promise.all([
      install.boundingBox(),
      close.boundingBox(),
    ]);
    expect(installBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(installBox!.height).toBeGreaterThanOrEqual(44);
    expect(closeBox!.height).toBeGreaterThanOrEqual(44);

    const expandBox = await expandSheet.boundingBox();
    expect(expandBox).not.toBeNull();
    expect(
      await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.closest("button")?.getAttribute("aria-label");
      }, {
        x: expandBox!.x + expandBox!.width / 2,
        y: expandBox!.y + expandBox!.height / 2,
      }),
      "Android card must not install a pointer-blocking page layer",
    ).toBe("Expand sheet");

    await close.click();
    await expect(card).toBeHidden();
    await expect(expandSheet).toBeFocused();
    expect(
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("pubmax:a2hs:v1") ?? "null") as {
          declinedDayBucket?: unknown;
        } | null;
        return typeof state?.declinedDayBucket === "number";
      }),
    ).toBe(true);

    await expandSheet.click();
    await expect(page.getByRole("button", { name: "Collapse sheet" })).toBeVisible();
  });
});

test.describe("Venue detail tab reachability", () => {
  test("320px exposes real trailing overflow, then removes fade at the reachable end", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE_VIEWPORTS[0]);
    const { tablist, lastTrain } = await openVenueTabs(page);
    await expect(tablist).toHaveAttribute("data-trailing-fade", "on");
    expect(
      await tablist.evaluate((rail) => rail.scrollWidth - rail.clientWidth),
    ).toBeGreaterThan(28);

    await lastTrain.evaluate((tab) => tab.scrollIntoView({ block: "nearest", inline: "end" }));
    await expect(tablist).toHaveAttribute("data-trailing-fade", "off");
    const [railBox, tabBox] = await Promise.all([
      tablist.boundingBox(),
      lastTrain.boundingBox(),
    ]);
    expect(railBox).not.toBeNull();
    expect(tabBox).not.toBeNull();
    expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width + 0.5);
    expect(tabBox!.width).toBeGreaterThanOrEqual(44);
    expect(tabBox!.height).toBeGreaterThanOrEqual(44);
  });

  for (const viewport of PHONE_VIEWPORTS.slice(1)) {
    test(`${viewport.width}px shows Last train in full on first open`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { tablist, tabBox } = await expectTabFullyInsideRail(page);
      expect(tabBox.width).toBeGreaterThanOrEqual(44);
      expect(tabBox.height).toBeGreaterThanOrEqual(44);
      await expect(tablist).toHaveCSS("overflow-x", "auto");
      await expect(tablist).toHaveAttribute("data-trailing-fade", "off");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
    });
  }

  test("desktop shows the full tab rail without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { tablist, tabBox } = await expectTabFullyInsideRail(page);
    await expect(tablist).toHaveCSS("overflow-x", "visible");
    expect(tabBox.width).toBeGreaterThan(80);
    expect(await tablist.evaluate((rail) => rail.scrollWidth - rail.clientWidth)).toBeLessThanOrEqual(1);
  });
});
