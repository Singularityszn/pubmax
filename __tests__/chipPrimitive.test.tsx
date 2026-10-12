import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { Chip } from "@/components/ui/chip";
import { NumberChip } from "@/components/ui/numberChip";

// A NUMBER SQUARE IS ONE FAMILY. The 6 September 2026 design review measured
// the planner's pub-stop count at 10px corners and the /pubs fare-zone picker
// at --radius-sm on 44px squares: two look-alike controls asking the same
// question in two shapes. Both now use the shared chipBase renderer, painted from
// the same --control-* row every text button reads.

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const chipCss = read("components/ui/chip.css");

describe("the Chip primitive", () => {
  it("is painted OUTSIDE every cascade layer, where the unlayered reset cannot beat it", () => {
    // Same reason as button.css: `button { font: inherit }` is unlayered in
    // app/globals.css and outranks every layered utility, which is why the
    // Tailwind `text-sm font-bold` this primitive used to carry rendered as the
    // inherited 16px at weight 400.
    expect(chipCss).not.toMatch(/^\s*@layer/m);
    expect(read("components/ui/chipBase.tsx")).toContain('import "./chip.css"');
    expect(read("components/ui/chip.tsx")).not.toMatch(/rounded-\[|text-sm|font-bold/);
  });

  it("reads the one row of control tokens rather than restating a figure", () => {
    const base = chipCss.match(/\.uiChip\s*{([^}]*)}/)?.[1] ?? "";
    expect(base).toMatch(/min-height:\s*var\(--control-height/);
    expect(base).toMatch(/font-size:\s*var\(--control-font-size/);
    expect(base).toMatch(/font-weight:\s*var\(--control-font-weight/);
    expect(base).toMatch(/background:\s*var\(--control-secondary-surface/);
    expect(base.indexOf("font: inherit")).toBeLessThan(base.indexOf("font-size:"));

    // The square differs in SHAPE alone, and its shape is the control radius.
    const number = chipCss.match(/\.uiChip--number\s*{([^}]*)}/)?.[1] ?? "";
    expect(number).toMatch(/min-width:\s*var\(--control-height/);
    expect(number).toMatch(/border-radius:\s*var\(--control-radius/);
    expect(number).not.toMatch(/border-radius:\s*(10px|var\(--radius-sm)/);
  });

  it("composes classes from that sheet and nothing from a utility layer", () => {
    expect(renderToStaticMarkup(createElement(Chip, null, "Solo"))).toBe(
      '<button type="button" class="uiChip">Solo</button>',
    );
    expect(
      renderToStaticMarkup(createElement(Chip, { variant: "number" }, "3")),
    ).toBe('<button type="button" class="uiChip uiChip--number">3</button>');
  });

  it("keeps arbitrary utility-conflict merging in the generic Chip", () => {
    expect(renderToStaticMarkup(createElement(Chip, {
      variant: "number", className: "p-2 p-4", type: "submit", "aria-pressed": true,
    }, "3"))).toBe(
      '<button type="submit" class="uiChip uiChip--number p-4" aria-pressed="true">3</button>',
    );
  });

  it("renders the closed number entry identically to the generic number variant", () => {
    for (const type of [undefined, "button", "submit", "reset"] as const) {
      const props = { type, "aria-pressed": true as const, "aria-disabled": true as const, title: "Pub stops" };
      expect(renderToStaticMarkup(createElement(NumberChip, props, "3"))).toBe(
        renderToStaticMarkup(createElement(Chip, { ...props, variant: "number" }, "3")),
      );
    }
  });

  it("carries the chosen state on aria-pressed, so the state and the label agree", () => {
    expect(chipCss).toMatch(/\.uiChip\[aria-pressed="true"\]/);
    const chosen = chipCss.match(/\.uiChip\[aria-pressed="true"\]\s*{([^}]*)}/)?.[1] ?? "";
    // The quiet active tint, never the painted primary: a chip row is a
    // refinement and the loud fill belongs to the screen's one primary.
    expect(chosen).toMatch(/background:\s*var\(--control-tint-surface/);
  });
});

describe("the two number-square surfaces share ONE renderer", () => {
  const planner = read("components/plan/PlanStopCountPicker.tsx");
  const pubs = read("components/pubs/PubsFilters.tsx");

  it("the planner's pub-stop count is the shared number chip", () => {
    expect(planner).toContain('from "@/components/ui/numberChip"');
    expect(planner).toMatch(/<NumberChip\b/);
    expect(read("components/ui/numberChip.tsx")).toContain('from "./chipBase"');
    expect(read("components/ui/chip.tsx")).toContain('from "./chipBase"');
    expect(planner).not.toMatch(/<button\b/);
  });

  it("the /pubs fare-zone picker is the same component, not a look-alike", () => {
    expect(pubs).toContain('from "@/components/ui/chip"');
    expect(pubs).toMatch(/<Chip\b[\s\S]*?variant="number"/);
    // The old bespoke square is gone from this surface. The map's own segmented
    // zone picker keeps `.zoneChip`: it is one control divided into segments by
    // a recorded design judgement, not a row of squares.
    expect(pubs).not.toMatch(/"zoneChip( isOn)?"/);
  });

  it("neither surface paints a square of its own any more", () => {
    const planCss = read("app/plan/plan.css");
    expect(planCss).not.toMatch(/\.planStopCount__choices button\s*{/);
    // Layout still belongs to the surface; only the paint moved.
    expect(planCss).toMatch(/\.planStopCount__choices\s*{[^}]*display: flex/);
  });
});
