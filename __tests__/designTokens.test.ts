import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH TOKENS  (docs/DESIGN_SYSTEM.md · "Launch tokens")
//
// app/globals.css is the single token owner (5,900 lines, 268 declarations).
// The September relaunch (issue #1354) names the SUBSET a launch surface may
// reach for, so a new screen picks from a hundred tokens rather than from
// three hundred, and so a token the doc promises cannot quietly leave the
// sheet.
//
// Three things are pinned:
//   1. The doc section and this list agree exactly. A token added to one and
//      not the other fails, in either direction.
//   2. Every launch token is declared in app/globals.css.
//   3. The four launch primitives (components/ui) paint with launch tokens and
//      nothing else: no hex, no rgb(), no token outside the set.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

export const LAUNCH_TOKENS = [
  // Surfaces: the elevation ladder and its semantic names.
  "--paper", "--panel", "--panel-raised", "--panel-overlay", "--ink-deep",
  "--color-surface", "--color-surface-panel", "--color-surface-raised",
  "--color-surface-overlay", "--color-surface-inverse",
  // Text: three inks and what sits on a painted fill.
  "--ink", "--ink-soft", "--muted",
  "--color-text", "--color-text-soft", "--color-text-muted",
  "--color-on-accent", "--color-on-accent-strong", "--color-on-inverse", "--color-on-photo",
  // Edges.
  "--line", "--line-soft", "--hairline", "--hairline-strong",
  "--color-border", "--color-border-soft",
  // Accent: one coral, the login-only deepened coral, the light-only ink for
  // coral WORDS, and the action aliases.
  "--brass", "--brass-bright", "--brass-accessible", "--brass-ink",
  "--color-accent", "--color-accent-strong", "--color-accent-ink",
  "--accent-action", "--accent-action-strong",
  // Status and price: semantic hues, never decoration.
  "--pint", "--amber", "--brick", "--river",
  "--color-positive", "--color-caution", "--color-negative", "--color-info",
  "--accent-price", "--accent-price-ink",
  // Price band (lib/priceBand.ts): the hue paints a fill, the ink reads as text.
  "--price-band-cheap", "--price-band-average", "--price-band-expensive",
  "--price-band-cheap-ink", "--price-band-average-ink", "--price-band-expensive-ink",
  // Set on the element by the .priceBand-* class family; read by badge, figure and pill.
  "--price-band-hue", "--price-band-ink", "--price-band-surface", "--price-band-border",
  "--badge-surface", "--badge-border", "--badge-ink",
  "--state-active-surface", "--state-active-border", "--state-active-ink",
  // Type.
  "--font-display", "--font-body", "--font-data",
  "--text-2xs", "--text-xs", "--text-sm", "--text-base", "--text-md",
  "--text-lg", "--text-xl", "--text-2xl", "--text-3xl",
  "--leading-tight", "--leading-snug", "--leading-normal", "--tracking-tight",
  // Space and measure.
  "--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6",
  "--space-8", "--space-10", "--space-12",
  "--page-gutter", "--content-max", "--content-max-wide",
  // Shape and depth.
  "--radius", "--radius-sm", "--radius-lg", "--radius-pill", "--control-radius",
  "--shadow", "--shadow-sm",
  // Motion.
  "--duration-fast", "--duration-base", "--duration-slow",
  "--ease-out", "--ease-out-strong", "--press-scale",
  // Stacking.
  "--z-float", "--z-nav", "--z-tabbar", "--z-modal", "--z-overlay-top",
] as const;

/** The four primitives PR "design tokens and primitives" ships (issue #1354). */
const PRIMITIVE_STYLESHEETS = [
  "components/ui/kicker.css",
  "components/ui/trustPill.css",
  "components/ui/emptyState.css",
  "components/ui/screen.css",
] as const;

const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

function launchTokensSection(doc: string): string {
  const start = doc.indexOf("## Launch tokens");
  expect(start, "docs/DESIGN_SYSTEM.md has a '## Launch tokens' section").toBeGreaterThan(-1);
  const rest = doc.slice(start + "## Launch tokens".length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

function declaredTokens(css: string): Set<string> {
  // Every `--name:` declared anywhere in the sheet. Theme and legacy blocks
  // override values, never introduce names, so the union is the :root set.
  return new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => defined(m[1])));
}

describe("launch tokens", () => {
  const globals = read("app/globals.css");
  const declared = declaredTokens(globals);
  const section = launchTokensSection(read("docs/DESIGN_SYSTEM.md"));
  const documented = new Set([...section.matchAll(/`(--[a-z0-9-]+)`/g)].map((m) => defined(m[1])));
  const launch: readonly string[] = LAUNCH_TOKENS;

  it("names a closed set with no duplicates", () => {
    expect(new Set(launch).size).toBe(launch.length);
  });

  it("documents exactly the launch set in docs/DESIGN_SYSTEM.md", () => {
    const missingFromDoc = launch.filter((token) => !documented.has(token));
    const extraInDoc = [...documented].filter((token) => !launch.includes(defined(token)));
    expect(missingFromDoc, "tokens in the test but not in the doc section").toEqual([]);
    expect(extraInDoc, "tokens in the doc section but not in the test").toEqual([]);
  });

  it("declares every launch token in app/globals.css", () => {
    const undeclared = launch.filter((token) => !declared.has(token));
    expect(undeclared).toEqual([]);
  });

  it("keeps the radius table from sending a control back to 6px", () => {
    // #1597 spent a night taking 6px corners off eleven control families, and
    // the same document's radius table still read "--radius-sm 6px  tight
    // corner (chips, small controls)" two hundred lines later. A lane building
    // the next surface reads the table, not the Launch tokens section, and
    // ships the defect back. The doc names ONE radius for a control.
    const doc = read("docs/DESIGN_SYSTEM.md");
    const radiusTable = doc.slice(doc.indexOf("## Spacing, radius, shadow"));
    const smallRadiusLine = radiusTable
      .split("\n")
      .find((line) => line.startsWith("--radius-sm"));

    expect(smallRadiusLine, "the radius table names --radius-sm").toBeDefined();
    expect(
      /control/i.test(smallRadiusLine ?? ""),
      "--radius-sm may not be offered to a control; --control-radius is the one control corner",
    ).toBe(false);
    expect(radiusTable, "the table sends a control to --control-radius").toContain(
      "--control-radius",
    );
  });

  for (const sheet of PRIMITIVE_STYLESHEETS) {
    it(`${sheet} paints with launch tokens only`, () => {
      const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, "no hex literal").not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css, "no rgb()/hsl() literal").not.toMatch(/\b(?:rgba?|hsla?)\(/i);
      expect(css, "no uppercase transform: kickers are sentence case").not.toMatch(/text-transform\s*:\s*uppercase/);
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => defined(m[1]));
      const foreign = [...new Set(used)].filter((token) => !launch.includes(defined(token)));
      expect(foreign, "tokens outside the launch set").toEqual([]);
    });
  }
});
