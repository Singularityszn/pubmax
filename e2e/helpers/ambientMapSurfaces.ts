import type { Page } from "@playwright/test";

/**
 * The desktop map's ambient surfaces, in the order the cascade spends them:
 * the location ask, the closure and area-news rail, the Tonight chip, then the
 * concierge ask (components/map/mapBannerStaging.css).
 *
 * ONE list, in ONE place, because three specs count these and a spec counting
 * its own private four is a spec that stops watching the fifth the day one is
 * added. The predicate is shared for the same reason: a selector that is
 * present but `visibility: hidden` is NOT painted, and a count keyed on the
 * bounding box alone reads it as one more surface on screen.
 */
const AMBIENT_MAP_SURFACES = [
  ".citySuggestBanner",
  ".cityStatusStack",
  ".tonightLaneCollapsed",
  ".mapConciergeAsk",
] as const;

/** Which of them are actually painted right now, in cascade order. */
export async function paintedAmbientSurfaces(page: Page): Promise<string[]> {
  return page.evaluate((selectors) =>
    selectors.filter((selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    }),
  [...AMBIENT_MAP_SURFACES]);
}
