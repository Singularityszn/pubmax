import { expect, test } from "@playwright/test";

// /price-pulse names a source and a date under every figure. On a phone the
// floating create action sits over the reading column's bottom-right corner,
// and at rest it covered the duty row's GOV.UK line and its date. Every block
// of text on the page is brought to the foot of the screen, where the action
// sits, and no line of it may run under the action's box.
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
      const blocks = [...document.querySelectorAll<HTMLElement>("main *")].filter(
        (el) => el.getClientRects().length > 0 && [...el.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        ),
      );
      for (const block of blocks) {
        block.scrollIntoView({ block: "end", behavior: "instant" });
        const box = fab.getBoundingClientRect();
        for (const node of block.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
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
    });
    expect(covered, "Price Pulse text under the create action").toEqual([]);
  });
}
