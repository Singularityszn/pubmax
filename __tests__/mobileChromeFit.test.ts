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
const arcChipsTsx = read("components/map/TonightArcChips.tsx");
const landingCss = read("components/landing/landing.css");
const hygieneCss = read("components/map/venueHygiene.css");
const saveToListCss = read("components/savedpubs/saveToList.css");
const buzzCss = read("components/map/venueBuzz.css");

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

  it("fits every Tonight Arc chip inside the rail panel, clear of the TfL control", () => {
    // The rail used to be sized against the viewport ALONE (min(100vw - 24px,
    // 366px), centred), which is not the constraint that matters: the TfL
    // utility control is fixed to the right map edge in the same vertical band,
    // so a viewport-wide rail put the fifth chip ("Restaurants") under a 44px
    // button — half the label hidden, and every tap in that strip opening TfL
    // instead of the lane toggle. Measured at 390x844: chip 259.7..352.8 vs
    // button 334..378. So this pins the rail against the CONTROL, not the
    // viewport, and the lane is one shared variable so the two cannot drift.
    const chipCount = (arcChipsTsx.match(/\bkind:\s*"/g) ?? []).length;
    expect(chipCount, "chips declared in TonightArcChips").toBe(5);

    const cornerInset = Number(
      mobileMapCss.match(/--mobile-map-corner-inset:\s*max\((\d+)px/)?.[1],
    );
    const cornerBtn = Number(mobileMapCss.match(/--mobile-map-corner-btn:\s*(\d+)px/)?.[1]);
    const cornerGap = Number(
      mobileMapCss.match(
        /--mobile-map-corner-lane:\s*calc\([\s\S]*?--mobile-map-corner-btn\)\s*\+\s*(\d+)px/,
      )?.[1],
    );
    // The lane only describes the control if the control is actually laid out
    // from the same two numbers.
    expect(mobileMapCss).toMatch(
      /\.mobileMapUtilityCorner\s*{[^}]*right:\s*var\(--mobile-map-corner-inset\)/,
    );
    expect(mobileMapCss).toMatch(
      /\.mobileMapUtilityCorner > button\s*{[^}]*min-width:\s*var\(--mobile-map-corner-btn\)/,
    );

    const mobile = arcChipsCss.split("@media (max-width: 640px)")[1] ?? "";
    const railRule = mobile.match(/\.tonightArcChips\s*{([^}]*)}/)?.[1] ?? "";
    const railLeft = Number(railRule.match(/left:\s*(\d+)px/)?.[1]);
    const laneFallback = Number(
      railRule.match(/right:\s*var\(--mobile-map-corner-lane,\s*(\d+)px\)/)?.[1],
    );
    const railPadX = Number(railRule.match(/padding:\s*\d+px\s+(\d+)px/)?.[1]);
    const chipMinWidth = Number(
      mobile.match(/\.tonightArcChip\s*{[^}]*min-width:\s*(\d+)px/)?.[1],
    );
    const rowGap = Number(arcChipsCss.match(/\.tonightArcRow\s*{[^}]*gap:\s*(\d+)px/)?.[1]);
    for (const [label, value] of [
      ["TfL corner inset", cornerInset],
      ["TfL corner button size", cornerBtn],
      ["TfL corner lane gap", cornerGap],
      ["rail left inset", railLeft],
      ["rail lane fallback", laneFallback],
      ["rail padding", railPadX],
      ["chip min-width", chipMinWidth],
      ["row gap", rowGap],
    ] as const) {
      expect(Number.isFinite(value), `${label} parsed from CSS`).toBe(true);
    }

    // The rail anchors left and ends short of the lane, so it cannot be centred
    // back over the control by a future width tweak.
    expect(railRule, "rail anchors left rather than centring across the control").not.toMatch(
      /left:\s*50%/,
    );
    expect(railRule).toMatch(/transform:\s*none/);

    const lane = cornerInset + cornerBtn + cornerGap;
    expect(laneFallback, "rail's lane fallback matches the shared lane").toBe(lane);

    const viewport = 390;
    const railRight = viewport - lane;
    const tflLeft = viewport - cornerInset - cornerBtn;
    expect(railRight, "rail right edge clears the TfL control's left edge").toBeLessThanOrEqual(
      tflLeft,
    );
    expect(railLeft, "rail keeps the 12px left map inset").toBeGreaterThanOrEqual(12);

    const contentBox = railRight - railLeft - railPadX * 2 - 2;
    expect(chipMinWidth, "widest single chip vs rail content box").toBeLessThanOrEqual(contentBox);
    // Chips wrap to a second row rather than shrink or ellipse: a lane label is
    // read, not guessed.
    expect(mobile).toMatch(/\.tonightArcRow\s*{[^}]*flex-wrap:\s*wrap/);
    expect(mobile).toMatch(/\.tonightArcChip\s*{[^}]*flex:\s*0 1 auto/);
    expect(arcChipsCss, "chip labels are never truncated").not.toMatch(/text-overflow/);
    expect(rowGap, "row gap parsed").toBeGreaterThan(0);
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

  it("floors the landing footer links to 44px", () => {
    expect(landingCss).toMatch(/\.lpFooterCol a\s*{\s*min-height:\s*44px/);
    expect(landingCss).toMatch(/\.lpFooterSmallPrint a\s*{\s*min-height:\s*44px/);
  });
});
