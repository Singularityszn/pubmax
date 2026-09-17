import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The map banner-staging coordinator lives in CSS (which self-gating sibling may
// render is a presentation concern). This locks its policy from source, the same
// idiom as activationChromeCss.test.ts. Behaviour is additionally proven by the
// fresh-profile + post-dismissal Playwright screenshots.
const css = readFileSync(join(process.cwd(), "components/map/mapBannerStaging.module.css"), "utf8");

describe("map banner staging CSS", () => {
  it("keeps location independent while onboarding suppresses ambient status and Tonight", () => {
    for (const sel of [".cityStatusBanner", ".tonightLaneCollapsed"]) {
      const escaped = sel.replace(/\./g, "\\.");
      expect(css).toMatch(new RegExp(`\\.appShell\\.onboarding-open\\s+${escaped}`));
    }
    expect(css).not.toMatch(/\.appShell\.onboarding-open\s+\.citySuggestBanner/);
  });

  it("keeps the location control available alongside closure/safety status", () => {
    expect(css).not.toMatch(/\.mapStage:has\(\.cityStatusBanner\)\s+\.citySuggestBanner/);
  });

  it("defers the tonight-nearby card to either status or location", () => {
    expect(css).toMatch(/\.mapStage:has\(\.cityStatusBanner\)\s+\.tonightLaneCollapsed/);
    expect(css).toMatch(/\.mapStage:has\(\.citySuggestBanner\)\s+\.tonightLaneCollapsed/);
  });

  it("defers the closure band to the first-visit ask, and to nothing else", () => {
    // The closure band was the top of the priority cascade and no :has() rule
    // could touch it. ONE now can: while the first-visit strip is up the strip
    // is the one banner (captain, 7 Sep 2026, over walk finding B9, which
    // counted eighteen controls, a closure banner and the card at 1440 before
    // a pin was tapped). Nothing is lost, because the strip clears on the
    // reader's own first move on the map. Every OTHER banner still yields to
    // the closure band rather than the other way round.
    const suppressors = [
      ...css.matchAll(/([^\n{,]*:has\([^)]*\)[^\n{,]*)\s+\.cityStatusBanner/g),
    ].map((match) => match[1].trim());
    expect(suppressors).toEqual(["body:has(.mapArrivalCard)"]);
  });

  it("scopes the staging to desktop so the mobile map shell is untouched", () => {
    expect(css).toMatch(/@media \(min-width:\s*641px\)/);
  });
});
