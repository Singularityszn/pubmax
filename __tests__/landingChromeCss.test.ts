import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Regression lock for the landing/night-signals chrome audit (safe-area insets,
// mobile legibility floor, touch-target sizes, dark-panel text contrast, and
// the reduced-motion gate). These are text assertions over the shipped CSS, the
// same house pattern as brandStrikeCss.test.ts — so a silent revert of any fix
// fails CI rather than a browser QA pass we can't run headless.

const landingCss = readFileSync(
  join(process.cwd(), "components/landing/landing.css"),
  "utf8",
);
const nightSignalsCss = readFileSync(
  join(process.cwd(), "components/landing/nightSignals.css"),
  "utf8",
);

function ruleBody(css: string, selector: string): string {
  // Escape regex metacharacters, then grab the first block whose selector list
  // STARTS at a line boundary with this selector - `.lpSectionLabel` must not
  // match the descendant rule `.lpWhyCopy .lpSectionLabel`.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*{([^}]*)}`))?.[1] ?? "";
}

describe("landing chrome CSS audit", () => {
  it("keeps the blueprint ground theme-derived and limited to paper sections", () => {
    expect(ruleBody(landingCss, ".lp")).toMatch(
      /--lp-blueprint-dot:\s*color-mix\([^;]*var\(--river\)/,
    );
    expect(landingCss).toMatch(
      /\.lpSignalSection,\s*\.lpProofSection,\s*\.lpCityChooser\s*{[\s\S]*?background-image:\s*radial-gradient\([^}]*var\(--lp-blueprint-dot\)[^}]*background-size:\s*24px 24px/,
    );
  });

  it("draws blueprint rules and slash-prefixes mono section labels", () => {
    expect(landingCss).toMatch(
      /\.lpSignalSection::after,\s*\.lpProofSection::after,\s*\.lpCityChooser::after\s*{[\s\S]*?pointer-events:\s*none[^}]*var\(--lp-blueprint-rule\)[^}]*100% 1px no-repeat[^}]*1px 10px no-repeat/,
    );
    expect(ruleBody(landingCss, ".lpSectionLabel")).toMatch(
      /font:[^;]*var\(--font-data\)/,
    );
    expect(ruleBody(landingCss, ".lpSectionLabel::before")).toMatch(
      /content:\s*"\/\/ "\s*\/\s*""/,
    );
  });

  it("uses the blueprint label treatment for the landing city eyebrow", () => {
    expect(
      ruleBody(landingCss, ".lpCityChooser .cityChooserEyebrow"),
    ).toMatch(/gap:\s*\.5ch[^}]*font:[^;]*var\(--font-data\)/);
    expect(
      ruleBody(landingCss, ".lpCityChooser .cityChooserEyebrow::before"),
    ).toMatch(/content:\s*"\/\/ "\s*\/\s*""/);
  });

  it("clears the notch on the fixed nav in both default and mobile widths", () => {
    // The base .lpNav and the <=700px override both honour the top inset.
    expect(landingCss).toMatch(/top:\s*max\(14px,\s*env\(safe-area-inset-top\)\)/);
    expect(landingCss).toMatch(/top:\s*max\(10px,\s*env\(safe-area-inset-top\)\)/);
  });

  it("contains overscroll on the pint-drop rail and bleeds it symmetrically", () => {
    expect(ruleBody(landingCss, ".dropStripRail")).toMatch(/overscroll-behavior-x:\s*contain/);
    // The old asymmetric width: calc(100vw - 18px) bleed is gone.
    expect(landingCss).not.toMatch(/\.dropStripRail\s*{[^}]*width:\s*calc\(100vw/);
    expect(landingCss).toMatch(/margin-inline:\s*calc\(-1 \* var\(--lp-pad\)\)/);
  });

  it("floors every mobile micro-label to at least 12px", () => {
    // The worst offender: the hero pin category (was 8px) is the only visible
    // label on a pin at phone width.
    const floor = landingCss.match(/@media \(max-width: 700px\) {[\s\S]*?\.thamesHeroPinCat\s*{\s*font-size:\s*12px/);
    expect(floor, "thamesHeroPinCat floored to 12px on mobile").not.toBeNull();
    expect(landingCss).toMatch(/\.lpFinalCta > p\s*{\s*font-size:\s*12px/);
  });

  it("raises dark-panel micro-text to ~.7 alpha", () => {
    expect(ruleBody(landingCss, ".lpMemorySteps li div > span")).toMatch(/rgba\(255,255,255,\.7\)/);
    expect(ruleBody(landingCss, ".lpFinalCta > p")).toMatch(/rgba\(255,255,255,\.7\)/);
  });

  it("shows three hero pins on the 430px primary canvas", () => {
    expect(landingCss).toMatch(/@media \(max-width: 430px\)[\s\S]*?\.thamesHeroPin:nth-child\(n\+4\)\s*{\s*display:\s*none/);
  });

  it("night-signals: 44px confirm buttons, 12px micro-type, gated animation", () => {
    expect(ruleBody(nightSignalsCss, ".signalConfirm button")).toMatch(/min-height:\s*44px/);
    // The 8px span and other sub-12px labels are floored.
    expect(nightSignalsCss).not.toMatch(/font:\s*600 8px/);
    expect(ruleBody(nightSignalsCss, ".signalConfirm span")).toMatch(/12px/);
    const reduced = nightSignalsCss.match(/@media \(prefers-reduced-motion: reduce\) {([\s\S]*?)}\s*}/)?.[1] ?? nightSignalsCss.match(/@media \(prefers-reduced-motion: reduce\) {([^}]*)}/)?.[1] ?? "";
    expect(reduced).toMatch(/animation:\s*none\s*!important/);
    expect(reduced).toMatch(/transition:\s*none\s*!important/);
  });
});
