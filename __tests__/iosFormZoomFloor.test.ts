import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Mobile Safari owns form-focus zoom, so Chromium cannot supply computed-style
// evidence for that browser behavior. This fence parses the shipped global CSS
// as a declarative contract and protects the shared cascade invariant instead.
const FLOOR_PX = 16;
const PHONE_WIDTHS_PX = [360, 390, 430];
const CONTROL_ELEMENTS = ["input", "textarea", "select"];
const GLOBAL_CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

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

function parseDeclarations(body: string): Declaration[] {
  return splitOutsideParentheses(body, ";").flatMap((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 0) return [];
    const property = entry.slice(0, separator).trim().toLowerCase();
    const rawValue = entry.slice(separator + 1).trim();
    const important = /\s*!important\s*$/i.test(rawValue);
    return [
      {
        property,
        value: rawValue.replace(/\s*!important\s*$/i, "").trim(),
        important,
      },
    ];
  });
}

function parseCssRules(css: string): CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const parsed: CssRule[] = [];
  const walk = (block: string, conditions: string[]): void => {
    let start = 0;
    for (let index = 0; index < block.length; index += 1) {
      if (block[index] !== "{") continue;
      const rawPrelude = block.slice(start, index).trim();
      const prelude = rawPrelude.slice(rawPrelude.lastIndexOf(";") + 1).trim();
      let depth = 1;
      let end = index + 1;
      while (end < block.length && depth > 0) {
        if (block[end] === "{") depth += 1;
        else if (block[end] === "}") depth -= 1;
        end += 1;
      }
      const body = block.slice(index + 1, end - 1);
      if (prelude.startsWith("@")) {
        walk(body, [...conditions, prelude.replace(/\s+/g, " ")]);
      } else if (prelude) {
        parsed.push({
          selectors: splitOutsideParentheses(prelude, ","),
          declarations: parseDeclarations(body),
          conditions,
        });
      }
      index = end - 1;
      start = end;
    }
  };
  walk(source, []);
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
});
