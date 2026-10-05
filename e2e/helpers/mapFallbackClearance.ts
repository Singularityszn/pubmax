import { expect, type Page } from "@playwright/test";

/**
 * The floating chrome the map's fallback card has to start below: the desktop
 * search toolbar, the city chip docked under it, and the one phone bar. The
 * card fills the map, so a centred card used to sit its heading and the first
 * lines of its message behind the toolbar and the chip at 1024, 1280x720 and
 * 1440x900.
 */
const FALLBACK_COVERING_CHROME = [
  ".mapToolbar",
  ".citySuggestBanner",
  ".mobileMapChrome",
] as const;

type Box = { x: number; y: number; width: number; height: number };

/**
 * Every painted chrome box that overlaps the fallback card's heading or
 * message, named `<part> under <selector>`. An empty list is the pass.
 */
async function fallbackTextCoverage(page: Page): Promise<string[]> {
  return page.evaluate((selectors) => {
    const painted = (node: Element | null): Box | null => {
      if (!node) return null;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return width > 0 && height > 0 ? { x, y, width, height } : null;
    };
    const overlaps = (a: Box, b: Box) =>
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height;
    const parts = {
      heading: painted(document.querySelector(".mapFallback > strong")),
      message: painted(document.querySelector(".mapFallback > p")),
    };
    if (!parts.heading || !parts.message) return ["fallback text not painted"];
    return selectors.flatMap((selector) => {
      const chrome = painted(document.querySelector(selector));
      if (!chrome) return [];
      return Object.entries(parts)
        .filter(([, box]) => box && overlaps(box, chrome))
        .map(([part]) => `${part} under ${selector}`);
    });
  }, [...FALLBACK_COVERING_CHROME]);
}

/** The fallback heading and message are fully clear of the floating chrome. */
export async function expectFallbackTextClearOfChrome(page: Page): Promise<void> {
  await expect.poll(() => fallbackTextCoverage(page), { timeout: 10_000 }).toEqual([]);
}
