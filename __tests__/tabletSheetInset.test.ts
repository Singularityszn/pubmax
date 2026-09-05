import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE TABLET SHEET PUBLISHES ITS OWN OFFSET, AND NOTHING RESTATES IT (#1516).
 *
 * At 641-768 the inline map drawer is a viewport-tall bottom sheet translated
 * down by its snap fraction. Every consumer that compensated for the part of
 * the sheet hanging under the viewport used to restate that translate in dvh,
 * and the map shell was a scroll container that `scrollIntoView` could move.
 * The measured failure: at 768x1024 one scrollIntoView on a price row scrolled
 * `main.appShell` 403px, the drawer's box moved, the sticky command bar kept
 * its 45dvh inset and sat mid-viewport over "Published price".
 *
 * Three source-level fences, each one half of the fix:
 *  1. the shell is `overflow: clip`, which no script can scroll;
 *  2. SpringDrawer publishes the px it translates by as `--drawer-sheet-offset`,
 *     globals.css derives `--sheet-hidden-below` from it once and ends the
 *     scroll body with a spacer of that height;
 *  3. the venue command bar reads that variable and carries no dvh of its own.
 * The rendered geometry is `e2e/venue-sheet-tablet-command-bar.spec.ts`.
 */

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const globalCss = read("app/globals.css");
const venueCss = read("components/map/venueSheet.css");
const springDrawerSource = read("components/map/SpringDrawer.tsx");

function block(css: string, selector: RegExp): string {
  const match = css.match(new RegExp(`${selector.source}\\s*{([^}]*)}`));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe("the map shell cannot be scrolled by anything", () => {
  it("clips its overflow rather than hiding it", () => {
    const shell = block(globalCss, /\n\.appShell/);
    expect(shell).toMatch(/overflow:\s*clip;/);
    expect(shell).not.toMatch(/overflow:\s*hidden/);
  });
});

describe("the 641-768 sheet publishes how much of itself is below the viewport", () => {
  const tabletBand = globalCss.slice(
    globalCss.indexOf("Keep in sync with lib/sheetSnap.ts SHEET_SNAP_FRACTIONS / venueSheet.css"),
  );

  it("declares a per-snap fallback offset beside each snap transform", () => {
    for (const [snap, offset] of [
      ["half", "45dvh"],
      ["peek", "78dvh"],
      ["full", "8dvh"],
    ] as const) {
      const rule = block(
        tabletBand,
        new RegExp(
          `\\.mapDrawer\\.right\\.open\\.sheet-${snap}:not\\(\\.sheet-dragging\\):not\\(\\.mobileSharedSheet\\)`,
        ),
      );
      expect(rule, snap).toMatch(new RegExp(`--drawer-sheet-offset:\\s*${offset};`));
      expect(rule, snap).toMatch(new RegExp(`transform:\\s*translateY\\(${offset}\\)\\s*!important`));
    }
  });

  it("derives one hidden-below value from the offset less the lane the sheet sits above", () => {
    const rule = block(
      tabletBand,
      /\.mapDrawer\.left\.open:not\(\.mobileSharedSheet\),\s*\.mapDrawer\.right\.open:not\(\.mobileSharedSheet\)/,
    );
    expect(rule.replace(/\s+/g, " ")).toContain(
      "--sheet-hidden-below: max( 0px, calc(var(--drawer-sheet-offset, 0px) - var(--mobile-tab-clearance)) );",
    );
    // A spacer, never padding: Chromium measures a sticky inset from the
    // scroller's content edge, so padding would move the edge the inset reads.
    expect(rule).not.toMatch(/padding-bottom/);
    const spacer = block(
      tabletBand,
      /\.mapDrawer\.left\.open:not\(\.mobileSharedSheet\)::after,\s*\.mapDrawer\.right\.open:not\(\.mobileSharedSheet\)::after/,
    );
    expect(spacer).toMatch(/content:\s*"";/);
    expect(spacer).toMatch(/height:\s*var\(--sheet-hidden-below\);/);
  });

  it("is written by SpringDrawer from the px it translates the sheet by", () => {
    expect(springDrawerSource).toContain('"--drawer-sheet-offset"?: string;');
    expect(springDrawerSource).toMatch(
      /tabletSheet\s*\?\s*{\s*"--drawer-sheet-offset":\s*`\$\{verticalValue\}px`\s*}/,
    );
  });
});

describe("the venue command bar reads the sheet's offset and restates nothing", () => {
  it("takes its inset from --sheet-hidden-below", () => {
    expect(venueCss).toMatch(
      /\.mapDrawer\.right\.open:not\(\.mobileSharedSheet\) \.venueSheetStickyBar\s*{[^}]*bottom:\s*var\(--sheet-hidden-below, 0px\);/,
    );
  });

  it("declares the drawer's viewing region as the hidden part plus the bar", () => {
    const rule = block(venueCss, /\n\.mapDrawer\.right\.open:not\(\.mobileSharedSheet\)/);
    expect(rule).toMatch(/--venue-command-bar-h:\s*calc\(65px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(rule.replace(/\s+/g, " ")).toContain(
      "scroll-padding-bottom: calc( var(--sheet-hidden-below, 0px) + var(--venue-command-bar-h) );",
    );
  });

  it("carries no viewport unit of its own in any sticky-bar rule", () => {
    const stickyRules = venueCss.match(/[^{}]*\.venueSheetStickyBar[^{]*{[^}]*}/g) ?? [];
    expect(stickyRules.length).toBeGreaterThan(0);
    for (const rule of stickyRules) {
      expect(rule, rule.trim().split("\n")[0]).not.toMatch(/\d(d?vh)\b/);
    }
  });
});
