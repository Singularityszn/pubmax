import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";

// The pint price needle (components/map/VenuePintNeedle.tsx) on a pub's
// Overview, with the reader's own Pal at the pivot. Shots land in
// artifacts/pal-pint-needle/ (gitignored).

const SHOTS = "artifacts/pal-pint-needle";
const VENUE_ID = "venue-xjf3n0";

for (const theme of ["light", "dark"] as const) {
  test(`a pub's Overview shows where its pint sits, ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(({ theme: chosen, appearance, personality, voice }) => {
      const now = "2026-10-04T12:00:00.000Z";
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax-theme", chosen);
      window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner-e2e", name: "Ripley",
        adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: false,
        proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
      }));
    }, { theme, ...DEFAULT_PAL_DRAFT });
    await page.goto(`/map?sel=${VENUE_ID}`);

    const needle = page.getByTestId("venue-pint-needle").first();
    await expect(needle).toBeAttached({ timeout: 60_000 });
    await needle.scrollIntoViewIfNeeded();
    await expect(needle).toBeVisible();
    const band = await needle.getAttribute("data-band");
    expect(["cheap", "average", "expensive"]).toContain(band);
    await expect(needle.locator(".venuePintNeedleBand")).toHaveText(band![0]!.toUpperCase() + band!.slice(1));
    await expect(needle.locator("svg")).toHaveAttribute("aria-label", new RegExp(`^£\\d+\\.\\d\\d is ${band} against `));
    await expect.poll(() => needle.locator(".venuePintNeedlePal img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await page.waitForTimeout(1_800);
    await mkdir(SHOTS, { recursive: true });
    const box = (await needle.boundingBox())!;
    await page.screenshot({ path: `${SHOTS}/needle-390-${theme}.png`, clip: { x: 0, y: Math.max(0, box.y - 120), width: 390, height: box.height + 200 } });
  });
}
