// THE /about PRESS-KIT LINKS CLEAR 44px ON A PHONE WIDTH, WHATEVER THE POINTER
// QUERY SAYS.
//
// The press-kit row lays its two download links out as their own boxes, so
// e2e/launch-phone-controls.spec.ts holds them to the 44px tap floor. The
// floor sat under `@media (pointer: coarse)` alone. On 16 October 2026 the
// macOS layout-pins shard measured them at 93x23 at 390px on one attempt
// and 44px on the retry, so the floor had not applied on that load, and the
// gate counts a retry as a failure. A phone-width clause, at the 560px
// breakpoint the press-kit row already uses, keeps the floor on every
// phone-width layout; a wide desktop window still keeps its measure.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "app/about/about.css"), "utf8");

/** The media queries whose rules give `.aboutLogoLinks .aboutLink` a min-height. */
function floorMediaQueries(): string[] {
  const queries: string[] = [];
  postcss.parse(CSS).walkRules((rule: Rule) => {
    if (!rule.selectors.includes(".aboutLogoLinks .aboutLink")) return;
    let minHeight: string | undefined;
    rule.walkDecls("min-height", (decl) => {
      minHeight = decl.value;
    });
    if (minHeight !== "44px") return;
    const parent = rule.parent;
    queries.push(parent?.type === "atrule" ? (parent as AtRule).params : "");
  });
  return queries;
}

describe("the /about press-kit tap floor", () => {
  it("gives the press-kit links a 44px floor", () => {
    expect(floorMediaQueries()).toHaveLength(1);
  });

  it("applies at phone widths without depending on the pointer query alone", () => {
    const [query] = floorMediaQueries();
    const alternatives = (query ?? "").split(",").map((part) => part.trim());
    // A query list matches when any of its parts does.
    expect(alternatives).toContain("(pointer: coarse)");
    expect(alternatives).toContain("(max-width: 559px)");
  });
});
