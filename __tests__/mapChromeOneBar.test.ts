import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Design judgement 2026-08-01, findings 2.3 and 2.15 — the map is the hero.
 *
 * 2.3 (phone): the chrome was three stacked containers — the top bar, a
 * Near me / Tonight / Filters rail, and a full-width category band — with a
 * plan pill and a tab bar under them. Nine controls stood between the reader
 * and the first pin. The end state is ONE top bar, the category toggles in the
 * Filters sheet, and Near me as a round map-edge FAB.
 *
 * 2.15 (desktop): the SHOW ME panel arrived open, so the toolbar block was a
 * third layer over the map before the reader asked for it. The end state is a
 * panel that opens only from its own control.
 *
 * These read the shipped source, because every defect they guard was invisible
 * to a headless run that never sets a phone viewport.
 */

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const shell = read("components/mobile/MobileMapShell.tsx");
const shellCss = read("components/mobile/mobileMapShell.css");
const pubMap = read("components/PubMap.tsx");
const toolbar = read("components/map/MapToolbar.tsx");

function mapChromeMarkup(): string {
  const start = shell.lastIndexOf('<div className="mobileMapChrome"');
  const end = shell.indexOf("\n      </div>", start);
  expect(start, "the map chrome container").toBeGreaterThan(-1);
  expect(end, "its closing tag").toBeGreaterThan(start);
  return shell.slice(start, end);
}

describe("finding 2.3 — the phone map chrome is one bar", () => {
  it("renders exactly one bar inside the chrome", () => {
    const chrome = mapChromeMarkup();
    expect((chrome.match(/className="mobileMapTopbar["\s]/g) ?? []).length).toBe(1);
    // The rail was the second container. Nothing may bring it back.
    expect(chrome, "no control rail").not.toContain("mobileMapRail");
    expect(shellCss, "and no rail styling survives").not.toContain(".mobileMapRail");
    // The only other children at rest are optional: the search field (mounts
    // on the reader's own tap) and ONE docked chip row. The drink lane and the
    // Tonight cold-start chip share that row rather than docking one each, so
    // a second chip can never grow into a second control rail.
    expect(chrome).toMatch(/overlay === "search" \? \([\s\S]*?mobileMapSearchRow/);
    expect(chrome).toMatch(/overlay === "search" \? null : \([\s\S]*?<MapChipRow/);
    expect((shell.match(/className="mobileMapChipRow"/g) ?? []).length).toBe(1);
    expect(shell).toMatch(
      /mobileMapChipRow"[\s\S]*?mobileMapDrinkChip[\s\S]*?tonightChip \? \([\s\S]*?mobileMapTonightChip/,
    );
    expect(chrome, "no control rail").not.toContain("mobileMapRail");
  });

  it("puts Near me on the map edge as a round control, not in the bar", () => {
    const chrome = mapChromeMarkup();
    expect(chrome, "Near me left the bar").not.toContain("mobileMapLocateFab");
    expect(shell).toContain('className="mobileMapLocateFab"');
    expect(shell, "the FAB carries the Near me action").toMatch(
      /mobileMapLocateFab[\s\S]{0,320}onClick=\{onNearMe\}/,
    );
    // Its state is the accessible name, because a FAB has no visible label.
    expect(shell).toMatch(/mobileMapLocateFab[\s\S]{0,200}aria-label=\{nearMe\.label\}/);
    const fab = shellCss.match(/\.mobileMapLocateFab\s*{([^}]*)}/)?.[1] ?? "";
    expect(fab).toMatch(/border-radius:\s*50%/);
    // It shares the one published map-edge lane with the TfL control.
    expect(shell).toMatch(
      /className="mobileMapUtilityCorner"[\s\S]*?mobileMapLocateFab/,
    );
  });

  it("keeps the bar to controls, and the category toggles out of it", () => {
    const chrome = mapChromeMarkup();
    expect(chrome, "no venue-type toggles in the chrome").not.toContain("TonightArcChips");
    // A permanent Tonight slot used Sparkles inside the bar rail. The cold-start
    // chip docks under the bar with MoonStar and never reclaims a sixth slot.
    expect(chrome, "no Sparkles Tonight chip in the bar").not.toContain("Sparkles");
    expect(chrome, "the chip row is docked, not in the bar").toContain("<MapChipRow");
    expect(shell).toMatch(/mobileMapTonightChip[\s\S]*?MoonStar/);
    expect(shell).toMatch(/mobileMapTonightChip[\s\S]{0,400}onOpen\("tonight"\)/);
  });
});

describe("finding 2.3 — the category toggles have exactly one home per viewport", () => {
  /**
   * PlanAstra item 9 moved the desktop copy BEHIND a control. It used to float
   * over the map as a permanent band from 641px up, which is part of the 20 to
   * 24 controls a tablet met before it had tapped a pin. The rule the fence
   * still holds is the same one: ONE home per viewport, and no floating band.
   */
  it("keeps the phone copy in the Filters sheet and nowhere else in PubMap", () => {
    const mounts = pubMap.match(
      /<TonightArcChips\n(?:(?!\/>)[\s\S])*?\/>/g,
    );
    expect(mounts?.length, "TonightArcChips mount sites in PubMap").toBe(1);
    // The one copy PubMap owns is the Filters sheet section, which is where a
    // phone reads them.
    expect(pubMap).toMatch(/<TonightArcChips[\s\S]*?variant="sheet"/);
    // Nothing floats them over the desktop map any more.
    expect(pubMap, "no floating desktop band").not.toContain(
      "renderDesktopVenueKindChips",
    );
    const arcCss = read("components/map/tonightArcChips.module.css");
    // The group is plain content in whatever surface holds it. Its own
    // container may not position itself over the map (the one absolute rule
    // left is the unavailable-kind tooltip, which is anchored to its chip).
    expect(
      arcCss.match(/\.tonightArcChips\s*{([^}]*)}/)?.[1] ?? "",
      "the chips declare no map geometry",
    ).not.toMatch(/position:\s*absolute/);
  });

  it("gives the desktop copy one control that names how many kinds are off", () => {
    const filter = read("components/map/MapVenueKindFilter.tsx");
    expect(toolbar, "the toolbar row carries the control").toMatch(
      /isMobile === false && venueKindVisibility && onVenueKindVisibilityChange \? \(\s*<MapVenueKindFilter/,
    );
    // One panel, opened by the reader, holding the same chips.
    expect(filter).toMatch(/variant="popover"/);
    expect(filter).toMatch(/aria-expanded=\{open\}/);
    expect(filter).toMatch(/aria-controls=\{panelId\}/);
    // Escape closes it and hands focus back to the control that opened it.
    expect(filter).toMatch(
      /event\.key !== "Escape"[\s\S]*?setOpen\(false\)[\s\S]*?buttonRef\.current\?\.focus\(\)/,
    );
    // A closed panel may not hide which kinds the map is leaving out. The word
    // is what the 641 to 900px toolbar budget drops; the count is what stays,
    // and the accessible name carries the sentence at every width.
    expect(filter).toMatch(/VENUE_KIND_FILTER_WORD/);
    // The count covers every refinement the panel holds, not the kinds alone:
    // the experience lens and the fare-zone picker moved in beside them
    // (7 Sep 2026, walk finding B9), and a badge counting one of three would
    // say the map is unfiltered while two filters are on.
    expect(filter).toMatch(/mapVenueKindFilterCount"?>\{refinements\}/);
    expect(filter).toContain("mapFilterRefinementCount");
    expect(filter).toMatch(/venueKindFilterAriaLabel\(refinements\)/);
    // The chips are the reader's own tap, never the map's cold start.
    expect(filter).toMatch(
      /dynamic\(\s*\(\) => import\("@\/components\/map\/TonightArcChips"\)/,
    );
  });

  it("gives the sheet copy sheet geometry rather than map geometry", () => {
    const arcCss = read("components/map/tonightArcChips.module.css");
    const sheet = arcCss.match(/\.tonightArcChipsSheet\s*{([^}]*)}/)?.[1] ?? "";
    expect(sheet, ".tonightArcChipsSheet rule present").not.toBe("");
    expect(sheet).toMatch(/position:\s*static/);
    expect(sheet).toMatch(/transform:\s*none/);
    // The phone map band it used to occupy is gone from this stylesheet.
    expect(arcCss).not.toMatch(/@media \(max-width: 640px\)/);
  });
});

describe("finding 2.15 — SHOW ME opens only from a control the reader presses", () => {
  // The lens had a button of its own on the toolbar row until 7 Sep 2026. It
  // reads inside the Filters popover now, beside the venue types and the fare
  // zones, because all three narrow the same pin set and the row carried
  // eighteen controls at 1440 before a pin was tapped (walk finding B9). It is
  // still never mounted until a reader opens something.
  const filter = read("components/map/MapVenueKindFilter.tsx");

  it("does not mount the experience lens panel by default", () => {
    expect(filter, "closed on first paint").toMatch(
      /const \[open, setOpen\] = useState\(false\)/,
    );
    expect(filter, "the panel is conditional").toMatch(
      /\{open \? \([\s\S]*?<MapExperienceLensControl/,
    );
  });

  it("keeps one table of view names", () => {
    const lens = read("components/map/MapExperienceLens.tsx");
    expect(lens, "one table of view names").toContain(
      "const MAP_EXPERIENCE_LENS_OPTIONS",
    );
  });
});

describe("finding 2.15 — the banners dock under the bar and step off the map", () => {
  it("docks them against the toolbar's measured height, not a constant", () => {
    const toolbarCss = read("components/map/mapToolbar.css");
    expect(toolbar, "the toolbar publishes its own height").toMatch(
      /setProperty\(\s*"--map-toolbar-resting-height"/,
    );
    expect(toolbar).toMatch(/new ResizeObserver/);
    // The constant survives only as the pre-measure fallback.
    expect(toolbarCss).toMatch(/--map-toolbar-resting-height:\s*155px/);
    for (const file of [
      "components/map/citySuggestBanner.module.css",
      "components/map/cityStatusBanner.module.css",
    ]) {
      expect(read(file), `${file} docks under the bar`).toMatch(
        /var\(--map-toolbar-resting-height/,
      );
    }
  });

  it("hides them once the reader moves the camera, and only then", () => {
    const canvas = read("components/PubMapCanvas.tsx");
    // A gesture carries an originalEvent; a programmatic fly does not.
    expect(canvas).toMatch(
      /if \(!event\.originalEvent\) return;/,
    );
    // The four gesture starts register through one loop now, because the same
    // events also hand the camera to the reader (lib/mapGestureGuard.ts), and
    // `beginGesture` calls this one through before it does anything else.
    expect(canvas).toMatch(
      /for \(const name of \["drag", "zoom", "rotate", "pitch"\] as const\)/,
    );
    expect(canvas).toMatch(/map\.on\(`\$\{name\}start`, beginGesture\(name\)\)/);
    expect(canvas).toMatch(/const beginGesture = [\s\S]{0,200}?emitUserCameraMove\(event\);/);
    expect(pubMap).toMatch(/onUserCameraMove=\{dismissAmbientBanners\}/);
    expect(pubMap).toMatch(
      /const ambientBannerLane = !mobileViewport && !mapCameraTouched/,
    );
    // The lane composes a second question: an ambient banner describes the
    // MAP, so it stands down when the shell has put the map's own venue view
    // where the canvas would be (lib/mapCanvasAvailability.ts). At 1440 with
    // the map chunk blocked the city-conditions banner landed straight over
    // that card's sentence and its first pub row.
    // The lane composes a THIRD question since 7 Sep 2026: banners stack one
    // at a time, and while the first-visit strip is up the strip is it.
    expect(pubMap).toMatch(
      /const ambientBannerLaneOpen =\s*\n?\s*ambientBannerLane\s*\n?\s*&& !showMapArrivalCard\s*\n?\s*&& mapAmbientBannersVisible\(/,
    );
    expect(pubMap).toMatch(/\{ambientBannerLaneOpen && !baseLedChrome \?/);
    expect(pubMap).toMatch(/\{ambientBannerLaneOpen && isLondon \?/);
  });
});
