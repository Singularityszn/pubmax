import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import SheetStepProgress, { sheetStepSegmentStates } from "@/components/ui/sheetStepProgress";
import {
  SHEET_REVEAL_IN_DURATION_MS,
  SHEET_REVEAL_IN_TRANSLATE_PX,
} from "@/lib/springMotion";

const ROOT = process.cwd();

describe("sheetStepSegmentStates", () => {
  it("marks steps before the index settled and the index current", () => {
    expect(sheetStepSegmentStates(5, 2)).toEqual([
      "settled",
      "settled",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("clamps step count to five", () => {
    expect(sheetStepSegmentStates(9, 0)).toHaveLength(5);
  });
});

describe("SheetStepProgress", () => {
  it("exposes aria-current on the active segment", () => {
    const html = renderToStaticMarkup(
      createElement(SheetStepProgress, {
        stepCount: 3,
        currentIndex: 1,
        stepLabels: ["One", "Two", "Three"],
        variant: "map",
      }),
    );
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('data-state="current"');
    expect(html).toContain('data-state="settled"');
  });
});

describe("sheet reveal-in motion contract", () => {
  it("pins duration and translate in springMotion and CSS", () => {
    expect(SHEET_REVEAL_IN_DURATION_MS).toBe(260);
    expect(SHEET_REVEAL_IN_TRANSLATE_PX).toBe(14);
    const css = readFileSync(join(ROOT, "components/ui/sheetStepReveal.css"), "utf8");
    expect(css).toContain("260ms ease-out");
    expect(css).toContain("translateY(14px)");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });
});
