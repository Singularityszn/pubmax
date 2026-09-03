import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Regression lock for the landing chrome (safe-area insets, the mobile
// legibility floor, the reduced-motion gate, and the rail's bleed). Text
// assertions over the shipped CSS, the same house pattern as
// brandStrikeCss.test.ts, so a silent revert fails here rather than in a
// browser QA pass nobody runs.

const landingCss = readFileSync(
  join(process.cwd(), "components/landing/landing.css"),
  "utf8",
);

function ruleBody(css: string, selector: string): string {
  // Escape regex metacharacters, then grab the first block whose selector list
  // STARTS at a line boundary with this selector.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*{([^}]*)}`))?.[1] ?? "";
}

describe("landing chrome CSS audit", () => {
  it("clears the notch on the fixed nav in both default and mobile widths", () => {
    expect(landingCss).toMatch(/top:\s*max\(14px,\s*env\(safe-area-inset-top\)\)/);
    expect(landingCss).toMatch(/top:\s*max\(10px,\s*env\(safe-area-inset-top\)\)/);
  });

  it("paints the nav solid: no glass, no gradient", () => {
    const nav = ruleBody(landingCss, ".lpNav");
    expect(nav).toMatch(/background:\s*var\(--panel-raised\)/);
    expect(nav).not.toMatch(/backdrop-filter|gradient/);
  });

  it("contains overscroll on the pint-drop rail and bleeds it symmetrically", () => {
    expect(ruleBody(landingCss, ".dropStripRail")).toMatch(/overscroll-behavior-x:\s*contain/);
    expect(landingCss).not.toMatch(/\.dropStripRail\s*{[^}]*width:\s*calc\(100vw/);
    expect(landingCss).toMatch(/margin-inline:\s*calc\(-1 \* var\(--page-gutter\)\)/);
  });

  it("floors every mobile micro-label to at least 12px", () => {
    const floor = landingCss.match(/@media \(max-width: 700px\) {[\s\S]*?\.lpReadoutStat dt\s*{\s*font-size:\s*12px/);
    expect(floor, "readout label floored to 12px on mobile").not.toBeNull();
    expect(landingCss).toMatch(/\.dropStripWho, \.dropStripHint, \.dropStripEra, \.provChip\s*{\s*font-size:\s*12px/);
  });

  it("stacks the readout on a phone with a rule above, not a staircase", () => {
    const stacked = landingCss.match(/@media \(max-width: 700px\) {[\s\S]*?\.lpReadoutStat \+ \.lpReadoutStat\s*{([^}]*)}/)?.[1] ?? "";
    expect(stacked).toMatch(/border-left:\s*0/);
    expect(stacked).toMatch(/padding-left:\s*0/);
    expect(stacked).toMatch(/border-top:\s*1px solid/);
  });

  it("kills every animation and transition under reduced motion", () => {
    const reduce = landingCss.match(/@media \(prefers-reduced-motion: reduce\) {([\s\S]*?)}\s*}/)?.[1] ?? "";
    expect(reduce).toMatch(/animation:\s*none !important/);
    expect(reduce).toMatch(/transition:\s*none !important/);
  });

  it("carries none of the retired decoration", () => {
    expect(landingCss).not.toMatch(/orbit|scanline|blueprint|radial-gradient|thamesHero|cinema|lpFinalCta|lpMemory|lpSignal/i);
    expect(landingCss).not.toMatch(/100vh\b/);
  });
});
