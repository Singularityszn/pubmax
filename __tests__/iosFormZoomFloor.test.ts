import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

// Mobile Safari owns form-focus zoom, so Chromium cannot supply computed-style
// evidence for that browser behavior. Six branch-local coarse-pointer floors
// and the four-file pending list were removed because app/globals.css already
// ships one important floor, and the measured route sweep found zero controls
// below 16px. Nothing remains on a pending handoff list. This fence guards that
// one rule and rejects any shipped component rule that can beat it. Sub-16px
// non-important declarations remain valid because the shared important floor
// overrides them.
const FLOOR_PX = 16;
const PHONE_WIDTHS_PX = [360, 390, 430];
const CONTROL_ELEMENTS = ["input", "textarea", "select"];
const REPO_ROOT = join(__dirname, "..");
const GLOBAL_CSS = readFileSync(join(REPO_ROOT, "app", "globals.css"), "utf8");

type Declaration = {
  property: string;
  value: string;
  important: boolean;
};

type CssRule = {
  selectors: string[];
  declarations: Declaration[];
  conditions: string[];
};

function splitOutsideParentheses(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === separator && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function parseCssRules(css: string): CssRule[] {
  const parsed: CssRule[] = [];
  postcss.parse(css).walkRules((rule) => {
    const conditions: string[] = [];
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== "atrule") continue;
      conditions.unshift(
        `@${parent.name}${parent.params ? ` ${parent.params}` : ""}`.replace(/\s+/g, " "),
      );
    }
    parsed.push({
      selectors: rule.selectors,
      declarations: (rule.nodes ?? []).flatMap((node) =>
        node.type === "decl"
          ? [
              {
                property: node.prop.toLowerCase(),
                value: node.value.trim(),
                important: node.important,
              },
            ]
          : [],
      ),
      conditions,
    });
  });
  return parsed;
}

function whereTargets(selector: string): Set<string> {
  const match = /^:where\((.*)\)$/.exec(selector.trim());
  return new Set(match ? splitOutsideParentheses(match[1], ",") : []);
}

function minimumPx(value: string): number | null {
  const max = /^max\((.*)\)$/.exec(value.trim());
  const terms = max ? splitOutsideParentheses(max[1], ",") : [value.trim()];
  const pixels = terms.flatMap((term) => {
    const match = /^(\d+(?:\.\d+)?)px$/.exec(term);
    return match ? [Number(match[1])] : [];
  });
  return pixels.length > 0 ? Math.max(...pixels) : null;
}

function mediaQueryMatchesPhone(query: string, width: number): boolean {
  const normalized = query.trim().toLowerCase();
  if (/\bnot\b/.test(normalized) || /\b(?:print|speech)\b/.test(normalized)) return false;

  const features = [...normalized.matchAll(/\(([^()]*)\)/g)].map((match) => match[1].trim());
  const residue = normalized
    .replace(/\([^()]*\)/g, " ")
    .replace(/\b(?:only|screen|all|and)\b/g, " ")
    .replace(/\s+/g, "")
    .replace(/^,$/, "");
  if (residue) return false;

  return features.every((feature) => {
    const widthMatch = /^(min-|max-)?(?:device-)?width\s*:\s*(\d+(?:\.\d+)?)px$/.exec(feature);
    if (widthMatch) {
      const value = Number(widthMatch[2]);
      if (widthMatch[1] === "min-") return width >= value;
      if (widthMatch[1] === "max-") return width <= value;
      return width === value;
    }
    if (/^(?:any-)?pointer\s*:\s*coarse$/.test(feature)) return true;
    if (/^(?:any-)?hover\s*:\s*none$/.test(feature)) return true;
    if (/^(?:any-)?pointer\s*:\s*(?:fine|none)$/.test(feature)) return false;
    if (/^(?:any-)?hover\s*:\s*hover$/.test(feature)) return false;
    return feature === "orientation: portrait";
  });
}

function conditionMatchesPhones(condition: string): boolean {
  if (condition.startsWith("@layer ")) return true;
  if (!condition.startsWith("@media ")) return false;
  const queries = splitOutsideParentheses(condition.slice("@media ".length), ",");
  return PHONE_WIDTHS_PX.every((width) =>
    queries.some((query) => mediaQueryMatchesPhone(query, width)),
  );
}

function targetsEveryControl(rule: CssRule): boolean {
  const targets = rule.selectors.flatMap((selector) => [...whereTargets(selector)]);
  return CONTROL_ELEMENTS.every((control) => targets.includes(control));
}

function phoneReachableFloor(rules: CssRule[]): CssRule | undefined {
  return rules.find(
    (rule) =>
      targetsEveryControl(rule) &&
      rule.conditions.every((condition) => conditionMatchesPhones(condition)),
  );
}

type ImportantControlConflict = {
  file: string;
  selector: string;
  value: string;
};

function selectorTargetsControl(selector: string): boolean {
  return /(^|[\s>+~,(])(?:input|textarea|select)(?=$|[\s>+~#.:\[,(])/i.test(selector);
}

function importantControlConflicts(css: string, file: string): ImportantControlConflict[] {
  return parseCssRules(css).flatMap((rule) => {
    const declaration = rule.declarations.find(
      (candidate) =>
        candidate.property === "font-size" &&
        candidate.important &&
        (minimumPx(candidate.value) ?? FLOOR_PX) < FLOOR_PX,
    );
    if (!declaration) return [];
    return rule.selectors
      .filter(selectorTargetsControl)
      .map((selector) => ({ file, selector, value: declaration.value }));
  });
}

function walkStylesheets(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkStylesheets(full, files);
    else if (entry.endsWith(".css")) files.push(full);
  }
  return files;
}

const SHIPPED_STYLESHEETS = ["app", "components"].flatMap((dir) =>
  walkStylesheets(join(REPO_ROOT, dir)),
);

describe("iOS form-zoom floor", () => {
  it("rejects a shared floor that only applies to desktop pointers", () => {
    const css = `
      @media (min-width: 900px) and (pointer: fine) {
        :where(input, textarea, select) { font-size: 16px !important; }
      }
    `;
    expect(phoneReachableFloor(parseCssRules(css))).toBeUndefined();
  });

  it("accepts a shared floor scoped to narrow coarse pointers", () => {
    const css = `
      @media (max-width: 430px) and (pointer: coarse) {
        :where(input, textarea, select) { font-size: 16px !important; }
      }
    `;
    expect(phoneReachableFloor(parseCssRules(css))).toBeDefined();
  });

  it("rejects only important component declarations below the floor", () => {
    const css = `
      .fake-input { font-size: 11px !important; }
      .field input { font-size: 15px; }
      .field select { font-size: 15px !important; }
      .field textarea { font-size: max(16px, 1em) !important; }
    `;
    expect(importantControlConflicts(css, "fixture.css")).toEqual([
      { file: "fixture.css", selector: ".field select", value: "15px" },
    ]);
  });

  it("keeps every form control on the shared important 16px floor", () => {
    const rules = parseCssRules(GLOBAL_CSS);
    const candidates = rules.filter(targetsEveryControl);
    const floorRule = phoneReachableFloor(rules);
    const fontSize = floorRule?.declarations.find(
      (declaration) => declaration.property === "font-size",
    );

    expect(
      floorRule,
      candidates.length === 0
        ? "app/globals.css must define the shared control floor"
        : `shared control floor is outside phone conditions: ${candidates
            .flatMap((rule) => rule.conditions)
            .join("; ")}`,
    ).toBeDefined();
    expect(fontSize?.important, "component rules must not override the shared floor").toBe(true);
    expect(
      minimumPx(fontSize?.value ?? ""),
      "floor must include a pixel minimum",
    ).toBeGreaterThanOrEqual(FLOOR_PX);
  });

  it("keeps shipped important component rules from undercutting the floor", () => {
    const conflicts = SHIPPED_STYLESHEETS.flatMap((file) =>
      importantControlConflicts(
        readFileSync(file, "utf8"),
        relative(REPO_ROOT, file).split(sep).join("/"),
      ),
    );
    expect(
      conflicts,
      conflicts
        .map(({ file, selector, value }) => `${file}: ${selector} -> ${value} !important`)
        .join("\n"),
    ).toEqual([]);
  });
});
