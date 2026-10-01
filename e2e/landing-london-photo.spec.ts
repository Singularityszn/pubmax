import { expect, test, type Page } from "@playwright/test";

// The landing pages show London (captain 6 Sep 2026). What a browser proves
// that a unit test cannot: the photograph really paints, its credit is really
// on screen, the card's own scrim is really the alpha the contrast contract is
// proved at, and adding a picture did not push the landing's one primary
// action under the fold at 390x844, the law e2e/landing-find-my-pint.spec.ts
// owns, and the reason the picture is the card's backdrop rather than a band.

async function open(page: Page, path: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
}

test("the landing card stands on a photograph that really loaded", async ({ page }) => {
  await open(page, "/", { width: 390, height: 844 });

  const card = page.locator(".lpPubCard--photo");
  await expect(card).toHaveCount(1);

  const image = card.locator(".landingPhoto__img");
  await expect(image).toBeVisible();
  // A decoded picture, not a broken <img> with alt text where a photo should be.
  const decoded = await image.evaluate((node) => {
    const img = node as HTMLImageElement;
    return { w: img.naturalWidth, h: img.naturalHeight, src: img.currentSrc };
  });
  expect(decoded.w).toBeGreaterThan(300);
  expect(decoded.h).toBeGreaterThan(150);
  expect(decoded.src).toContain("/landing/london/");

  // The credit the licence requires is on the card, not hidden behind a hover.
  const credit = card.locator(".landingPhotoCredit");
  await expect(credit).toBeVisible();
  await expect(credit).toContainText(/Photo: .+, (CC |Public domain|PDM)/);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`the London skyline paints without horizontal overflow at ${viewport.width}`, async ({ page }) => {
    await open(page, "/", viewport);
    const photo = page.getByRole("img", { name: "Tower Bridge and the Thames in London from above" });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) =>
      image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await photo.evaluate((image: HTMLImageElement) => image.currentSrc)).toContain("/landing/hero-thames-");
    await expect(page.locator("svg.lpMapSnapshot")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("the card's scrim ships the alpha the contrast contract is proved at", async ({ page }) => {
  await open(page, "/", { width: 390, height: 844 });
  const alpha = await page.locator(".lpPubCard--photo .landingPhoto__scrim").evaluate((node) => {
    const background = getComputedStyle(node).backgroundImage;
    return [...background.matchAll(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/g)].map((m) => Number(m[1]));
  });
  expect(alpha.length).toBeGreaterThan(0);
  for (const value of alpha) expect(value).toBeGreaterThanOrEqual(0.72);
});

test("the picture costs the primary action nothing: it stays above the fold", async ({ page }) => {
  await open(page, "/", { width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const primary = page.locator(".lpHero [data-primary-action] a");
  const box = await primary.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(845);
});

test("a borough chapter carries its own picture, and nothing spills sideways", async ({ page }) => {
  await open(page, "/borough/camden", { width: 320, height: 568 });
  const band = page.locator(".landingPhoto--band");
  await expect(band).toHaveCount(1);
  await expect(band.locator(".landingPhoto__img")).toBeVisible();
  await expect(band.locator(".landingPhotoCredit")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a borough we hold no picture of still shows London, never an empty slot", async ({ page }) => {
  await open(page, "/borough/waltham-forest", { width: 390, height: 844 });
  const band = page.locator(".landingPhoto--band");
  await expect(band).toHaveCount(1);
  await expect(band.locator(".landingPhoto__img")).toBeVisible();
  await expect(page.getByText("No photo yet")).toHaveCount(0);
});
