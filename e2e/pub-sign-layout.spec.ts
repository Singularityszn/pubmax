import { expect, test } from "@playwright/test";

import { storeThemeChoice } from "./helpers/themeClock";

test.use({ serviceWorkers: "block" });

// A4 requires a legible illustrated fallback inside the existing photo frame.
// Measure the painted board, not only the SVG box: overflowing art can cover
// the caption even when the grid rows themselves remain separate.
for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    for (const textScale of [1, 2]) {
      test(`gallery sign and caption stay separate: ${width}px ${theme} ${textScale * 100}% text`, async ({ page }, testInfo) => {
        test.slow();
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await storeThemeChoice(page, theme);
        // Exhaust the real photo candidates at the network boundary.
        await page.route("**/*", (route) => {
          const url = new URL(route.request().url());
          return url.hostname === "localhost" && url.pathname !== "/api/image-proxy"
            ? route.continue()
            : route.abort();
        });
        await page.goto("/pubs");
        const card = page.locator(".pubsCard").first();
        const sign = card.locator(".pubSign");
        await expect(sign.getByRole("img", { name: /^Illustrated sign for / })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        if (textScale === 2) {
          await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
        }
        await card.scrollIntoViewIfNeeded();

        // The server can reveal the sign before hydration briefly restores
        // its lazy placeholder. Measure the mounted drawing after it settles.
        await expect(async () => {
          const geometry = await card.evaluate((element) => {
            const rect = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
            const board = rect(".pubSign__swing");
            const caption = rect(".pubSign__tag");
            const frame = rect(".pubsCardArt");
            return {
              boardBottom: board.bottom,
              boardHeight: board.height,
              captionTop: caption.top,
              captionBottom: caption.bottom,
              frameBottom: frame.bottom,
              frameWidth: frame.width,
              frameHeight: frame.height,
            };
          });
          expect(geometry.boardHeight, "the drawing remains visible").toBeGreaterThan(0);
          expect(geometry.boardBottom, "the board stays above its area caption").toBeLessThanOrEqual(geometry.captionTop);
          expect(geometry.captionBottom, "the caption stays inside the photo frame").toBeLessThanOrEqual(geometry.frameBottom);
          expect(geometry.frameHeight, "the gallery retains its 16:9 photo geometry").toBeCloseTo(geometry.frameWidth * 9 / 16, 1);
        }).toPass({ timeout: 20_000 });
        await card.screenshot({ path: testInfo.outputPath("gallery-sign.png") });
      });
    }
  }
}
