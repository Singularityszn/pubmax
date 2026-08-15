import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const AREA_SLUG = "victoria";
const AREA_NAME = "Victoria";
const BRAND_SLUG = "guinness";
const BRAND_LABEL = "Guinness";
const LANDING_PATH = `/area/${AREA_SLUG}/drink/${BRAND_SLUG}`;
const TRACKED_PROOF_DIR = "docs/proof/drink-brand-area-landing";
const MOBILE_VIEWPORTS = [
  { name: "320", width: 320, height: 844, hasTouch: true, isMobile: true },
  { name: "390", width: 390, height: 844, hasTouch: true, isMobile: true },
  { name: "430", width: 430, height: 932, hasTouch: true, isMobile: true },
] as const;
const DESKTOP_VIEWPORT = {
  name: "1440",
  width: 1440,
  height: 900,
  hasTouch: false,
  isMobile: false,
} as const;
const THEMES = ["light", "dark"] as const;

type Theme = (typeof THEMES)[number];

function proofScreenshotPath(
  testInfo: TestInfo,
  fileName: string,
  updateProof = process.env.PUBMAX_UPDATE_DRINK_BRAND_AREA_PROOF === "1",
): string {
  return updateProof
    ? `${TRACKED_PROOF_DIR}/${fileName}`
    : testInfo.outputPath(fileName);
}

function watchBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function setLandingState(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  // Keep auth and analytics browser calls inside the deterministic keyless test
  // boundary. The product still mounts its real providers, but this proof does
  // not depend on a network-only Supabase project or Vercel runtime endpoint.
  await page.route("https://pubmaxx-e2e.supabase.co/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "{}",
    }),
  );
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  await page.routeWebSocket("wss://pubmaxx-e2e.supabase.co/realtime/v1/websocket**", () => {});
  await page.addInitScript((nextTheme) => {
    localStorage.setItem("pubmax-theme", nextTheme);
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  }, theme);
}

async function expectAboveFold(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.y, `${label} should start within the viewport`).toBeGreaterThanOrEqual(0);
  expect(
    box.y + box.height,
    `${label} should stay above the fold`,
  ).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
}

async function expectTouchTarget(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${label} width should meet the 44px touch target`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height should meet the 44px touch target`).toBeGreaterThanOrEqual(44);
}

async function expectVisibleFocus(locator: Locator, label: string): Promise<void> {
  await locator.focus();
  await expect(locator, `${label} should receive keyboard focus`).toBeFocused();
  const focusStyle = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle, `${label} should show a focus outline`).not.toBe("none");
  expect(focusStyle.outlineWidth, `${label} should show a visible focus outline`).not.toBe("0px");
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, "document should not horizontally overflow").toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
  expect(dimensions.body, "body should not horizontally overflow").toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
}

async function expectHorizontallyInsideViewport(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(box.x, `${label} should start inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${label} should end inside the viewport`,
  ).toBeLessThanOrEqual(viewportWidth + 1);
}

function expectedMapHref(venueId?: string): string {
  const params = new URLSearchParams({
    q: AREA_NAME,
    drink: "beer",
    brand: BRAND_SLUG,
  });
  if (venueId) {
    params.set("sel", venueId);
    params.set("log", "1");
  }
  return `/map?${params.toString()}`;
}

async function assertLandingContract(
  page: Page,
  theme: Theme,
  viewportName: string,
): Promise<void> {
  const response = await page.goto(LANDING_PATH, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

  const heading = page.getByRole("heading", {
    level: 1,
    name: `Cheapest ${BRAND_LABEL} pints in ${AREA_NAME}`,
    exact: true,
  });
  const fromPrice = page.locator(".drinkBrandAreaLanding__from strong");
  const heroPublisher = page.locator(".drinkBrandAreaLanding__fromPublisher");
  const summary = page.locator(".drinkBrandAreaLanding__summary");
  const primaryAction = page.getByRole("link", {
    name: `Open ${AREA_NAME} on Map`,
    exact: true,
  });

  await expectAboveFold(page, heading, `${viewportName}px ${theme} H1`);
  await expectAboveFold(page, fromPrice, `${viewportName}px ${theme} cheapest answer`);
  await expectAboveFold(page, heroPublisher, `${viewportName}px ${theme} publisher status`);
  await expectAboveFold(page, summary, `${viewportName}px ${theme} collection summary`);
  await expectAboveFold(page, primaryAction, `${viewportName}px ${theme} primary action`);
  await expect(fromPrice).toHaveText(/^From £\d+\.\d{2}$/);
  await expect(heroPublisher).toBeVisible();
  await expect(primaryAction).toHaveAttribute("href", expectedMapHref());
  await expectTouchTarget(primaryAction, `${viewportName}px ${theme} primary action`);
  await expectVisibleFocus(primaryAction, `${viewportName}px ${theme} primary action`);

  const rows = page.locator(".drinkBrandAreaLanding__row");
  await expect(rows).toHaveCount(17);
  const priceTexts = await rows.locator(".drinkBrandAreaLanding__price").allTextContents();
  const prices = priceTexts.map((text) => Number(text.replace(/[^\d.]/g, "")));
  expect(prices.every(Number.isFinite), "every ranked price should be numeric").toBe(true);
  for (let index = 1; index < prices.length; index += 1) {
    expect(
      prices[index],
      `row ${index + 1} price should not be below row ${index} price`,
    ).toBeGreaterThanOrEqual(prices[index - 1]!);
  }
  await expect(fromPrice).toHaveText(`From ${priceTexts[0]!.trim()}`);

  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const venue = row.locator(".drinkBrandAreaLanding__venue");
    const pint = row.locator(".drinkBrandAreaLanding__pint");
    const publisher = row.locator(".drinkBrandAreaLanding__publisher");
    const contribution = row.getByRole("link", { name: "Log this price", exact: true });
    const price = row.locator(".drinkBrandAreaLanding__price");

    await expect(venue, `row ${index + 1} Venue should be visible`).toBeVisible();
    await expect(pint, `row ${index + 1} pint should be visible`).toBeVisible();
    await expect(publisher, `row ${index + 1} publisher should be visible`).toBeVisible();
    await expect(contribution, `row ${index + 1} log action should be visible`).toBeVisible();
    await expect(price, `row ${index + 1} price should be visible`).toBeVisible();
    await expectTouchTarget(venue, `row ${index + 1} Venue`);
    await expectTouchTarget(contribution, `row ${index + 1} log action`);
    await expectHorizontallyInsideViewport(page, venue, `row ${index + 1} Venue`);
    await expectHorizontallyInsideViewport(page, pint, `row ${index + 1} pint`);
    await expectHorizontallyInsideViewport(page, publisher, `row ${index + 1} publisher`);
    await expectHorizontallyInsideViewport(page, contribution, `row ${index + 1} log action`);
    await expectHorizontallyInsideViewport(page, price, `row ${index + 1} price`);

    const venueHref = await venue.getAttribute("href");
    expect(venueHref, `row ${index + 1} Venue should link to its Ledger`).toMatch(/^\/ledger\//);
    const venueId = decodeURIComponent(venueHref!.slice("/ledger/".length));
    await expect(contribution).toHaveAttribute("href", expectedMapHref(venueId));

    const publisherLink = publisher.getByRole("link");
    if (await publisherLink.count()) {
      await expectTouchTarget(publisherLink, `row ${index + 1} publisher link`);
    }
  }

  await expectVisibleFocus(
    rows.first().locator(".drinkBrandAreaLanding__venue"),
    `${viewportName}px ${theme} first Ledger link`,
  );
  await expectVisibleFocus(
    rows.first().getByRole("link", { name: "Log this price", exact: true }),
    `${viewportName}px ${theme} first row log action`,
  );
  const firstPublisherLink = rows.first().locator(".drinkBrandAreaLanding__publisher a");
  if (await firstPublisherLink.count()) {
    await expectVisibleFocus(
      firstPublisherLink,
      `${viewportName}px ${theme} first publisher link`,
    );
  }

  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const viewport of [...MOBILE_VIEWPORTS, DESKTOP_VIEWPORT]) {
  for (const theme of THEMES) {
    test.describe(`${viewport.name}px ${theme} governed brand area landing`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        hasTouch: viewport.hasTouch,
        isMobile: viewport.isMobile,
      });

      test("answers above fold with exact touch-safe actions", async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const errors = watchBrowserErrors(page);
        await setLandingState(page, theme);
        await assertLandingContract(page, theme, viewport.name);
        await page.screenshot({
          path: proofScreenshotPath(
            testInfo,
            `victoria-guinness-${viewport.name}-${theme}.png`,
          ),
          fullPage: false,
        });
        expect(errors, `${viewport.name}px ${theme} landing should not emit browser errors`).toEqual([]);
      });
    });
  }
}
