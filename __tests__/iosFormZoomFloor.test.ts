import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// THE FLOOR. iOS Safari zooms the whole page in when a form control is focused
// and that control's font-size is under 16px. It does not zoom back out on
// blur, so the drinker is left on a magnified page with the site chrome off
// screen and no obvious way back. No unit render reproduces it and no headless
// Chromium run does either: the behaviour belongs to mobile Safari, so the
// fence is the shipped CSS itself, in the idiom of
// __tests__/mobileChromeFit.test.ts.
//
// The rule is a TOUCH rule, not a design rule: a rule may keep its own smaller
// size for a mouse, and states the floor inside `@media (pointer: coarse)` so
// desktop density is untouched. The override must live in the SAME file, at
// equal specificity and after the rule it raises, because a bare-element rule
// somewhere else loses to every component selector regardless of order.
const FLOOR_PX = 16;

const REPO_ROOT = join(__dirname, "..");

// Files whose fix is owned by another lane in flight. This is a documented
// exception, never a mute button: an entry may only be REMOVED. Each names a
// file the V0.1 launch-hardening pass could not touch because the landing,
// map-sheet and planner surfaces were being edited on another branch at the
// same time; the exact rules are listed in that PR under "Handed to Codex
// loop".
const PENDING_TOUCH_FLOOR: ReadonlySet<string> = new Set([
  "app/plan/plan.css",
  "components/map/mapSearchSuggest.css",
  "components/map/mapToolbar.css",
  "components/map/personaLens.css",
]);

/** A control that takes focus and therefore triggers the zoom. */
const CONTROL = /(^|[\s>+~,])(input|textarea|select)\b/;

type Rule = { selector: string; body: string; coarse: boolean };

/**
 * Flattens a stylesheet into its rules, remembering for each whether it sits
 * inside a coarse-pointer media query. Written as a brace scanner rather than a
 * regex because `@media` nests and a regex cannot count braces.
 */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (source: string, coarse: boolean): void => {
    let index = 0;
    let preludeStart = 0;
    while (index < source.length) {
      const char = source[index];
      if (char === "{") {
        const prelude = source.slice(preludeStart, index).trim();
        let depth = 1;
        let cursor = index + 1;
        while (cursor < source.length && depth > 0) {
          if (source[cursor] === "{") depth += 1;
          else if (source[cursor] === "}") depth -= 1;
          cursor += 1;
        }
        const body = source.slice(index + 1, cursor - 1);
        if (prelude.startsWith("@")) {
          walk(body, coarse || /pointer\s*:\s*coarse/.test(prelude));
        } else {
          out.push({ selector: prelude, body, coarse });
        }
        index = cursor;
        preludeStart = cursor;
        continue;
      }
      if (char === "}") {
        preludeStart = index + 1;
      }
      index += 1;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""), false);
  return out;
}

/** The declared font-size of a rule in px, or null when it declares none. */
function declaredFontSizePx(body: string): number | null {
  const match = /(?:^|;)\s*font-size\s*:\s*([\d.]+)(px|rem|em)\s*(?:;|$)/.exec(body);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === "px" ? value : value * 16;
}

/** Every comma-separated part of a selector that targets a focusable control. */
function controlParts(selector: string): string[] {
  return selector
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => CONTROL.test(part));
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith(".css")) acc.push(full);
  }
  return acc;
}

const sheets = [join(REPO_ROOT, "app"), join(REPO_ROOT, "components")]
  .flatMap((dir) => walk(dir))
  .map((file) => ({
    path: relative(REPO_ROOT, file),
    css: readFileSync(file, "utf8"),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

/** Selector parts this file already raises to the floor for coarse pointers. */
function coarseFloorParts(css: string): Set<string> {
  const covered = new Set<string>();
  for (const rule of rules(css)) {
    if (!rule.coarse) continue;
    const size = declaredFontSizePx(rule.body);
    if (size === null || size < FLOOR_PX) continue;
    for (const part of controlParts(rule.selector)) covered.add(part);
  }
  return covered;
}

/** Selector parts this file declares below the floor. */
function belowFloorParts(css: string): string[] {
  const below: string[] = [];
  for (const rule of rules(css)) {
    if (rule.coarse) continue;
    const size = declaredFontSizePx(rule.body);
    if (size === null || size >= FLOOR_PX) continue;
    below.push(...controlParts(rule.selector));
  }
  return below;
}

describe("iOS form-zoom floor", () => {
  it("finds stylesheets to sweep", () => {
    expect(sheets.length).toBeGreaterThan(20);
  });

  for (const sheet of sheets) {
    const below = belowFloorParts(sheet.css);
    if (below.length === 0) continue;

    const pending = PENDING_TOUCH_FLOOR.has(sheet.path);

    it(`${sheet.path} keeps every focusable control at ${FLOOR_PX}px on touch`, () => {
      const covered = coarseFloorParts(sheet.css);
      const uncovered = [...new Set(below)].filter((part) => !covered.has(part));
      if (pending) {
        // A pending file must still be BROKEN, or its exception is stale and
        // the list must shrink.
        expect(
          `${sheet.path} is still pending`,
          "A pending file whose controls now clear the floor must leave PENDING_TOUCH_FLOOR.",
        ).toBe(uncovered.length > 0 ? `${sheet.path} is still pending` : `${sheet.path} is fixed`);
        return;
      }
      expect(uncovered).toEqual([]);
    });
  }

  it("names every pending file as one that really exists", () => {
    const known = new Set(sheets.map((sheet) => sheet.path));
    for (const path of PENDING_TOUCH_FLOOR) expect(known.has(path)).toBe(true);
  });
});
