import { expect, test, type Page } from "@playwright/test";

// Owner bug (live iPhone Safari): on /feed the scroll position "goes up and
// down" while scrolling — the classic layout-shift bounce. This suite is a
// mechanical regression guard for it.
//
// iOS Safari does NOT implement scroll anchoring (overflow-anchor), so ANY box
// that grows or is inserted ABOVE the reader while they scroll shoves the whole
// reading surface down. Chromium DOES anchor, which would hide the very bug we
// care about — so every test here disables scroll anchoring up front to emulate
// mobile Safari, then asserts a reference card the reader is looking at never
// moves in the viewport while the feed's async content (images, reaction
// summaries, the live "new pints" pill) settles.

const MOBILE = { width: 390, height: 844 };

// A 1×1 transparent PNG — enough for the 9:16 Spill <Image> to have a real src.
// The card reserves its space via `aspect-ratio`, so what the pixels are does
// not matter; only that an async image mounts into a pre-reserved box.
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

type DropSeed = {
  id: string;
  handle: string;
  priceGbp: number | null;
  drink: string;
  passedDownNote: string;
  era: string;
  provenance: string;
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  createdAt: string;
  vibeTags: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
};

// A tall, mixed feed: alternating photo (9:16 Spill) and text-only (receipt)
// cards so the scroll exercises both card silhouettes and their reserved boxes.
function seedDrops(count: number): DropSeed[] {
  const drops: DropSeed[] = [];
  const base = Date.parse("2026-07-13T20:00:00.000Z");
  for (let i = 0; i < count; i += 1) {
    const withPhoto = i % 2 === 0;
    drops.push({
      id: `scroll-drop-${i}`,
      handle: `drinker_${i}`,
      priceGbp: 4 + (i % 5) * 0.4,
      drink: i % 3 === 0 ? "Guinness" : "Lager",
      passedDownNote: `Round ${i} — proper corner table, good chatter, easy route home.`,
      era: "2020s",
      provenance: i % 4 === 0 ? "contributor" : "anecdote",
      venueId: `venue-${i}`,
      venueName: `The Number ${i} Arms`,
      venueMapUrl: `/map?sel=venue-${i}`,
      // Newest first, strictly decreasing so ordering is deterministic/stable.
      createdAt: new Date(base - i * 60_000).toISOString(),
      vibeTags: i % 2 === 0 ? ["cheap", "after work"] : ["lively"],
      pintPhotoUrl: withPhoto ? PNG_1x1 : null,
      venuePhotoUrl: null,
    });
  }
  return drops;
}

async function emulateIosNoScrollAnchoring(page: Page): Promise<void> {
  // iOS Safari has no scroll anchoring. Force the same in Chromium so an
  // above-viewport shift actually manifests (and this test can catch it).
  // Applied after navigation (anchoring is evaluated continuously), so there's
  // no init-time race on document.documentElement.
  await page.addStyleTag({
    content: "html,body,*{overflow-anchor:none !important;}",
  });
}

async function primeFeedRoutes(
  page: Page,
  opts: { drops: DropSeed[]; reactionDelayMs?: number },
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.route("**/api/pint-drops", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ drops: opts.drops }),
    });
  });
  await page.route("**/api/pint-drops/reactions?**", async (route) => {
    // Reactions land AFTER first paint (as they do on a real slow connection).
    // Adding count pills must not grow card height / shift the reader.
    if (opts.reactionDelayMs) {
      await new Promise((r) => setTimeout(r, opts.reactionDelayMs));
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ summaries: {} }),
    });
  });
  await page.route("**/api/presence", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ presence: [] }),
    });
  });
  await page.route("**/api/profiles/*/following", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ following: [] }),
    });
  });
}

// The viewport-space position (top, in CSS px) of the Nth non-skeleton card.
async function nthCardTop(page: Page, n: number): Promise<number | null> {
  return page.evaluate((index) => {
    const cards = Array.from(
      document.querySelectorAll(".feedCard:not(.feedCardSkeleton)"),
    );
    const el = cards[index];
    return el ? el.getBoundingClientRect().top : null;
  }, n);
}

test.describe("feed scroll stability (iOS layout-shift guard)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
  });

  test("async content settling never shifts the card under the reader", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await primeFeedRoutes(page, { drops: seedDrops(16), reactionDelayMs: 700 });

    const response = await page.goto("/feed");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".feedTitle")).toBeVisible();
    await emulateIosNoScrollAnchoring(page);

    // Wait for the real cards to replace the skeletons.
    await expect
      .poll(async () => page.locator(".feedCard:not(.feedCardSkeleton)").count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(4);

    // Slow-scroll down the feed in small steps, recording window.scrollY after
    // each. A doc that shrinks above (content removed / viewport grown) clamps
    // scrollY backwards — assert that never happens beyond a sub-pixel rounding
    // tolerance.
    const TOLERANCE = 2;
    let previous = -1;
    for (let step = 0; step < 24; step += 1) {
      await page.evaluate(() => window.scrollBy(0, 90));
      // Let a frame paint + any async layout land.
      await page.waitForTimeout(60);
      const y = await page.evaluate(() => window.scrollY);
      expect(
        y,
        `scrollY jumped backwards at step ${step} (was ${previous}, now ${y})`,
      ).toBeGreaterThanOrEqual(previous - TOLERANCE);
      previous = y;
    }

    // Now the acid test for above-viewport insertion under emulated iOS: park at
    // a fixed scroll offset, pick a card the reader is looking at, and hold it
    // in view while the reaction summaries (delayed 700ms) stream in. Its
    // viewport-space top must not move — a shift here is exactly the "scroll
    // goes up and down" bounce.
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(50);

    // Choose the first card whose top is comfortably on screen as the anchor.
    const anchorIndex = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll(".feedCard:not(.feedCardSkeleton)"),
      );
      for (let i = 0; i < cards.length; i += 1) {
        const top = cards[i].getBoundingClientRect().top;
        if (top > 80 && top < 700) return i;
      }
      return 0;
    });

    const initialTop = await nthCardTop(page, anchorIndex);
    expect(initialTop).not.toBeNull();

    // Sample the anchor card's top over ~1.5s (covers the reaction delay + swap).
    for (let sample = 0; sample < 15; sample += 1) {
      await page.waitForTimeout(100);
      const y = await page.evaluate(() => window.scrollY);
      // Guard: we must not have drifted the scroll ourselves.
      expect(Math.abs(y - 900)).toBeLessThanOrEqual(TOLERANCE);
      const top = await nthCardTop(page, anchorIndex);
      expect(top).not.toBeNull();
      expect(
        Math.abs((top as number) - (initialTop as number)),
        `anchor card moved ${(top as number) - (initialTop as number)}px in the viewport while async content loaded (sample ${sample})`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }

    expect(errors).toEqual([]);
  });

  test("the live 'new pints' pill is a floating overlay, out of document flow", async ({
    page,
  }) => {
    // The pill appears whenever a background poll buffers new drops — potentially
    // while the reader is mid-feed. If it were an in-flow box it would shove the
    // list down on iOS every time it toggled. It must be position:fixed so its
    // appearance/disappearance never participates in layout. (Driving the real
    // 30s poll is slow + flaky under a fake clock, so we assert the structural
    // CSS contract that makes the pill non-displacing.)
    await primeFeedRoutes(page, { drops: seedDrops(8) });
    await page.goto("/feed");
    await expect(page.locator(".feedTitle")).toBeVisible();
    await expect
      .poll(async () => page.locator(".feedCard:not(.feedCardSkeleton)").count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    const probe = await page.evaluate(() => {
      const host = document.querySelector(".feedMain") ?? document.body;
      const el = document.createElement("button");
      el.className = "feedNewPill";
      el.textContent = "3 new pints — tap to show";
      host.appendChild(el);
      const cs = getComputedStyle(el);
      const result = { position: cs.position };
      el.remove();
      return result;
    });

    expect(
      probe.position,
      "the new-pints pill must be a fixed overlay so it never displaces the feed",
    ).toBe("fixed");
  });
});
