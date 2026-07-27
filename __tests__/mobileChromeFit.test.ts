import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Regression lock for the 390/430 device pass. Same house pattern as
// landingChromeCss.test.ts: text assertions over the shipped CSS, because the
// defects these guard were all invisible to a desktop browser and to a headless
// run that never sets a phone viewport.
//
// Two of them are not cosmetic:
//   - the map rail overflowed 390px by ~21px, cutting the Filters chip clean
//     through its refinement badge, so a filtered map looked unfiltered;
//   - the venue peek caption ellipsed to "current recorded pri…", which is a
//     PRICE with its own meaning truncated. A price you cannot read the label of
//     is the one thing this product cannot ship.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const mobileMapCss = read("components/mobile/mobileMapShell.css");
const arcChipsCss = read("components/map/tonightArcChips.css");
const landingCss = read("components/landing/landing.css");
const hygieneCss = read("components/map/venueHygiene.css");
const saveToListCss = read("components/savedpubs/saveToList.css");
const buzzCss = read("components/map/venueBuzz.css");
const pintArrivalCss = read("components/pintindex/pintIndexArrival.css");

describe("mobile chrome fit at 390px", () => {
  it("tightens the map control rail so all three chips clear the viewport", () => {
    // 390px is the narrowest common phone; 430px keeps the roomier chips.
    expect(mobileMapCss).toMatch(
      /@media \(max-width: 420px\)\s*{[\s\S]*?\.mobileMapRail > button\s*{[^}]*padding-inline:\s*9px/,
    );
  });

  it("never truncates the venue price caption", () => {
    const rule = mobileMapCss.match(/\.mobileVenuePeekSummary small\s*{([^}]*)}/)?.[1] ?? "";
    expect(rule, ".mobileVenuePeekSummary small rule present").not.toBe("");
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it("stacks the landing hero readout without the side-by-side divider indent", () => {
    // In a column the left rule + 20px pad stepped each stat further right, so
    // three honest counts read as a broken staircase.
    const stacked = landingCss.match(
      /@media \(max-width: 700px\)[\s\S]*?\.lpReadoutStat \+ \.lpReadoutStat\s*{([^}]*)}/,
    )?.[1];
    expect(stacked, "phone override for the stacked readout").toBeTruthy();
    expect(stacked).toMatch(/border-left:\s*0/);
    expect(stacked).toMatch(/padding-left:\s*0/);
    expect(stacked).toMatch(/border-top:\s*1px solid/);
  });
});

describe("mobile tap-target floors", () => {
  it("gives the map's Tonight Arc chips a 44px floor on a phone", () => {
    expect(arcChipsCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.tonightArcChip\s*{[^}]*min-height:\s*44px/,
    );
  });

  it("gives the map wordmark link a real hit box, not a 14px text run", () => {
    expect(mobileMapCss).toMatch(/\.mobileMapBrand\s*{[^}]*min-height:\s*44px/);
  });

  it("floors the venue-sheet controls that sat under 44px", () => {
    expect(hygieneCss).toMatch(/\.venueHygiene\s*{[^}]*min-height:\s*44px/);
    expect(saveToListCss).toMatch(/\.saveToListToggle\s*{[^}]*min-height:\s*44px/);
  });

  it("keeps a thumb-sized route to every press source", () => {
    // The inline superscript citation cannot reach 44px without wrecking the
    // paragraph, so the mention pill below the summary carries the floor and
    // the superscript just gets a padded hit box.
    expect(buzzCss).toMatch(/\.venueBuzzMention a\s*{[^}]*min-height:\s*44px/);
    expect(buzzCss).toMatch(/\.venueBuzzCite a\s*{[^}]*padding:\s*7px 5px/);
  });

  it("keeps the Pint Index arrival chips thumb-sized, and never clips an area name", () => {
    // A press arrival's whole next step is one of these. A chip under the
    // floor, or a borough name cut to "Kensington and Ch...", loses the tap
    // and the destination with it.
    const chip = pintArrivalCss.match(/\.pintArrivalArea\s*{([^}]*)}/)?.[1] ?? "";
    expect(chip, ".pintArrivalArea rule present").not.toBe("");
    expect(chip).toMatch(/min-height:\s*56px/);
    expect(chip).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(pintArrivalCss).toMatch(/\.pintArrivalAreaName\s*{[^}]*overflow-wrap:\s*break-word/);
    expect(pintArrivalCss).toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.pintArrivalAreas\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it("floors the landing footer links to 44px", () => {
    expect(landingCss).toMatch(/\.lpFooterCol a\s*{\s*min-height:\s*44px/);
    expect(landingCss).toMatch(/\.lpFooterSmallPrint a\s*{\s*min-height:\s*44px/);
  });
});
