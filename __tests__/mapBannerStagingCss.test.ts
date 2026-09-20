import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The map banner-staging coordinator lives in CSS (which self-gating sibling may
// render is a presentation concern). This locks its policy from source, the same
// idiom as activationChromeCss.test.ts. Behaviour is additionally proven by the
// fresh-profile + post-dismissal Playwright screenshots.
const css = readFileSync(join(process.cwd(), "components/map/mapBannerStaging.css"), "utf8");

describe("map banner staging CSS", () => {
  it("keeps location independent while onboarding suppresses ambient status and Tonight", () => {
    for (const sel of [".cityStatusBanner", ".tonightLaneCollapsed"]) {
      const escaped = sel.replace(/\./g, "\\.");
      expect(css).toMatch(new RegExp(`\\.appShell\\.onboarding-open\\s+${escaped}`));
    }
    expect(css).not.toMatch(/\.appShell\.onboarding-open\s+\.citySuggestBanner/);
  });

  // ONE AMBIENT SURFACE HOLDS THE MAP, AND THE ORDER IS FIXED. UI review 17 Sep
  // 2026, finding 5: dismissing the arrival strip released THREE banners at once
  // at 1440. The wait rule 1b enforces against the strip is now enforced among
  // the banners too, in the strip's own order, so answering the one on screen
  // releases exactly the next one down. The location ask stays first of them,
  // because that ask IS what the strip is (components/AGENTS.md).
  const CASCADE = [
    ".citySuggestBanner",
    ".cityStatusBanner",
    ".tonightLaneCollapsed",
    ".mapConciergeAsk",
  ] as const;

  const escape = (selector: string) => selector.replace(/\./g, "\\.");

  it("yields every lower ambient surface to every higher one that is eligible", () => {
    for (let higher = 0; higher < CASCADE.length - 1; higher += 1) {
      for (let lower = higher + 1; lower < CASCADE.length; lower += 1) {
        // Keyed on element PRESENCE, which is what makes the order total: a
        // lower member yields to every eligible higher one rather than to the
        // one currently painted, so no two can paint together however the
        // reader dismisses them.
        expect(
          css,
          `${CASCADE[lower]} yields to ${CASCADE[higher]}`,
        ).toMatch(
          new RegExp(
            `:has\\(${escape(CASCADE[higher])}\\)\\s+${escape(CASCADE[lower])}`,
          ),
        );
      }
    }
  });

  it("lets no lower ambient surface suppress a higher one", () => {
    for (let lower = 1; lower < CASCADE.length; lower += 1) {
      for (let higher = 0; higher < lower; higher += 1) {
        expect(
          css,
          `${CASCADE[higher]} does not yield to ${CASCADE[lower]}`,
        ).not.toMatch(
          new RegExp(
            `:has\\(${escape(CASCADE[lower])}\\)\\s+${escape(CASCADE[higher])}`,
          ),
        );
      }
    }
  });

  it("defers the closure band to the ask above it and to a panel, and nothing else", () => {
    // The closure band was the top of the priority cascade and no :has() rule
    // could touch it. THREE now can: the first-visit strip (captain, 7 Sep 2026,
    // over walk finding B9, which counted eighteen controls, a closure banner
    // and the card at 1440 before a pin was tapped), the location ask above it
    // in the cascade, and an open Tonight panel, which is asked for rather than
    // ambient. Nothing is lost in any of the three, because each clears on an
    // answer and the band arrives the moment it does.
    const suppressors = [
      ...css.matchAll(/([^\n{,]*:has\([^)]*\)[^\n{,]*)\s+\.cityStatusBanner/g),
    ].map((match) => match[1].trim());
    expect(suppressors).toEqual([
      "body:has(.mapArrivalCard)",
      ".mapStage:has(.citySuggestBanner)",
      ".mapStage:has(.tonightLane--open)",
    ]);
  });

  it("lets an open Tonight panel take the surface back off the banners above it", () => {
    // Macroscope 17 Sep 2026 read .tonightLane--open as a missing SUPPRESSEE.
    // Half of that is right: the expanded panel must still put the concierge ask
    // away, because the ask sits in the same bottom lane. The other half is
    // backwards. Only the CHIP is ambient. The panel is open because the reader
    // opened it or because a /map?src=whats-on-* deep link opened it for them
    // (components/PubMap.tsx, tonightLaneForcedOpen), and components/AGENTS.md
    // holds that a panel the reader opens takes the surface back. Suppressing it
    // landed that deep link on a map with a location prompt and none of the
    // listings it was followed for.
    for (const higher of [
      ".citySuggestBanner",
      ".cityStatusStack",
      ".cityStatusBanner",
    ]) {
      expect(css, `${higher} yields to an open Tonight panel`).toMatch(
        new RegExp(`:has\\(\\.tonightLane--open\\)\\s+${escape(higher)}`),
      );
    }
    expect(css).not.toMatch(
      /:has\(\.(citySuggestBanner|cityStatusBanner)\)\s+\.tonightLane--open/,
    );
    expect(css).toMatch(/body:has\(\.tonightLane--open\)\s+\.mapConciergeAsk/);
  });

  it("scopes the staging to desktop so the mobile map shell is untouched", () => {
    expect(css).toMatch(/@media \(min-width:\s*641px\)/);
  });
});
