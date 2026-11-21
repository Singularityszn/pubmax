import { expect, test, type Locator, type Page } from "@playwright/test";

import { LANDING_PRIMARY_NAME } from "./helpers/landingHero";

const MOBILE = { width: 390, height: 844 };

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px mobile tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should be wide enough to tap`).toBeGreaterThanOrEqual(44);
}

async function expectWithinFirstViewport(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  const viewportHeight = page.viewportSize()?.height ?? 0;
  expect(
    box.y + box.height,
    `${label} should finish inside first viewport`,
  ).toBeLessThanOrEqual(viewportHeight);
}

async function expectAppTabClearance(page: Page, label: string): Promise<void> {
  const bodyPaddingBottom = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.body).paddingBottom),
  );
  expect(bodyPaddingBottom, `${label} should reserve app-tab clearance`).toBeGreaterThanOrEqual(64);
}

async function expectWordmarkLettersOnOneLine(page: Page, label: string): Promise<void> {
  const tops = await page
    .locator(".lpNav .lpWordmark .pubmaxxWordmarkLetters > *")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(tops.length, `${label} should render PUBMAX and the accent X`).toBe(2);
  expect(
    Math.max(...tops) - Math.min(...tops),
    `${label} should keep the wordmark letters on one row`,
  ).toBeLessThanOrEqual(2);
}

async function expectNoHorizontalOverflow(page: Page, width = MOBILE.width): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, `page should not horizontally overflow at ${width}px`).toBeLessThanOrEqual(1);
}

// #1488 gave Tonight a door in the hero because the phone's home screen had no
// other tap for it. The five-tab dock carries Tonight on every route now
// (captain decision 13, 1 Nov 2026), so the hero's second quiet door is Plan a
// crawl (decision 2). The contract is the same one, measured on the RENDERED
// box at the four phone widths the shell is held to elsewhere, because a link
// that exists and is 0x0 is what the old nav was.
test.describe("Plan a crawl is one tap from the mobile home", () => {
  for (const { width, height } of [
    { width: 320, height: 844 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    test(`reaches Plan above the fold at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");

      const plan = page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Plan", exact: true });
      await expect(plan, `Plan door at ${width}px`).toBeVisible();
      await expect(plan).toHaveAttribute("href", "/plan");

      const box = await plan.boundingBox();
      expect(box, `Plan door should have a layout box at ${width}px`).not.toBeNull();
      if (!box) return;
      expect(box.width, `Plan door width at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(box.height, `Plan door height at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(
        box.y + box.height,
        `Plan door should finish inside the first viewport at ${width}px`,
      ).toBeLessThanOrEqual(height);

      // One tap, and it lands on Plan itself. The tap is retried rather than
      // the assertion after it, because this control is painted on the server
      // and is clickable before React attaches (AGENTS.md, "A LONE CLICK IS
      // NOT A WAIT FOR HYDRATION").
      await expect(async () => {
        await plan.click();
        await expect(page).toHaveURL(/\/plan$/, { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
    });
  }
});

test.describe("mobile landing entry", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("keeps direct Near idle and gives a shared patch priority", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: () => {
            (window as Window & { __nearLocateCalls?: number }).__nearLocateCalls =
              ((window as Window & { __nearLocateCalls?: number }).__nearLocateCalls ?? 0) + 1;
          },
        },
      });
    });

    await page.goto("/near");
    await expect(page.getByRole("button", { name: "Find my pint", exact: true })).toBeVisible();
    await expect(page.locator(".nmnCard")).toHaveCount(0);

    await page.goto("/near?patch=soho&locate=1");
    await expect(page.locator(".nmnCard")).toHaveCount(5);
    expect(
      await page.evaluate(
        () => (window as Window & { __nearLocateCalls?: number }).__nearLocateCalls ?? 0,
      ),
    ).toBe(0);
  });

  test("answers honestly when location permission is denied", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmax:nightPatch:v1");
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (
            _success: PositionCallback,
            error: PositionErrorCallback,
          ) => {
            (window as Window & { __nearLocateCalls?: number }).__nearLocateCalls =
              ((window as Window & { __nearLocateCalls?: number }).__nearLocateCalls ?? 0) + 1;
            error({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
          },
        },
      });
    });

    await page.goto("/near?locate=1");
    await expect(
      page.getByRole("heading", { name: "Cheapest listed around central London" }),
    ).toBeVisible();
    await expect(page.getByText("Location's off, so here's central London. Not your patch?")).toBeVisible();
    await expect(page.locator(".nmnCard")).toHaveCount(5);
    await expect(page).toHaveURL(/patch=central/);
    expect(
      await page.evaluate(
        () => (window as Window & { __nearLocateCalls?: number }).__nearLocateCalls ?? 0,
      ),
    ).toBe(1);
  });

  test("keeps the first-run entry path primary and unclipped", async ({ page }, testInfo) => {
    const errors = pageErrors(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", {
        name: "What's a fair pint to you?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeVisible();
    await expectAppTabClearance(page, "root landing");
    await expectWordmarkLettersOnOneLine(page, "root landing wordmark");

    const planTonight = page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
    await expectTappable(planTonight, "hero Open the map CTA");
    await expectWithinFirstViewport(page, planTonight, "hero Open the map CTA");
    await expectTappable(page.locator(".lpFooterNav").getByRole("link", { name: "Find my pint" }), "footer Find my pint link");

    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("landing-root-390-light.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  for (const width of [320, 430]) {
    test(`keeps root landing chrome aligned at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/?source=mobile-entry");

      await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expectAppTabClearance(page, `root landing at ${width}px`);
      await expectWordmarkLettersOnOneLine(page, `root landing wordmark at ${width}px`);
      const planTonight = page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
      await expectTappable(planTonight, `hero Open the map CTA at ${width}px`);
      await expectWithinFirstViewport(page, planTonight, `hero Open the map CTA at ${width}px`);
      await expectNoHorizontalOverflow(page, width);
      await page.screenshot({
        path: testInfo.outputPath(`landing-root-${width}-light.png`),
        fullPage: true,
      });
    });
  }

  test("keeps root landing chrome aligned in dark mode", async ({ page }, testInfo) => {
    await page.addInitScript(() => window.localStorage.setItem("pubmax-theme", "dark"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Count the PAINTED bar. The layout streams the tab bar as a pending
    // Suspense boundary, its server copy parked in a hidden `S:` chunk until
    // the throttled reveal runs. An auth update that reaches the boundary
    // first makes React render it on the client, and the server copy then
    // stays behind as a hidden orphan: a second `.mobileTabBar` nobody sees.
    await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expectAppTabClearance(page, "dark root landing");
    await expectWordmarkLettersOnOneLine(page, "dark root landing wordmark");
    const planTonight = page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
    await expectTappable(planTonight, "dark hero Open the map CTA");
    await expectWithinFirstViewport(page, planTonight, "dark hero Open the map CTA");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("landing-root-390-dark.png"),
      fullPage: true,
    });
  });

  test("opens the map with no budget while the slider is untouched", async ({ page }) => {
    await page.goto("/");
    await page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME }).click();
    await expect(page).toHaveURL(/\/map$/);
  });
});

test("reserves app-tab clearance before hydration", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: MOBILE,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.locator(".mobileTabBarClearance")).toHaveCount(1);
    const bodyPaddingBottom = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).paddingBottom),
    );
    expect(bodyPaddingBottom).toBeGreaterThanOrEqual(64);
  } finally {
    await context.close();
  }
});

test("keeps desktop root free of mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeHidden();
  await expectTappable(
    page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME }),
    "desktop hero Open the map CTA",
  );
  await expectNoHorizontalOverflow(page, 1440);
});

test("keeps the slider card inside the phone's width with room to read", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const card = page.locator(".landingMapHeroCard");
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  // A card narrower than the column reads as a widget; it takes the column.
  expect(box!.width).toBeGreaterThanOrEqual(300);
});
