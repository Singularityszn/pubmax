import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const firstRunTourCss = readFileSync(
  join(process.cwd(), "components/onboarding/firstRunTour.css"),
  "utf8",
);
const citySuggestBannerCss = readFileSync(
  join(process.cwd(), "components/map/citySuggestBanner.css"),
  "utf8",
);
const mobileMapShellCss = readFileSync(
  join(process.cwd(), "components/mobile/mobileMapShell.css"),
  "utf8",
);

describe("activation chrome CSS", () => {
  it("keeps first-run tour actions thumb-sized", () => {
    expect(firstRunTourCss).toMatch(/\.tourClose\s*{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
    expect(firstRunTourCss).toMatch(/\.tourSkip,\s*\n\.tourNext\s*{[\s\S]*?min-height:\s*44px;/);
  });

  it("keeps map city suggestion actions thumb-sized", () => {
    expect(citySuggestBannerCss).toMatch(/\.citySuggestBannerSwitch\s*{[\s\S]*?min-height:\s*44px;/);
    expect(citySuggestBannerCss).toMatch(
      /\.citySuggestBannerDismiss\s*{[\s\S]*?min-height:\s*44px;[\s\S]*?min-width:\s*44px;/,
    );
  });

  it("keeps the primary mobile planning action clear of the bottom dock", () => {
    expect(mobileMapShellCss).toMatch(
      /\.mobilePlanActivation\s*{[\s\S]*?min-height:\s*48px;[\s\S]*?bottom:\s*calc\(var\(--mobile-map-dock-clearance\) \+ 10px\);/,
    );
  });

  it("keeps the plan-activation pill on the quiet neutral idiom (accent diet #395 R3)", () => {
    // The pill's resting state must NOT be a filled accent — "Near me" is the
    // single loud action on the map. It uses the same border/surface/ink idiom
    // as the Tonight/Filters chips.
    const block = mobileMapShellCss.match(/\.mobilePlanActivation\s*{[\s\S]*?}/);
    expect(block).not.toBeNull();
    expect(block?.[0]).toMatch(/background:\s*var\(--color-surface-raised\);/);
    expect(block?.[0]).not.toMatch(/background:\s*var\(--color-accent\);/);
  });

  it("keeps the active-search chip thumb-sized (#395 R1)", () => {
    // The restored/typed-query chip is the clear target, so it must be 44px.
    expect(mobileMapShellCss).toMatch(
      /\.mobileMapQueryChip\s*{[\s\S]*?min-height:\s*44px;/,
    );
  });

  it("keeps the mobile sheet a bottom-anchored, content-capped flex column", () => {
    // Systemic rebuild: the sheet is no longer a viewport-tall translated panel
    // with a fixed-height, dock-reserving body (which rendered the reservation as
    // an opaque void band over a tab bar the sheet already hides). It is now
    // bottom-anchored (bottom:0) with `max-height: var(--sheet-cap)` on the box
    // and a flex-1 scrolling body, so `height:auto; max-height:cap` hugs short
    // content and caps + scrolls tall content — no dock band in either case.
    expect(mobileMapShellCss).toMatch(
      /\.mobileSharedSheet\.mapDrawer\s*{[\s\S]*?bottom:\s*0;[\s\S]*?max-height:\s*var\(--sheet-cap\);/,
    );
    expect(mobileMapShellCss).toMatch(
      /\.mobileSharedSheetBody\s*{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
    );
    // The snap caps are the snap fractions of the viewport — no dock subtraction.
    expect(mobileMapShellCss).toMatch(/\.mobileSharedSheet\.open\.sheet-half[^}]*--sheet-cap:\s*55dvh;/);
    expect(mobileMapShellCss).toMatch(/\.mobileSharedSheet\.open\.sheet-full[^}]*--sheet-cap:\s*92dvh;/);
    // The dock band is gone from the sheet's height math entirely.
    expect(mobileMapShellCss).not.toMatch(/\.mobileSharedSheetBody\s*{[\s\S]*?--mobile-map-dock-clearance/);
  });
});
