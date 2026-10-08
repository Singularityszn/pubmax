import { expect, test, type Locator, type Page } from "@playwright/test";

import { LANDING_PRIMARY_NAME, LANDING_RECEIPT_NAME } from "./helpers/landingHero";

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

// #1488. Tonight had no tap on the phone's home screen: the landing bar hides
// its link list under 960px (`.lpPrimaryNav { display: none }`), the six-tab
// dock carried Now rather than Tonight, and the only rendered /tonight link on
// `/` sat in the footer about 3,500px down. This is the contract that replaces
// it, measured on the RENDERED box at the four phone widths the shell is held
// to elsewhere, because a link that exists and is 0x0 is what the old nav was.
test.describe("Tonight is one tap from the mobile home", () => {
  for (const { width, height } of [
    { width: 320, height: 844 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    test(`reaches Tonight above the fold at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");

      const tonight = page.locator(".lpHero").getByRole("link", { name: "Tonight", exact: true });
      await expect(tonight, `Tonight door at ${width}px`).toBeVisible();
      await expect(tonight).toHaveAttribute("href", "/tonight");

      const box = await tonight.boundingBox();
      expect(box, `Tonight door should have a layout box at ${width}px`).not.toBeNull();
      if (!box) return;
      expect(box.width, `Tonight door width at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(box.height, `Tonight door height at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(
        box.y + box.height,
        `Tonight door should finish inside the first viewport at ${width}px`,
      ).toBeLessThanOrEqual(height);

      // One tap, and it lands on Tonight itself. The tap is retried rather
      // than the assertion after it, because this control is painted on the
      // server and is clickable before React attaches (AGENTS.md, "A LONE
      // CLICK IS NOT A WAIT FOR HYDRATION").
      await expect(async () => {
        await tonight.click();
        await expect(page).toHaveURL(/\/tonight$/, { timeout: 1_000 });
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

  test("answers after one homepage tap", async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.setGeolocation({ latitude: 51.5137, longitude: -0.132 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await context.grantPermissions(["geolocation"], {
      origin: new URL(page.url()).origin,
    });

    // The near-me answer is the one primary, and it is the one-tap route to an
    // answer with no account and no wall in front of it.
    await page
      .locator(".lpHero [data-primary-action]")
      .getByRole("link", { name: LANDING_PRIMARY_NAME })
      .click();

    await expect(page).toHaveURL(/\/near\?locate=1$/);
    // The answer itself: priced pubs within a walk, ranked cheapest first.
    await expect(page.locator(".nmnCard").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeVisible();
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
        name: "What a pint costs, pub by pub.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeVisible();
    await expectAppTabClearance(page, "root landing");
    await expectWordmarkLettersOnOneLine(page, "root landing wordmark");

    const planTonight = page.locator(".lpHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
    await expectTappable(planTonight, "hero Cheapest pints near me CTA");
    await expectWithinFirstViewport(page, planTonight, "hero Cheapest pints near me CTA");
    await expectTappable(
      page.locator(".lpHero .screenSecondary a").first(),
      "hero receipt door",
    );
    await expectTappable(page.locator(".lpWorth").getByRole("link", { name: "Open the map" }), "saving section Open the map link");
    await expectTappable(page.locator(".lpFooterNav").getByRole("link", { name: "Find my pint" }), "footer Find my pint link");

    // The one real pub sits in the first screen with its price and its source.
    const pubCard = page.locator(".lpHero .lpPubCard");
    await expect(pubCard).toBeVisible();
    await expectTappable(pubCard.locator(".lpPubName a"), "hero pub name link");
    await expect(pubCard.locator(".lpStanding")).toContainText("Listed");

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
      const planTonight = page.locator(".lpHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
      await expectTappable(planTonight, `hero Cheapest pints near me CTA at ${width}px`);
      await expectWithinFirstViewport(page, planTonight, `hero Cheapest pints near me CTA at ${width}px`);
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
    const planTonight = page.locator(".lpHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
    await expectTappable(planTonight, "dark hero Cheapest pints near me CTA");
    await expectWithinFirstViewport(page, planTonight, "dark hero Cheapest pints near me CTA");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("landing-root-390-dark.png"),
      fullPage: true,
    });
  });

  test("routes the primary, the quiet doors and the map link where they say", async ({ page }) => {
    await page.goto("/");

    await page.locator(".lpHero").getByRole("link", { name: LANDING_PRIMARY_NAME }).click();
    // /near writes the answered patch back to the URL once it settles
    // (NearMeNow's syncPatchToUrl), so the landing's own href may already
    // carry `&patch=` by the time the assertion polls.
    await expect(page).toHaveURL(/\/near\?locate=1(?:&patch=[^&]+)?$/);
    await page.goto("/");

    // The receipt door, quiet now: the pub's own Pint Drop door.
    const receipt = page.locator(".lpHero .screenSecondary a").first();
    await expect(receipt).toHaveText(LANDING_RECEIPT_NAME);
    await receipt.click();
    await expect(page).toHaveURL(/\/map\?sel=[^&]+&log=1&price=\d+\.\d\d$|\/near$/);
    await page.goto("/");

    await page.locator(".lpWorth").getByRole("link", { name: "Open the map" }).click();
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
    page.locator(".lpHero").getByRole("link", { name: LANDING_PRIMARY_NAME }),
    "desktop hero Log what you paid CTA",
  );
  await expectNoHorizontalOverflow(page, 1440);
});

test("keeps the one real pub card inside the phone's width with room to read", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const card = page.locator(".lpHero .lpPubCard");
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  // A card narrower than the column reads as a widget; it takes the column.
  expect(box!.width).toBeGreaterThanOrEqual(300);
});
