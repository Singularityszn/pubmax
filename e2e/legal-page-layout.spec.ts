import { expect, test } from "@playwright/test";

// Legal prose, source links and code tokens must remain readable inside the
// phone viewport, including when the root font doubles. Do not clip the text.
for (const route of ["/privacy", "/terms", "/credits", "/how-we-estimate", "/price-pulse"]) {
  for (const width of [320, 390]) {
    for (const enlarged of [false, true]) {
      test(`${route} fits ${width}px with ${enlarged ? "large root32" : "normal root16"} text`, async ({ page }) => {
        await page.setViewportSize({ width, height: 568 });
        const response = await page.goto(route);
        expect(response?.status()).toBe(200);
        const main = page.getByRole("main");
        await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
        await page.evaluate((enlarged) => {
          document.documentElement.style.fontSize = enlarged ? "32px" : "16px";
          document.documentElement.dataset.textScale = enlarged ? "large" : "normal";
        }, enlarged);
        await page.evaluate(() => document.fonts.ready);

        // The viewport is the independent boundary. Text ranges catch clipping
        // that document scrollWidth alone could conceal.
        const layout = await main.evaluate((element) => {
          const outside: string[] = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent?.trim() || !node.parentElement?.checkVisibility()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if ([...range.getClientRects()].some((rect) => rect.left < -1 || rect.right > innerWidth + 1)) {
              outside.push(node.textContent.trim());
            }
          }
          return { overflow: document.documentElement.scrollWidth - innerWidth, outside };
        });
        expect(layout.overflow).toBe(0);
        expect(layout.outside, "Reading text must fit without clipping").toEqual([]);

        // Wrapping must retain the real links and their keyboard access.
        const link = main.getByRole("link").first();
        await expect(link).toHaveAttribute("href", /\S+/);
        await link.focus();
        await expect(link).toBeFocused();
        await expect(link).toBeVisible();
      });
    }
  }
}
