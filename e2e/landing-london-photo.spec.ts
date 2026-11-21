import { expect, test, type Page } from "@playwright/test";

import { landingPhotoFor } from "@/lib/landingImagery";

// The landing pages show London (captain 6 Sep 2026). What a browser proves
// that a unit test cannot: the photograph really paints, its credit is really
// on screen, the card's own scrim is really the alpha the contrast contract is
// proved at, and adding a picture did not push the landing's one primary
// action under the fold at 390x844, the law e2e/landing-find-my-pint.spec.ts
// owns, and the reason the picture is the card's backdrop rather than a band.
//
// The home card stands on a photograph only when lib/landingImagery.ts keys
// one on that card's own venue id. Which pub the card names moves with the
// dataset, so a spec reads the venue id off the card's map link and asks the
// same table, never the picture that happened to render.

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

/** The venue id the home card names, read off its pub name's map link. */
async function homeCardVenueId(page: Page): Promise<string> {
  const href = await page.locator("#lp-answer-name a").getAttribute("href");
  const venueId = new URL(href ?? "/", "http://localhost").searchParams.get("sel");
  expect(venueId, "the home card links its pub on the map").toBeTruthy();
  return venueId as string;
}

test("the landing card shows its own pub's photograph, or no photograph at all", async ({ page }) => {
  const cardPhotoRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/landing/london/")) cardPhotoRequests.push(request.url());
  });
  await open(page, "/", { width: 390, height: 844 });

  const card = page.locator(".lpAnswerCard");
  await expect(card).toHaveCount(1);
  const resolved = landingPhotoFor({ venueId: await homeCardVenueId(page) });

  if (resolved.scope !== "pub") {
    // We hold no photograph of this pub, so the card is its name, price and
    // source as text. No view of another place stands in, none is credited,
    // and none is fetched.
    await expect(card.locator("img")).toHaveCount(0);
    await expect(card.locator(".landingPhotoCredit")).toHaveCount(0);
    await expect(card).not.toContainText("Photo:");
    await expect(card.locator("#lp-answer-name a")).toBeVisible();
    await expect(card.locator(".lpPubPrice")).toContainText(/£\d+\.\d{2}/);
    await expect(card.locator(".lpPubSource")).toBeVisible();
    // The stock photograph left the hero with the hunt (1 Nov 2026), so a text
    // card leaves the first screen with no image at all.
    await expect(page.locator(".lpHero img")).toHaveCount(0);
    expect(cardPhotoRequests).toEqual([]);
    return;
  }

  const image = card.locator(".landingPhoto__img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);
  await image.evaluate((image: HTMLImageElement) => image.decode());
  // A decoded picture, not a broken <img> with alt text where a photo should be.
  const decoded = await image.evaluate((node) => {
    const img = node as HTMLImageElement;
    return { w: img.naturalWidth, h: img.naturalHeight, src: img.currentSrc };
  });
  expect(decoded.w).toBeGreaterThan(300);
  expect(decoded.h).toBeGreaterThan(150);
  // The picture is the one keyed on this pub, never any other London view.
  expect(decoded.src).toContain(`/landing/london/${resolved.photo.id}-`);
  await expect(image).toHaveAttribute("alt", resolved.photo.alt);

  // The credit the licence requires is on the card, not hidden behind a hover.
  const credit = card.locator(".landingPhotoCredit");
  await expect(credit).toBeVisible();
  await expect(credit).toContainText(/Photo: .+, (CC |Public domain|PDM)/);
  await expect(credit).toContainText(resolved.photo.credit.author);
});

// The hunt card took the stock photograph's place (captain decisions 2 and 3,
// 1 Nov 2026). What a browser proves that the unit render cannot: the card
// paints at every width with its figure, its source and its day, the stock
// photograph is never fetched, and nothing spills sideways.
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
      const card = page.locator(".lpHero .lpHuntCard");
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
  await open(page, "/", { width: 390, height: 844 });
  const card = page.locator(".lpAnswerCard");
  const resolved = landingPhotoFor({ venueId: await homeCardVenueId(page) });
  if (resolved.scope === "pub") {
    const alpha = await card.locator(".landingPhoto__scrim").evaluate((node) => {
      const background = getComputedStyle(node).backgroundImage;
      return [...background.matchAll(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/g)].map((m) => Number(m[1]));
    });
    expect(alpha.length).toBeGreaterThan(0);
    for (const value of alpha) expect(value).toBeGreaterThanOrEqual(0.72);
  } else {
    // A text card has no photograph under its words, so it carries no scrim.
    await expect(card.locator(".landingPhoto__scrim")).toHaveCount(0);
  }

  // An area landing's band credit sits over its photograph on every run, so
  // the contract is proved in a browser whichever pub the home card names.
  // Borough chapters no longer carry a band: their photograph is a
  // PlacePhoto with the credit under it (#2352).
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
  const primary = page.locator(".lpHero [data-primary-action] a");
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
