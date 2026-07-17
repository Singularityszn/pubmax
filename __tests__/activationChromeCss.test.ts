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

  it("keeps every mobile sheet detent scrollable above the bottom dock", () => {
    expect(mobileMapShellCss).toMatch(
      /\.mobileSharedSheetBody\s*{[\s\S]*?height:\s*calc\(var\(--mobile-sheet-visible-height\) - var\(--mobile-sheet-header-height\) - var\(--mobile-map-dock-clearance\)\);[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(mobileMapShellCss).toMatch(/\.mobileSharedSheet\.open\.sheet-half[^}]*--mobile-sheet-visible-height:\s*55dvh;/);
    expect(mobileMapShellCss).toMatch(/\.mobileSharedSheet\.open\.sheet-full[^}]*--mobile-sheet-visible-height:\s*92dvh;/);
  });
});
