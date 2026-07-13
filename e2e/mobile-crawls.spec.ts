import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MIN_TAP_TARGET = 44;

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        rootOverflow: document.documentElement.scrollWidth - window.innerWidth,
        bodyOverflow: document.body.scrollWidth - window.innerWidth,
      })),
    )
    .toEqual({
      viewportWidth: MOBILE_VIEWPORT.width,
      rootOverflow: expect.any(Number),
      bodyOverflow: expect.any(Number),
    });

  const overflow = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollWidth - window.innerWidth,
      document.body.scrollWidth - window.innerWidth,
    ),
  );
  expect(overflow, "page should not scroll horizontally at 390px").toBeLessThanOrEqual(1);
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  expect(Math.round(box!.width), `${label} width`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test.describe("mobile Crawls surfaces", () => {
  test("/crawls renders curated crawls with thumb-sized primary actions and no horizontal overflow", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/crawls");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Every pint has a story." })).toBeVisible();

    const grid = page.getByRole("list", { name: "Curated crawls worth walking" });
    await expect(grid).toBeVisible();

    const cards = page.locator(".curatedCard");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count(), "curated crawl cards should render").toBeGreaterThanOrEqual(3);

    const planButtons = page.locator(".curatedCard .curatedPlanBtn");
    await expect(planButtons.first()).toBeVisible();
    const planButtonBoxes = await planButtons.evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.textContent?.trim() ?? "crawl plan action",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
    );
    expect(planButtonBoxes.length, "primary plan actions should render").toBeGreaterThanOrEqual(3);
    for (const box of planButtonBoxes) {
      expect(box.width, `${box.label} width`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
      expect(box.height, `${box.label} height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }

    await expectTappable(
      page.getByRole("link", { name: "Build your own crawl on the map" }),
      "build your own crawl action",
    );
    await expectNoHorizontalOverflow(page);

    const firstPlanButton = planButtons.first();
    await expect(firstPlanButton).toHaveAttribute("href", /\/map\?mode=build&pubs=/);
    await firstPlanButton.click();
    await expect(page).toHaveURL(/\/map\?mode=build&pubs=/, { timeout: 30_000 });

    const mappedRoute = page.locator(".mappedRouteChip");
    await expect(mappedRoute).toBeVisible({ timeout: 20_000 });
    await expect(mappedRoute).toContainText(/\d+ stops mapped/);
    await expectTappable(mappedRoute.getByRole("button", { name: "Edit" }), "mapped crawl edit action");
    await expectTappable(
      mappedRoute.getByRole("button", { name: "Check last train at final stop" }),
      "mapped crawl last train action",
    );
    await expectTappable(
      mappedRoute.getByRole("button", { name: "Hide mapped crawl" }),
      "mapped crawl hide action",
    );

    await mappedRoute.getByRole("button", { name: "Edit" }).click();
    const routePanel = page.locator(".routePanel");
    await expect(routePanel).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page);

    expect(errors).toEqual([]);
  });

  test("unknown crawl story stays usable on mobile", async ({ page }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/crawls/not-a-real-crawl-story");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { name: "No crawl here" })).toBeVisible();

    const backToCrawls = page.getByRole("link", { name: "Back to crawls" });
    await expect(backToCrawls).toHaveAttribute("href", "/crawls");
    await expectTappable(backToCrawls, "back to crawls action");

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
