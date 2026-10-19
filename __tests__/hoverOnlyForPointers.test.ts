// A hover style is for a mouse (taste plan, 18 Oct 2026).
//
// On a touch screen the browser applies :hover on tap and keeps it until the
// next tap somewhere else, so a row tapped in the phone shell stayed lit as if
// it were still selected. Every :hover rule therefore lives inside
// `@media (hover: hover) and (pointer: fine)`, where a touch screen never
// matches it.
//
// The one exception is a REVEAL: a hover that shows another element (its
// display, visibility or opacity). Gating that would hide the content from a
// touch reader for good, so it stays bare and is named here. The list may only
// shrink.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import postcss, { type AtRule, type Node, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCOPES = ["app", "components"];

const REVEAL_ALLOWLIST = new Set<string>([]);

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

function insidePointerQuery(rule: Rule): boolean {
  let parent: Node | undefined = rule.parent;
  while (parent) {
    if (parent.type === "atrule" && /hover\s*:\s*hover|any-hover/.test((parent as AtRule).params)) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function bareHoverRules(): string[] {
  const found: string[] = [];
  for (const scope of SCOPES) {
    for (const file of cssFiles(join(ROOT, scope))) {
      const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
      root.walkRules((rule) => {
        if (!rule.selector.includes(":hover") || insidePointerQuery(rule)) return;
        const hover = rule.selectors.filter((selector) => selector.includes(":hover"));
        found.push(`${relative(ROOT, file)} :: ${hover.join(", ")}`);
      });
    }
  }
  return found.sort();
}

describe("hover is for a mouse", () => {
  it("keeps every :hover rule inside a fine-pointer hover query, bar the named reveals", () => {
    expect(bareHoverRules()).toEqual([...REVEAL_ALLOWLIST].sort());
  });
});
