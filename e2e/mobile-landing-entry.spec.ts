import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function expectNoAppTabClearance(page: Page, label: string): Promise<void> {
  const bodyPaddingBottom = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.body).paddingBottom),
  );
  expect(bodyPaddingBottom, `${label} should not reserve app-tab clearance`).toBeLessThan(64);
}

async function expectNoHorizontalOverflow(page: Page, width = MOBILE.width): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, `page should not horizontally overflow at ${width}px`).toBeLessThanOrEqual(1);
}

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

    await page
      .locator(".lpHeroActions")
      .getByRole("link", { name: "Find my pint", exact: true })
      .click();

    await expect(page).toHaveURL(/\/near\?locate=1$/);
    await expect(
      page.getByRole("heading", { name: "Cheapest listed near you", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".nmnCard")).toHaveCount(5);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.locator(".mobileTabBar")).toBeVisible();
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
          ) => error({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
        },
      });
    });

    await page.goto("/near?locate=1");
    await expect(
      page.getByRole("heading", { name: "Cheapest listed around central London" }),
    ).toBeVisible();
    await expect(page.getByText("Location's off, so here's central London. Not your patch?")).toBeVisible();
    await expect(page.locator(".nmnCard")).toHaveCount(5);
  });

  test("keeps the first-run entry path primary and unclipped", async ({ page }, testInfo) => {
    const errors = pageErrors(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", {
        name: "London pints can cost eight quid.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.locator(".mobileTabBar")).toHaveCount(0);
    await expectNoAppTabClearance(page, "root landing");

    const findMyPint = page.locator(".lpHeroActions").getByRole("link", { name: "Find my pint" });
    await expectTappable(
      findMyPint,
      "hero Find my pint CTA",
    );
    await expectWithinFirstViewport(page, findMyPint, "hero Find my pint CTA");
    await expectTappable(page.locator(".lpHeroActions").getByRole("link", { name: "Open the map" }), "hero Open the map link");
    await expectTappable(page.getByRole("link", { name: "Plan with friends" }).first(), "hero Plan with friends link");

    const visibleHeroPins = page.locator(".thamesHeroPin:visible");
    const pinCount = await visibleHeroPins.count();
    expect(pinCount, "phone hero should keep only the tappable, non-crowded pins").toBeGreaterThanOrEqual(3);
    for (let i = 0; i < Math.min(pinCount, 4); i++) {
      await expectTappable(visibleHeroPins.nth(i), `hero drink pin ${i + 1}`);
    }

    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("landing-root-390-light.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  for (const width of [320, 430]) {
    test(`keeps root landing chrome-free at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/?source=mobile-entry");

      await expect(page.locator(".mobileTabBar")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
      await expectNoAppTabClearance(page, `root landing at ${width}px`);
      const findMyPint = page.locator(".lpHeroActions").getByRole("link", { name: "Find my pint" });
      await expectTappable(
        findMyPint,
        `hero Find my pint CTA at ${width}px`,
      );
      await expectWithinFirstViewport(page, findMyPint, `hero Find my pint CTA at ${width}px`);
      await expectNoHorizontalOverflow(page, width);
      await page.screenshot({
        path: testInfo.outputPath(`landing-root-${width}-light.png`),
        fullPage: true,
      });
    });
  }

  test("keeps root landing chrome-free in dark mode", async ({ page }, testInfo) => {
    await page.addInitScript(() => window.localStorage.setItem("pubmax-theme", "dark"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".mobileTabBar")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expectNoAppTabClearance(page, "dark root landing");
    const findMyPint = page.locator(".lpHeroActions").getByRole("link", { name: "Find my pint" });
    await expectTappable(
      findMyPint,
      "dark hero Find my pint CTA",
    );
    await expectWithinFirstViewport(page, findMyPint, "dark hero Find my pint CTA");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("landing-root-390-dark.png"),
      fullPage: true,
    });
  });

  test("routes secondary mobile CTAs to Map and Plan", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Plan with friends" }).first().click();
    await expect(page).toHaveURL(/\/plan$/);
    await page.goto("/");

    await page.getByRole("link", { name: "Open the map" }).first().click();
    await expect(page).toHaveURL(/\/(choose-city|map)/);
  });
});

test("keeps desktop root free of mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator(".mobileTabBar")).toHaveCount(0);
  await expectTappable(
    page.locator(".lpHeroActions").getByRole("link", { name: "Find my pint" }),
    "desktop hero Find my pint CTA",
  );
  await expectNoHorizontalOverflow(page, 1440);
});

test("keeps the drink-signal image within a deliberate mobile crop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const image = page.locator(".thamesHeroPhoto");
  await expect(image).toBeVisible();
  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.width ?? 0) / (box?.height ?? 1)).toBeGreaterThan(0.74);
  expect((box?.width ?? 0) / (box?.height ?? 1)).toBeLessThan(0.86);
});
