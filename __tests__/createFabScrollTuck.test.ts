import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CREATE_FAB_SCROLL_TUCK_MIN_OFFSET as MIN,
  CREATE_FAB_SCROLL_TUCK_THRESHOLD as STEP,
  nextCreateFabScrollTucked,
} from "@/lib/createFabScrollTuck";

// The floating + sat on running prose (/about, 390x844, 16 Oct 2026 design
// audit): the lane it reserves reaches only rows that opt in, and a paragraph
// cannot give up 80px of its line. Reading down tucks it; anything else
// brings it back.
describe("when the compose control tucks for the page under it", () => {
  const maxY = 4000;

  it("stays put near the top, before the reader has moved", () => {
    expect(nextCreateFabScrollTucked({ y: MIN, anchorY: 0, maxY })).toBe(false);
  });

  it("tucks when the reader scrolls down past the first screen", () => {
    expect(nextCreateFabScrollTucked({ y: 600, anchorY: 400, maxY })).toBe(true);
  });

  it("comes back when the reader scrolls up", () => {
    expect(nextCreateFabScrollTucked({ y: 600, anchorY: 800, maxY })).toBe(false);
  });

  it("ignores travel under the threshold, so jitter never flickers it", () => {
    expect(nextCreateFabScrollTucked({ y: 600 + STEP - 1, anchorY: 600, maxY })).toBeUndefined();
    expect(nextCreateFabScrollTucked({ y: 600 - STEP + 1, anchorY: 600, maxY })).toBeUndefined();
  });

  it("comes back at the foot of the page, where the body reserves its band", () => {
    expect(nextCreateFabScrollTucked({ y: maxY, anchorY: maxY - 300, maxY })).toBe(false);
    expect(nextCreateFabScrollTucked({ y: maxY + 40, anchorY: maxY - 300, maxY })).toBe(false);
  });
});

describe("a tucked control is still reachable", () => {
  const css = readFileSync(join(__dirname, "..", "components/nav/createFab.css"), "utf8");

  it("never hides from the tab order, and focus brings it back", () => {
    const rule = /\.createFabRoot\.isScrollTucked:not\(:focus-within\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("opacity: 0");
    expect(rule).not.toMatch(/visibility|display/);
  });

  it("jumps rather than animates under reduced motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.createFabRoot,\s*\n\s*\.createFabRoot\.isScrollTucked:not\(:focus-within\)\s*\{\s*transition: none;/);
  });
});

describe("a tucked control keeps its box", () => {
  const css = readFileSync(join(__dirname, "..", "components/nav/createFab.css"), "utf8");

  it("fades without moving, so lane and berth measures still read the real control", () => {
    const rule = /\.createFabRoot\.isScrollTucked:not\(:focus-within\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).not.toMatch(/transform|scale|translate/);
  });
});
