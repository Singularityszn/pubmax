import { expect, test } from "@playwright/test";

// The V0.1 phone pass for the surfaces OUTSIDE the map shell. The map, the
// landing and the venue sheet already have their own rendered-geometry fences
// (e2e/mobile-map-chrome-fit.spec.ts, __tests__/mobileChromeFit.test.ts); these
// pages had none, and the first measured run found three control rows painting
// under the house 44px floor — the Discover brand chips at 35px, the Pubs jump
// chips at 32px, and the Find-your-lot invite link at 16px.
//
// TWO THINGS ARE MEASURED, both from the rendered page rather than from CSS,
// because both defects were invisible at desktop width and to any unit render:
//   - no horizontal overflow at 360, 390 and 430;
//   - every standalone control clears 44px tall and 24px wide.
//
// WHAT COUNTS AS A STANDALONE CONTROL, and why the line is drawn there: a link
// flowing inside a sentence is exempt from the target-size rule by WCAG's own
// inline exception, and /about is largely prose. So the sweep takes buttons,
// selects, summaries, anything with an explicit button/tab role, and every
// anchor the page has laid out as its OWN box (a computed display that is not
// `inline`). That is the same distinction a thumb makes.
const WIDTHS = [360, 390, 430] as const;

const ROUTES = ["/about", "/discover", "/pubs", "/social", "/login", "/messages"] as const;

const MIN_TAP_HEIGHT_PX = 44;
const MIN_TAP_WIDTH_PX = 24;

/** How long a page is given to stop revealing sections before it is measured. */
const SETTLE_CEILING_MS = 15_000;
const SETTLE_QUIET_MS = 600;

async function settle(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  const deadline = Date.now() + SETTLE_CEILING_MS;
  let previous = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => document.querySelectorAll("*").length);
    if (count !== previous) {
      previous = count;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= SETTLE_QUIET_MS) {
      return;
    }
    await page.waitForTimeout(150);
  }
}

// A PHONE, not a narrow desktop window. The floors these pages state are
// scoped to `@media (pointer: coarse)` so desktop density is untouched, and a
// desktop context reports a fine pointer however narrow its viewport is — so a
// run without touch emulation would measure the desktop rules and report the
// fix as missing.
test.use({ hasTouch: true, isMobile: true });

test.describe("phone controls on the launch surfaces", () => {
  for (const route of ROUTES) {
    test(`${route} fits and stays tappable at 360/390/430`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(route, { waitUntil: "load" });
        // Several of these pages reveal a section only once it is near the
        // viewport (Discover's leaderboard is the loudest), and how much of a
        // page that is depends on the width — which is exactly how the first
        // run of this spec found the leaderboard link at 390 and not at 360.
        // Walk to the bottom, then wait for the DOM to stop growing, so the
        // sweep measures the same page every time.
        await settle(page);

        const report = await page.evaluate(
          ({ minHeight, minWidth }) => {
            const doc = document.documentElement;
            const overflowPx = Math.max(0, Math.round(doc.scrollWidth - doc.clientWidth));

            const selector =
              'button, select, summary, [role="button"], [role="tab"], a[href]';
            const small: string[] = [];
            for (const element of Array.from(document.querySelectorAll(selector))) {
              const style = getComputedStyle(element);
              if (style.visibility === "hidden" || style.display === "none") continue;
              // A link in a sentence is not a control (WCAG inline exception).
              if (element.tagName === "A" && style.display === "inline") continue;
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              if (rect.height >= minHeight && rect.width >= minWidth) continue;
              const name =
                (element.className || "").toString().split(" ").filter(Boolean)[0] ??
                element.tagName.toLowerCase();
              small.push(`${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
            }
            return { overflowPx, small: [...new Set(small)] };
          },
          { minHeight: MIN_TAP_HEIGHT_PX, minWidth: MIN_TAP_WIDTH_PX },
        );

        expect(
          `${route} @${width}: overflow ${report.overflowPx}px`,
          "A phone page may never scroll sideways.",
        ).toBe(`${route} @${width}: overflow 0px`);

        expect(
          `${route} @${width}: ${report.small.join(", ") || "every control clears the floor"}`,
        ).toBe(`${route} @${width}: every control clears the floor`);
      }
    });
  }
});
