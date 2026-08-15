import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Mobile Safari owns form-focus zoom, so Chromium cannot supply computed-style
// evidence for that browser behavior. This fence parses the shipped global CSS
// as a declarative contract and protects the shared cascade invariant instead.
const FLOOR_PX = 16;
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
  const walk = (block: string): void => {
    let start = 0;
    for (let index = 0; index < block.length; index += 1) {
      if (block[index] !== "{") continue;
      const prelude = block.slice(start, index).trim();
      let depth = 1;
      let end = index + 1;
      while (end < block.length && depth > 0) {
        if (block[end] === "{") depth += 1;
        else if (block[end] === "}") depth -= 1;
        end += 1;
      }
      const body = block.slice(index + 1, end - 1);
      if (prelude.startsWith("@")) {
        walk(body);
      } else if (prelude) {
        parsed.push({
          selectors: splitOutsideParentheses(prelude, ","),
          declarations: parseDeclarations(body),
        });
      }
      index = end - 1;
      start = end;
    }
  };
  walk(source);
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

describe("iOS form-zoom floor", () => {
  it("keeps every form control on the shared important 16px floor", () => {
    const floorRule = parseCssRules(GLOBAL_CSS).find((rule) => {
      const targets = rule.selectors.flatMap((selector) => [...whereTargets(selector)]);
      return CONTROL_ELEMENTS.every((control) => targets.includes(control));
    });
    const fontSize = floorRule?.declarations.find(
      (declaration) => declaration.property === "font-size",
    );

    expect(floorRule, "app/globals.css must define the shared control floor").toBeDefined();
    expect(fontSize?.important, "component rules must not override the shared floor").toBe(true);
    expect(
      minimumPx(fontSize?.value ?? ""),
      "floor must include a pixel minimum",
    ).toBeGreaterThanOrEqual(FLOOR_PX);
  });
});
