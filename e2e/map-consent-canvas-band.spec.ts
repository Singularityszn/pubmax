import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// THE CHIP ROW SITS ON THE MAP, NEVER ON A BAND.
//
// Captain's site audit, 13 Sep 2026: on the phone map a dark band stood behind
// the chip row only while the analytics consent card held the foot, and no
// element painted it. Measured on a production build at 390x844, dpr 2: the
// card is a square, opaque, full-width strip, and the compositor culled the
// WebGL canvas under the card's rect MIRRORED in y, so the canvas dropped out
// from y 64 to 119 and the map container's own background showed through.
// Moving the card up moved the band down by the same amount; hiding the card,
// or making its layer not fully opaque, gave the map back.
//
// A CLIPPED screenshot re-renders only the clip and never shows the band, so
// the frame is captured whole and cropped here. The canvas is compared with
// itself, with the card painted and with the card hidden, on one camera, so a
// pin or a tile can never read as a difference: only the hole can.

const ARNOS_ARMS_ID = "venue-xjf3n0";
const DPR = 2;
/** Mean absolute channel difference, 0 to 255, that the strip may differ by. */
const MAX_MEAN_CHANNEL_DIFFERENCE = 2;

test.use({ storageState: { cookies: [], origins: [] }, deviceScaleFactor: DPR });

async function prepareStranger(page: Page, width: number, colorScheme: "light" | "dark") {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    const PREPARED = "pw:consent-canvas-band-prepared";
    if (window.sessionStorage.getItem(PREPARED) !== null) return;
    window.sessionStorage.setItem(PREPARED, "1");
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
    window.sessionStorage.removeItem("pubmax:consent-answer-moment:v1");
    window.sessionStorage.removeItem("pubmax:consent-first-route:v1");
  });
}

/** The empty stretch of the chip row: after its last chip, before the corner lane. */
async function emptyChipRowStrip(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(".mobileMapChipRow");
    if (!row) return null;
    const box = row.getBoundingClientRect();
    const chipsRight = Math.max(
      box.left,
      ...Array.from(row.children).map((chip) => chip.getBoundingClientRect().right),
    );
    const contentRight = box.right - Number.parseFloat(getComputedStyle(row).paddingRight);
    return {
      x: Math.ceil(chipsRight + 8),
      y: Math.ceil(box.top + 2),
      width: Math.floor(contentRight - chipsRight - 16),
      height: Math.floor(box.height - 4),
    };
  });
}

async function stripPixels(page: Page, strip: { x: number; y: number; width: number; height: number }) {
  // Two frames, so a style change has reached the compositor before the capture.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForTimeout(500);
  const frame = await page.screenshot({ animations: "disabled" });
  const { data } = await sharp(frame)
    .extract({
      left: strip.x * DPR,
      top: strip.y * DPR,
      width: strip.width * DPR,
      height: strip.height * DPR,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function meanChannelDifference(a: Buffer, b: Buffer): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

for (const width of [390, 430] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`the chip row sits on the map while the consent card holds the foot @${width}x844 ${colorScheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await prepareStranger(page, width, colorScheme);
      await installDeterministicMapBasemap(page);

      // The first action, a pub opened, is what lets the card arrive.
      await page.goto(`/map?sel=${ARNOS_ARMS_ID}`, { waitUntil: "domcontentloaded" });
      const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
      await expect(venueSheet).toBeVisible({ timeout: 45_000 });
      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax:consent-answer-moment:v1")))
        .toBe("venue-sheet");
      await expect(async () => {
        await venueSheet.getByRole("button", { name: "Close pub detail" }).click();
        await expect(venueSheet).toHaveCount(0, { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });

      const prompt = page.getByLabel("Anonymous analytics choice");
      await expect(prompt).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".mobileMapChipRow")).toBeVisible();
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
      await page.waitForTimeout(1_500);

      const strip = await emptyChipRowStrip(page);
      expect(strip, "the chip row has a box").not.toBeNull();
      expect(strip!.width, "the chip row has an empty stretch to sample").toBeGreaterThanOrEqual(40);

      const withCard = await stripPixels(page, strip!);
      // Hidden, not removed: every `body:has(.analyticsConsentPrompt)` rule still
      // holds, so the layout and the camera are the ones the reader has.
      const hide = await page.addStyleTag({
        content: ".analyticsConsentPrompt { visibility: hidden !important; }",
      });
      const withoutCard = await stripPixels(page, strip!);
      await hide.evaluate((el) => el.remove());

      expect(
        meanChannelDifference(withCard, withoutCard),
        "the map behind the chip row changes while the consent card is painted",
      ).toBeLessThanOrEqual(MAX_MEAN_CHANNEL_DIFFERENCE);
    });
  }
}
