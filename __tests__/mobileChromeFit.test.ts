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
const pintArrivalCss = read("components/pintindex/pintIndexArrival.css");
const venueListCss = read("components/map/mapVenueList.css");
const venuePriceSubmitCss = read("components/map/venuePriceSubmit.css");
const globalCss = read("app/globals.css");

describe("mobile chrome fit at 390px", () => {
  it("keeps first-visit analytics choices equal and clear of map activation", () => {
    const buttons = globalCss.match(/\.analyticsConsentPromptActions button\s*{([^}]*)}/)?.[1] ?? "";
    expect(buttons).toMatch(/min-height:\s*44px/);
    expect(buttons).toMatch(/background:\s*var\(--panel\)/);
    expect(globalCss).not.toMatch(/\.analyticsConsentPromptActions button:first-child/);
    expect(globalCss).toMatch(
      /body:has\(\.mobilePlanActivation\) \.analyticsConsentPrompt\s*{[^}]*bottom:\s*calc\(var\(--mobile-map-dock-clearance\) \+ 70px\)/,
    );
  });

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

  it("keeps a venue name whole when a drink lens puts an unknown caption in the row", () => {
    // A pint row's caption is a figure ("£5.60"); a lens row's is a whole
    // finding ("No whisky price logged"). Sharing one 44px line, the caption
    // wraps to two and the NAME is what loses its characters — measured at
    // 390x844x3, .mapVenueListItemName fell from 189px under the pint lens to
    // 106-122px under whisky, clipping five of the visible pubs. Stack the row
    // on a phone so the name owns a full line and the caption keeps wrapping
    // below it: neither is ever ellipsed.
    const phoneBlocks = venueListCss.split("@media (max-width: 640px)").slice(1);
    const stacked = phoneBlocks.find((block) =>
      /\.mapVenueListItem\s*{[^}]*flex-direction:\s*column/.test(block),
    );
    expect(stacked, "phone override stacking the venue list row").toBeTruthy();
    const nameRule = stacked?.match(/\.mapVenueListItemName\s*{([^}]*)}/)?.[1] ?? "";
    expect(nameRule, ".mapVenueListItemName phone override present").not.toBe("");
    expect(nameRule).toMatch(/white-space:\s*normal/);
    expect(nameRule).not.toMatch(/text-overflow:\s*ellipsis/);
    // The caption wraps in place rather than holding a fixed side column.
    expect(stacked).toMatch(/\.mapVenueListItemMeta\s*{[^}]*flex-wrap:\s*wrap/);
    expect(stacked).toMatch(/\.mapVenueListCompactPrice\s*{[^}]*max-width:\s*100%/);

    // And the full line the name now gets is wider than the remainder it used
    // to be left with once the caption took its column.
    const panelWidth = Number(
      venueListCss.match(/\.mapVenueListPanel\s*{[^}]*width:\s*min\((\d+)px/)?.[1],
    );
    const itemsPad = Number(venueListCss.match(/\.mapVenueListItems\s*{[^}]*padding:\s*(\d+)px/)?.[1]);
    const itemPadX = Number(
      venueListCss.match(/\.mapVenueListItem\s*{[^}]*padding:\s*\d+px\s+(\d+)px/)?.[1],
    );
    const captionMax = Number(
      venueListCss.match(/\.mapVenueListCompactPrice\s*{[^}]*max-width:\s*(\d+)px/)?.[1],
    );
    for (const [label, value] of [
      ["panel width", panelWidth],
      ["items padding", itemsPad],
      ["item padding", itemPadX],
      ["caption max-width", captionMax],
    ] as const) {
      expect(Number.isFinite(value), `${label} parsed from CSS`).toBe(true);
    }
    const viewport = 390;
    const panel = Math.min(panelWidth, viewport - 24);
    const nameLine = panel - 2 - itemsPad * 2 - itemPadX * 2;
    expect(nameLine, "the stacked name line holds a pub name").toBeGreaterThanOrEqual(240);
    expect(nameLine - captionMax, "the shared line it replaces was the narrow one").toBeLessThan(
      nameLine,
    );
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

  it("keeps every community signal choice thumb-sized", () => {
    expect(venuePriceSubmitCss).toMatch(
      /\.vpsigQuestion\s*{[^}]*min-height:\s*44px/,
    );
    expect(venuePriceSubmitCss).toMatch(
      /\.vpsigOption\s*{[^}]*min-height:\s*44px/,
    );
    expect(venuePriceSubmitCss).toMatch(
      /\.vpsigSubmit\s*{[^}]*min-height:\s*44px/,
    );
  });

  it("sizes the signal readout label column by the widest label, never a guess", () => {
    // Measured at 390x844x3: "CHARACTER" renders 72px and "ENTRANCE" 64px, so
    // the fixed 62px column this used to declare pushed both labels through the
    // 8px gutter and into their own values ("CHARACTERDrinkers called it
    // rough."). A row is a label plus a reading, so the label may not be
    // clipped and the reading may not be reached early. The five rows share ONE
    // grid whose first track is content-sized, which is the only form that
    // cannot go stale when the label copy changes.
    const readout = venuePriceSubmitCss.match(/\.vpsigReadout\s*{([^}]*)}/)?.[1] ?? "";
    expect(readout, ".vpsigReadout rule present").not.toBe("");
    const track = readout.match(/grid-template-columns:\s*([^;]+);/)?.[1]?.trim() ?? "";
    expect(track, ".vpsigReadout declares its columns").not.toBe("");
    expect(track).toMatch(/^(max-content|min-content|auto|fit-content\()/);
    expect(track, "label column is not a fixed length").not.toMatch(/^\d/);
    expect(readout).toMatch(/column-gap:\s*\d/);

    // display: contents is what makes that one track govern all five rows.
    expect(venuePriceSubmitCss).toMatch(
      /\.vpsigReadoutRow\s*{[^}]*display:\s*contents/,
    );
    const labelRule =
      venuePriceSubmitCss.match(/\.vpsigReadoutRow dt\s*{([^}]*)}/)?.[1] ?? "";
    expect(labelRule, ".vpsigReadoutRow dt rule present").not.toBe("");
    expect(labelRule).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(labelRule).not.toMatch(/overflow:\s*hidden/);
    expect(labelRule).not.toMatch(/width:/);
  });

  it("removes community signal motion when the phone asks for less", () => {
    expect(venuePriceSubmitCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{[\s\S]*?\.vpsigSummaryChevron\s*{[^}]*transition:\s*none/,
    );
  });

  it("keeps basemap Retry thumb-sized and clear of phone navigation", () => {
    expect(globalCss).toMatch(
      /\.mapSoftRetryBtn\s*{[^}]*min-width:\s*64px;[^}]*min-height:\s*44px/,
    );
    expect(globalCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.mapSoftRetry\s*{[^}]*bottom:\s*calc\(var\(--mobile-tab-clearance\) \+ 10px\)/,
    );
  });
});
