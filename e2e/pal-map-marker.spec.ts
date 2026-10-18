import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";

// The Pal on the map (components/map/canvas/palMarker.ts): the reader's own
// Pub Pal perches beside the pub they open, takes no taps from the pins under
// it, and is never made for a Pal the reader hid. Shots land in
// artifacts/pal-map-marker/ (gitignored).

const SHOTS = "artifacts/pal-map-marker";
const VENUE_ID = "venue-xjf3n0";

async function seedPal(page: Page, hidden = false): Promise<void> {
  await page.addInitScript(({ appearance, personality, voice, hidden: palHidden }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
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
});
