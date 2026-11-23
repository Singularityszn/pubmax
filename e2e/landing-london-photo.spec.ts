import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import type { SlimVenue } from "@/lib/venuesSlim";

// The landing pages show London (captain 6 Sep 2026). What a browser proves
// that a unit test cannot: the photograph really paints, its credit is really
// on screen, the card's own scrim is really the alpha the contrast contract is
// proved at, and adding a picture did not push the landing's one primary
// action under the fold at 390x844, the law e2e/landing-find-my-pint.spec.ts
// owns, and the reason the picture is the card's backdrop rather than a band.
//
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

const OWNED_PUB = {
  id: "venue-eltcmh",
  name: "The Black Friar",
  photoId: "the-black-friar",
  alt: "Inside The Black Friar, the Art Nouveau pub at Blackfriars in the City of London",
} as const;

async function openPubFixture(page: Page, context: BrowserContext, pub: { id: string; name: string }) {
  await page.clock.setFixedTime(new Date("2026-11-21T12:00:00Z"));
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5116, longitude: -0.103 });
  const rows: SlimVenue[] = [pub, ...Array.from({ length: 3 }, (_, index) => ({
    id: `venue-photo-neighbour-${index}`, name: `Photo Neighbour ${index + 1}`,
  }))].map((venue, index) => ({
    id: venue.id,
    name: venue.name,
    lat: 51.5116 + index * 0.0001,
    lng: -0.103,
    borough: "City of London",
    kind: "pub" as const,
    cheapestPrice: 4 + index,
    measure: "pint",
    priceSource: "Fixture menu",
    priceObservedAt: "2026-11-20",
  }));
  const { revision } = JSON.parse(await readFile("public/data/venues_slim.json", "utf8")) as { revision: string };
  await page.route(/\/data\/venues_slim\.json(?:\?.*)?$/, (route) => route.fulfill({ json: { revision, rows } }));
  await page.route("**/api/venue/*", (route) => route.fulfill({ json: { venue: { prices: [] } } }));
  await open(page, "/", { width: 390, height: 844 });
  await expect(page.locator("#lp-answer-name a")).toHaveText(pub.name);
  await expect.poll(() => homeCardVenueId(page)).toBe(pub.id);
}

for (const pub of [OWNED_PUB, { id: "venue-without-photo", name: "The Black Friar" }]) {
  test(`the landing photograph belongs to venue ${pub.id}`, async ({ page, context }) => {
    await openPubFixture(page, context, pub);
    const card = page.locator(".lpAnswerCard");
    if (pub.id !== OWNED_PUB.id) {
      await expect(card.locator("img")).toHaveCount(0);
      await expect(card.locator(".landingPhotoCredit")).toHaveCount(0);
      await expect(card.locator(".landingPhoto__scrim")).toHaveCount(0);
      await expect(card).not.toContainText("Photo:");
      await expect(card.locator("#lp-answer-name a")).toBeVisible();
      await expect(card.locator(".lpPubPrice")).toContainText("£4.00");
      return;
    }

    const image = card.locator(".landingPhoto__img");
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((image: HTMLImageElement) =>
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);
    await image.evaluate((image: HTMLImageElement) => image.decode());
    const decoded = await image.evaluate((node) => {
      const img = node as HTMLImageElement;
      return { w: img.naturalWidth, h: img.naturalHeight, src: img.currentSrc };
    });
    expect(decoded.w).toBeGreaterThan(300);
    expect(decoded.h).toBeGreaterThan(150);
    expect(decoded.src).toContain(`/landing/london/${OWNED_PUB.photoId}-`);
    await expect(image).toHaveAttribute("alt", OWNED_PUB.alt);
    const credit = card.locator(".landingPhotoCredit");
    await expect(credit).toBeVisible();
    await expect(credit).toContainText("Photo: Love Art Nouveau, CC BY 2.0");
  });
}

test("text over a landing photograph ships the alpha the contrast contract is proved at", async ({ page, context }) => {
  await openPubFixture(page, context, OWNED_PUB);
  const card = page.locator(".lpAnswerCard");
  await expect(card.locator(".landingPhoto__scrim")).toHaveCount(1);
  const alpha = await card.locator(".landingPhoto__scrim").evaluate((node) => {
    const background = getComputedStyle(node).backgroundImage;
    return [...background.matchAll(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/g)].map((m) => Number(m[1]));
  });
  expect(alpha.length).toBeGreaterThan(0);
  for (const value of alpha) expect(value).toBeGreaterThanOrEqual(0.72);

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

test("the primary action stays above the fold", async ({ page }) => {
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
