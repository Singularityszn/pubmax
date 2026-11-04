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
    // The last of the five tabs (site audit 13 Sep 2026, D10).
    lastTab: tablist.getByRole("tab", {
      name: "Lore",
      exact: true,
    }),
  };
}

async function expectTabFullyInsideRail(page: Page) {
  const { tablist, lastTab } = await openVenueTabs(page);
  await expect(lastTab).toBeVisible();

  const [railBox, tabBox] = await Promise.all([
    tablist.boundingBox(),
    lastTab.boundingBox(),
  ]);
  expect(railBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  expect(tabBox!.x).toBeGreaterThanOrEqual(railBox!.x - 0.5);
  expect(
    tabBox!.x + tabBox!.width,
    "Lore is not clipped by the tab rail",
  ).toBeLessThanOrEqual(railBox!.x + railBox!.width + 0.5);
  return { tablist, lastTab, railBox: railBox!, tabBox: tabBox! };
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
        // The body's one reserve is the published foot clearance
        // (components/nav/mobileNav.css): the tab bar, the home indicator and
        // one gap. The floating create action that also owned a lane above the
        // bar left with the five-tab dock (captain, 1 Nov 2026).
        const lane = document.createElement("div");
        lane.style.paddingBottom = "var(--chrome-bottom-clearance)";
        lane.style.paddingTop = "var(--tabbar-h)";
        document.body.append(lane);
        const clearance = Number.parseFloat(getComputedStyle(lane).paddingBottom);
        const tabBarHeight = Number.parseFloat(getComputedStyle(lane).paddingTop);
        lane.remove();
        return {
          bodyPaddingBottom: Number.parseFloat(getComputedStyle(document.body).paddingBottom),
          clearance,
          mainPaddingBottom: Number.parseFloat(getComputedStyle(main).paddingBottom),
          nearEntryMargin: Number.parseFloat(getComputedStyle(entry).marginBlockStart),
          tabBarHeight,
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
          tabBarTop: tabBar.getBoundingClientRect().top,
        };
      });

      await expect(page.locator(".createFabRoot")).toHaveCount(0);
      expect(geometry.bodyPaddingBottom).toBeGreaterThan(geometry.tabBarHeight);
      expect(geometry.bodyPaddingBottom).toBeCloseTo(geometry.clearance, 0);
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
    await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeHidden();
    // Every way onward is reachable on a desktop with no tab bar. The foot
    // carried three links until the taste pass (18 Oct 2026) said each way
    // once: Tonight is the Now pair at the top, the map is the head's own
    // secondary, and the foot keeps the one way that is said nowhere else.
    const screen = page.getByTestId("today-screen");
    for (const [scope, href] of [
      [page.locator(".nowSegment"), "/tonight"],
      [screen.locator("[data-primary-action]"), "/near?locate=1"],
      [screen.locator(".screenSecondary"), "/map"],
      [page.locator(".todayFoot"), "/plan"],
    ] as const) {
      const action = scope.locator(`a[href="${href}"]`);
      await expect(action, `${href} is a way onward from /today`).toHaveCount(1);
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
  });
});

// The last line of a page ends above the tab bar when the page is scrolled to
// the very bottom, and the body is the only thing that reserved the room
// (components/nav/mobileNav.css, --chrome-bottom-clearance; source fence
// __tests__/chromeBottomClearance.test.ts). The create disc that also stood
// there left with the five-tab dock (captain, 1 Nov 2026).
test.describe("the foot of a scrolling page clears the phone chrome", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const route of ["/", "/today", "/tonight", "/founders", "/historic"]) {
    test(`${route} ends above the tab bar`, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      });
      await page.goto(route);
      const tabBar = page.getByRole("navigation", { name: "Primary" });
      await expect(tabBar).toBeVisible({ timeout: 45_000 });
      await expect(page.locator(".createFab")).toHaveCount(0);

      const foot = await page.evaluate(async () => {
        const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
        for (let i = 0; i < 6; i += 1) {
          window.scrollTo(0, document.documentElement.scrollHeight);
          await settle();
        }
        const probe = document.createElement("div");
        probe.style.paddingBottom = "var(--chrome-bottom-clearance)";
        document.body.append(probe);
        const token = Number.parseFloat(getComputedStyle(probe).paddingBottom);
        probe.remove();

        let lowest = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const owner = node.parentElement;
          if (!node.textContent?.trim() || !owner) continue;
          if (owner.closest(".mobileTabBar, nextjs-portal, [aria-hidden='true']")) continue;
          const style = getComputedStyle(owner);
          if (style.position === "fixed" || style.visibility === "hidden") continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width >= 1 && rect.height >= 1) lowest = Math.max(lowest, rect.bottom);
          }
        }
        return {
          token,
          bodyPaddingBottom: Number.parseFloat(getComputedStyle(document.body).paddingBottom),
          lowestText: lowest,
          railTop: document.querySelector(".mobileTabList")!.getBoundingClientRect().top,
        };
      });

      expect(foot.token, "the phone publishes a clearance").toBeGreaterThan(0);
      expect(foot.bodyPaddingBottom).toBeCloseTo(foot.token, 0);
      expect(foot.lowestText, "the last line ends above the tab bar").toBeLessThanOrEqual(
        foot.railTop + 0.5,
      );
    });
  }
});

test.describe("Android install prompt", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36",
  });

  async function openInstallCard(page: Page, legacyMode: boolean = false) {
    await page.addInitScript(({ legacy }) => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
      localStorage.setItem("pubmax-legacy", legacy ? "1" : "0");
      if (legacy) {
        const applyLegacy = () => document.documentElement?.setAttribute("data-legacy", "1");
        if (document.documentElement) applyLegacy();
        else window.addEventListener("DOMContentLoaded", applyLegacy, { once: true });
      }
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

      const nativeAddEventListener = window.addEventListener.bind(window);
      let installListenerCount = 0;
      window.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        nativeAddEventListener(type, listener, options);
        if (type !== "beforeinstallprompt") return;

        installListenerCount += 1;
        document.documentElement.setAttribute(
          "data-a2hs-native-owner-count",
          String(installListenerCount),
        );
        if (installListenerCount !== 1) return;

        const event = new Event("beforeinstallprompt", { cancelable: true });
        Object.defineProperties(event, {
          platforms: { value: ["web"] },
          prompt: { value: () => Promise.resolve() },
          userChoice: {
            value: Promise.resolve({ outcome: "dismissed", platform: "web" }),
          },
        });
        window.dispatchEvent(event);
        document.documentElement.setAttribute(
          "data-a2hs-early-event-prevented",
          event.defaultPrevented ? "1" : "0",
        );
      }) as typeof window.addEventListener;
    }, { legacy: legacyMode });
    await page.goto(`/map?sel=${VENUE_ID}`);

    const map = page.getByRole("region", { name: "Interactive pub map of London" });
    const expandSheet = page.getByRole("button", { name: "Expand sheet" });
    await expect(map).toBeVisible({ timeout: 45_000 });
    await expect(expandSheet).toBeVisible();
    await expandSheet.focus();
    await expect(page.locator("html")).toHaveAttribute(
      "data-a2hs-early-event-prevented",
      "1",
      { timeout: 10_000 },
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-a2hs-native-owner-count",
      "1",
    );

    const card = page.locator(".a2hsSheet--android");
    await expect(card).toHaveCount(0);
    await page.goto("/near?patch=soho");
    const answer = page.getByRole("heading", { name: "Cheapest listed around Soho" });
    await expect(answer).toBeVisible();
    const keepAction = page.getByRole("button", { name: /^Keep .+ for tonight$/ }).first();
    await keepAction.focus();
    await expect(card).toBeVisible({ timeout: 10_000 });
    return { card, answer, keepAction };
  }

  for (const viewport of PHONE_VIEWPORTS) {
    test(`${viewport.width}px card stays within 30% without internal scrolling`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { card } = await openInstallCard(page);

      const cardBox = await card.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(cardBox!.height).toBeLessThanOrEqual(viewport.height * 0.3);
      expect(
        await card.evaluate((element) => element.scrollHeight - element.clientHeight),
      ).toBeLessThanOrEqual(1);

      const install = card.getByRole("button", { name: "Install", exact: true });
      const close = card.getByRole("button", { name: "Not now", exact: true }).first();
      const [installBox, closeBox] = await Promise.all([
        install.boundingBox(),
        close.boundingBox(),
      ]);
      expect(installBox).not.toBeNull();
      expect(closeBox).not.toBeNull();
      expect(installBox!.height).toBeGreaterThanOrEqual(44);
      expect(closeBox!.height).toBeGreaterThanOrEqual(44);
      const neverAsk = card.getByRole("button", { name: "Don't ask again" });
      const neverAskBox = await neverAsk.boundingBox();
      expect(neverAskBox).not.toBeNull();
      expect(neverAskBox!.height).toBeGreaterThanOrEqual(44);
      await expect(card.locator("#a2hsTitle")).toHaveText("Install PUBMAXX");
      await expect(card.locator("#a2hsBody")).toHaveText(
        "Keep the listed prices one tap away.",
      );
    });
  }

  test("320px Legacy Mode card stays within 30% with enlarged text", async ({ page }) => {
    const viewport = PHONE_VIEWPORTS[0];
    await page.setViewportSize(viewport);
    const { card } = await openInstallCard(page, true);
    await expect(page.locator("html")).toHaveAttribute("data-legacy", "1");

    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.height).toBeLessThanOrEqual(viewport.height * 0.3);
    expect(
      await card.evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBeLessThanOrEqual(1);
    for (const button of [
      card.getByRole("button", { name: "Install", exact: true }),
      card.getByRole("button", { name: "Not now", exact: true }).first(),
      card.getByRole("button", { name: "Don't ask again" }),
    ]) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("is a compact non-modal card after the price answer and leaves Near interactive", async ({ page }) => {
    const { card, answer, keepAction } = await openInstallCard(page);
    await expect(card).toHaveAttribute("role", "region");
    await expect(card).toHaveAttribute("aria-labelledby", "a2hsTitle");
    await expect(page.locator(".a2hsScrim")).toHaveCount(0);
    // The venue sheet opened by ?sel sits at its half detent, which is modal by
    // design (lib/mobileSheetA11y.ts), so only the install surface is counted.
    await expect(card).not.toHaveAttribute("aria-modal", /.*/);
    await expect(page.locator('.a2hsSheet[role="dialog"]')).toHaveCount(0);
    await expect(answer).toBeVisible();

    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.height).toBeLessThanOrEqual(844 * 0.3);
    expect(cardBox!.y).toBeGreaterThan(844 * 0.45);

    const install = card.getByRole("button", { name: "Install", exact: true });
    const close = card.getByRole("button", { name: "Not now", exact: true }).first();
    const [installBox, closeBox] = await Promise.all([
      install.boundingBox(),
      close.boundingBox(),
    ]);
    expect(installBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(installBox!.height).toBeGreaterThanOrEqual(44);
    expect(closeBox!.height).toBeGreaterThanOrEqual(44);

    const expandBox = await keepAction.boundingBox();
    expect(expandBox).not.toBeNull();
    await expect
      .poll(() => page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return {
          label: hit?.closest("button")?.textContent?.trim() ?? null,
          className: hit instanceof HTMLElement ? hit.className : null,
          tagName: hit?.tagName ?? null,
        };
      }, {
        x: expandBox!.x + expandBox!.width / 2,
        y: expandBox!.y + expandBox!.height / 2,
      }), {
        message: "Android card must not install a pointer-blocking page layer",
      })
      .toMatchObject({ label: "Keep for tonight" });

    await close.click();
    await expect(card).toBeHidden();
    await expect(keepAction).toBeFocused();
    expect(
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("pubmax:a2hs:v1") ?? "null") as {
          declinedDayBucket?: unknown;
        } | null;
        return typeof state?.declinedDayBucket === "number";
      }),
    ).toBe(true);

    await keepAction.click();
    await expect(page).toHaveURL(/\/map\?[^#]*accept=1/);
  });
});

test.describe("iOS install instructions", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  test("retains the full modal Safari instruction sheet", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
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

    const dialog = page.getByRole("dialog", {
      name: "Put PUBMAXX on your home screen",
    });
    await expect(dialog).toHaveCount(0);
    await page.goto("/near?patch=soho");
    await expect(page.getByRole("heading", { name: "Cheapest listed around Soho" })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".a2hsScrim")).toBeVisible();
    await expect(dialog.locator(".a2hsSteps > li")).toHaveCount(3);
    await expect(dialog).toContainText("Safari has no install button");
    await expect(dialog.getByRole("button", { name: "Got it" })).toBeVisible();
  });
});

test.describe("Venue detail tab reachability", () => {
  for (const viewport of PHONE_VIEWPORTS) {
    test(`${viewport.width}px shows the last tab in full on first open, with no overflow`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { tablist, tabBox } = await expectTabFullyInsideRail(page);
      expect(tabBox.width).toBeGreaterThanOrEqual(44);
      expect(tabBox.height).toBeGreaterThanOrEqual(44);
      // Five tabs share one row, so the strip never scrolls (D10).
      expect(
        await tablist.evaluate((rail) => rail.scrollWidth - rail.clientWidth),
      ).toBeLessThanOrEqual(1);
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
    // The last tab is Lore now (D10), a short word, so the floor is the tap
    // target rather than the width "Last train" used to need.
    expect(tabBox.width).toBeGreaterThanOrEqual(44);
    expect(await tablist.evaluate((rail) => rail.scrollWidth - rail.clientWidth)).toBeLessThanOrEqual(1);
  });
});
