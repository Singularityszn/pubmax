import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// At 1440 an open venue drawer cut the right half of the "Cheapest pints near
// you?" ask. It now centres on the map lane the drawer leaves, like the banners.
describe("map arrival card beside a desktop drawer", () => {
  const css = readFileSync(join(process.cwd(), "components/map/mapBannerStaging.css"), "utf8");

  it("centres on the lane left of the venue drawer", () => {
    expect(css).toMatch(
      /body:has\(\.appShell\.detail-open\) \.mapArrivalCard \{[^}]*left: calc\(\(100% - var\(--desktop-venue-drawer-width\)\) \/ 2\)[^}]*width: min\(680px, calc\(100% - var\(--desktop-venue-drawer-width\) - 32px\)\)/,
    );
  });

  it("centres on the lane right of the planner rail", () => {
    expect(css).toMatch(/body:has\(\.appShell\.planning-open\) \.mapArrivalCard/);
  });
});

describe("map drawer close button backing", () => {
  const sheet = readFileSync(join(process.cwd(), "components/map/venueSheet.css"), "utf8");

  it("has its own disc so it never floats bare over the hero photograph", () => {
    expect(sheet).toMatch(
      /\.mapDrawerHead \.surfaceNavHome \{[^}]*background: color-mix\(in srgb, var\(--sheet-material-solid[^}]*box-shadow: var\(--shadow-sm\)/,
    );
  });
});

describe("launch-token form fields", () => {
  it("keeps the photo composer free of browser defaults", () => {
    const css = readFileSync(join(process.cwd(), "components/venue/venuePhotoWall.css"), "utf8");
    expect(css).toMatch(/\.venuePhotoComposerField \{[^}]*border: 0/);
    expect(css).toMatch(/\.venuePhotoComposerShare input \{[^}]*accent-color: var\(--brass\)/);
    expect(css).not.toMatch(/venuePhotoComposerTag\[aria-pressed="true"\] \{[^}]*background: var\(--ink/);
  });

  it("fills profile editor inputs differently from their panel", () => {
    const css = readFileSync(join(process.cwd(), "app/u/[handle]/profile.css"), "utf8");
    const start = css.indexOf(".profilePage .profileEditor input,");
    expect(css.slice(start, css.indexOf("}", start))).toContain("background: var(--paper)");
  });
});
