import { expect, test } from "@playwright/test";

// /price-pulse names a source and a date under every figure. On a phone the
// floating create action sits over the reading column's bottom-right corner,
// and at rest it covered the duty row's GOV.UK line and its date. Each split
// row is brought to the foot of the screen, where the action sits, and no line
// of its text may run under the action's box.
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px the Price Pulse sources stay clear of the create action`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      // The consent card owns the action's lane until it is answered.
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
    });

    const response = await page.goto("/price-pulse");
    expect(response?.status()).toBe(200);
    const rows = page.locator(".pulseSplitRow");
    await expect(rows.first()).toBeVisible();
    await expect(page.locator(".createFab")).toBeVisible();

    const covered = await page.evaluate(() => {
      const fab = document.querySelector(".createFab");
      if (!fab) return ["no create action"];
      const hits: string[] = [];
      for (const row of document.querySelectorAll<HTMLElement>(".pulseSplitRow, .pulseItem")) {
        row.scrollIntoView({ block: "end", behavior: "instant" });
        const box = fab.getBoundingClientRect();
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if ([...range.getClientRects()].some((rect) =>
            rect.left < box.right && rect.right > box.left &&
            rect.top < box.bottom && rect.bottom > box.top,
          )) hits.push(node.textContent.trim());
        }
      }
      return hits;
    });
    expect(covered, "Price Pulse text under the create action").toEqual([]);
  });
}
