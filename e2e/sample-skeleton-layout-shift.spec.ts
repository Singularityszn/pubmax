import { expect, test, type Page } from "@playwright/test";

import { storeThemeChoice } from "./helpers/themeClock";

// THE WAIT HAS THE ANSWER'S SIZE (components/ui/sample-skeleton.tsx).
//
// The profile timeline waits behind its own feed cards drawn from sample drops.
// This holds the timeline's read, lets the sampled cards paint, then answers
// with two photo drops and reads two things a unit test cannot: the list that
// arrives is the height of the wait it replaced, and nothing in or under the
// timeline is scored as a layout shift when it lands. The hand-drawn copy it
// replaced drew nothing at all here, because it needed feed.css and no first
// paint loads it.

const HANDLE = "sample_skeleton_e2e";

const DROPS = ["drop-a", "drop-b"].map((id, index) => ({
  id,
  handle: HANDLE,
  venueId: `venue-sample-e2e-${index}`,
  venueName: "The Test Arms",
  drink: "",
  priceGbp: null,
  passedDownNote: "A quiet one by the window.",
  era: "",
  provenance: "contributor",
  createdAt: "2026-10-01T19:00:00.000Z",
  vibeTags: [],
  pintPhotoUrl: "/landing/hero-thames-1024.jpg",
  venuePhotoUrl: null,
}));

type Shift = { value: number; afterTimelineStart: boolean };

declare global {
  interface Window {
    __sampleSkeletonShifts?: Shift[];
  }
}

/** Records every scored shift and whether its moved nodes sit in or under the timeline. */
async function recordShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__sampleSkeletonShifts = [];
    new PerformanceObserver((list) => {
      const timeline = document.getElementById("timeline");
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: Array<{ node?: Node | null }> }
      >) {
        if (entry.hadRecentInput) continue;
        const afterTimelineStart = (entry.sources ?? []).some(({ node }) => {
          if (!node || !timeline) return false;
          return (
            timeline.contains(node) ||
            Boolean(timeline.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
          );
        });
        window.__sampleSkeletonShifts?.push({ value: entry.value, afterTimelineStart });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

test.describe("sample skeleton", () => {
  test("the profile timeline's wait has the answer's size, and the answer moves nothing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await storeThemeChoice(page, "light");
    await recordShifts(page);

    let answer: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route(/\/api\/pint-drops\?author=/, async (route) => {
      await held;
      await route.fulfill({ json: { drops: DROPS, passportAreas: [] } });
    });
    await page.route(/\/api\/pint-drops\/reactions/, (route) =>
      route.fulfill({ json: { summaries: {} } }),
    );

    await page.goto(`/u/${HANDLE}`);

    const wait = page.locator("#timeline [data-sample-skeleton]");
    await expect(wait).toHaveAttribute("aria-busy", "true");
    await expect(wait.locator(".sampleSkeletonSample[inert][aria-hidden='true'] > article.feedCard")).toHaveCount(2);
    await expect(page.locator("#timeline p.sr-only[role='status']")).toHaveText("Loading the timeline");
    // Past the 600 ms grace the shapes are painted.
    await expect.poll(() => wait.evaluate((node) => getComputedStyle(node).opacity)).not.toBe("0");

    // Bring the timeline into view: only a shift on screen is scored.
    await page.locator("#timeline").evaluate((node) => node.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    const before = await wait.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    await page.evaluate(() => {
      window.__sampleSkeletonShifts = [];
    });

    answer();
    const list = page.locator("#timeline .profileTimeline");
    await expect(list.locator("> article.feedCard")).toHaveCount(2);
    await expect(wait).toHaveCount(0);
    // Two frames for the browser to score anything the swap moved.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.waitForTimeout(500);

    const after = await list.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    expect(Math.abs(after.top - before.top), "nothing above the timeline moved it").toBeLessThan(1);
    expect(Math.abs(after.height - before.height), "the answer is the wait's height").toBeLessThan(1);

    const shifts = await page.evaluate(() => window.__sampleSkeletonShifts ?? []);
    const scored = shifts.filter((shift) => shift.afterTimelineStart).reduce((sum, shift) => sum + shift.value, 0);
    expect(scored, JSON.stringify(shifts)).toBeLessThan(0.001);
  });
});
