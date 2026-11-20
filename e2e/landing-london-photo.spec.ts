import { expect, test, type Page } from "@playwright/test";

async function open(
  page: Page,
  path: string,
  viewport: { width: number; height: number },
  waitUntil: "load" | "domcontentloaded" = "load",
) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const response = await page.goto(path, { waitUntil });
  expect(response?.status()).toBe(200);
}

test.describe("the hunt card in the photograph's place", () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1150, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    test(`shows the cheapest pint with its source and day at ${viewport.width}`, async ({ page }) => {
      const stockPhoto: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/landing/hero-thames")) stockPhoto.push(request.url());
      });
      await open(page, "/", viewport);
      await page.getByText("Explore more prices and places", { exact: true }).click();
      const card = page.locator(".landingMore .lpHuntCard");
      await expect(card).toBeVisible();
      await expect(card.locator(".lpHuntFigure")).toContainText(/£\d+\.\d{2}/);
      await expect(card.locator(".lpHuntSource a")).toBeVisible();
      await expect(card.locator(".lpHuntSource time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
      expect(stockPhoto).toEqual([]);
      await expect(page.locator("svg.lpMapSnapshot")).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test("text over a landing photograph ships the alpha the contrast contract is proved at", async ({ page }) => {
  await open(page, "/area/victoria/drink/guinness", { width: 390, height: 844 });
  const creditAlpha = await page.locator(".landingPhoto--band .landingPhotoCredit").evaluate((node) => {
    const match = getComputedStyle(node).backgroundColor.match(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/);
    return match ? Number(match[1]) : 1;
  });
  expect(creditAlpha).toBeGreaterThanOrEqual(0.72);
});

test("the hunt card costs the primary action nothing: it stays above the fold", async ({ page }) => {
  await open(page, "/", { width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const primary = page.locator(".landingMapHero [data-primary-action]");
  const box = await primary.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(845);
});

test("a borough chapter carries its own picture, and nothing spills sideways", async ({ page }) => {
  await open(page, "/borough/camden", { width: 320, height: 568 });
  const photo = page.locator(".boroughPhoto");
  await expect(photo).toHaveCount(1);
  await expect(photo).toHaveAttribute("data-photo-scope", "borough");
  await expect(photo.locator(".placePhoto__img")).toBeVisible();
  await expect(photo.locator(".placePhotoCredit")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a borough we hold no picture of still shows London, never an empty slot", async ({ page }) => {
  await open(page, "/borough/waltham-forest", { width: 390, height: 844 });
  const photo = page.locator(".boroughPhoto");
  await expect(photo).toHaveCount(1);
  await expect(photo).toHaveAttribute("data-photo-scope", "london");
  await expect(photo.locator(".placePhoto__img")).toBeVisible();
  await expect(page.getByText("No photo yet")).toHaveCount(0);
});
