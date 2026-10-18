import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";

// The Pal on the map (components/map/canvas/palMarker.ts): the reader's own
// Pub Pal perches beside the pub they open, takes no taps from the pins under
// it, and is never made for a Pal the reader hid. Shots land in
// artifacts/pal-map-marker/ (gitignored).

const SHOTS = "artifacts/pal-map-marker";
const VENUE_ID = "venue-xjf3n0";
// Three Soho stops from the "Victorian Soho" curated crawl (alt-crawls.spec.ts).
const CRAWL = "venue-1ufn31x,venue-1t8siin,venue-xiesdn";

async function seedPal(page: Page, hidden = false): Promise<void> {
  await page.addInitScript(({ appearance, personality, voice, hidden: palHidden }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner-e2e", name: "Ripley",
      adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: palHidden,
      proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    }));
  }, { ...DEFAULT_PAL_DRAFT, hidden });
}

test.describe("the Pal on the map", () => {
  test("perches beside the open pub and takes no taps", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPal(page);
    await page.goto(`/map?sel=${VENUE_ID}`);

    const marker = page.locator(".palMapMarker");
    await expect(marker).toBeVisible({ timeout: 60_000 });
    await expect(marker).toHaveAttribute("aria-hidden", "true");
    await expect(marker.locator("a, button")).toHaveCount(0);
    expect(await marker.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
    const image = marker.locator("img");
    await expect(image).toHaveAttribute("src", /avatar/);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await page.waitForTimeout(1_200);
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/pal-on-map-390.png` });
  });

  test("is never made for a Pal the reader hid", async ({ page }) => {
    test.setTimeout(120_000);
    await seedPal(page, true);
    await page.goto(`/map?sel=${VENUE_ID}`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3_000);
    await expect(page.locator(".palMapMarker")).toHaveCount(0);
  });

  test("walks the crawl route once, then rests beside the last stop", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPal(page);
    await page.goto(`/map?mode=build&pubs=${CRAWL}`);

    const marker = page.locator(".palMapMarker");
    await expect(marker).toHaveAttribute("data-pal-walk", "walking", { timeout: 60_000 });
    await expect(marker.locator("a, button")).toHaveCount(0);
    await mkdir(SHOTS, { recursive: true });
    const box = async () => (await marker.boundingBox())!;
    const first = await box();
    await page.screenshot({ path: `${SHOTS}/pal-walking-390.png` });
    await page.waitForTimeout(1_500);
    const later = await box();
    // It moved along the route on its own, with no camera move asked for.
    expect(Math.hypot(later.x - first.x, later.y - first.y)).toBeGreaterThan(4);

    await expect(marker).toHaveAttribute("data-pal-walk", "rested", { timeout: 30_000 });
    await expect(marker).not.toHaveClass(/isWalking/);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/pal-rested-390.png` });
  });

  test("waits at the first stop under reduced motion", async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedPal(page);
    await page.goto(`/map?mode=build&pubs=${CRAWL}`);
    const marker = page.locator(".palMapMarker");
    await expect(marker).toHaveAttribute("data-pal-walk", "waiting", { timeout: 60_000 });
    const first = (await marker.boundingBox())!;
    await page.waitForTimeout(2_000);
    const later = (await marker.boundingBox())!;
    expect(Math.hypot(later.x - first.x, later.y - first.y)).toBeLessThan(1);
  });
});

