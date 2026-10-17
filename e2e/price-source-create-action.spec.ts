import { expect, test } from "@playwright/test";

// On a phone the floating create action sits over the reading column's
// bottom-right corner. Running prose relies on the control tucking away while
// a reader scrolls down (lib/createFabScrollTuck.ts), but a price's source and
// date opt in to its lane the way a price column does. On main it covered a
// historic pub's price source at 320px ("collected 2 October 2026"). The line
// is brought to the foot of the screen, where the action sits, and no word of
// it may run under the action.
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;

const PAGES = [
  { route: "/historic/prospect-of-whitby", lines: [".hdPriceSource"] },
] as const;

for (const viewport of VIEWPORTS) {
  for (const { route, lines } of PAGES) {
    test(`${viewport.width}px ${route} keeps its price source clear of the create action`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        // The consent card owns the action's lane until it is answered.
        window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
      });

      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.locator(".createFab")).toBeVisible();
      for (const selector of lines) await expect(page.locator(selector).first()).toBeVisible();

      const covered = await page.evaluate((selectors) => {
        const fab = document.querySelector(".createFab");
        if (!fab) return ["no create action"];
        const hits: string[] = [];
        for (const block of document.querySelectorAll<HTMLElement>(selectors.join(", "))) {
          if (block.getClientRects().length === 0) continue;
          block.scrollIntoView({ block: "end", behavior: "instant" });
          const box = fab.getBoundingClientRect();
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            // A visually hidden label is a 1px box nobody reads.
            if ([...range.getClientRects()].some((rect) => rect.width > 1 &&
              rect.left < box.right && rect.right > box.left &&
              rect.top < box.bottom && rect.bottom > box.top,
            )) hits.push(node.textContent.trim());
          }
        }
        return hits;
      }, [...lines]);
      expect(covered, `${route} text under the create action`).toEqual([]);
    });
  }
}
