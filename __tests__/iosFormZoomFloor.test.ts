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
  reason: string;
};

const TYPE_SELECTOR_BOUNDARIES = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "\f",
  ">",
  "+",
  "~",
  ",",
  "(",
  "|",
]);

function stripSelectorNoise(selector: string): string {
  let stripped = "";
  let attributeDepth = 0;
  let quote = "";
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      stripped += " ";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      stripped += " ";
      continue;
    }
    if (character === "/" && selector[index + 1] === "*") {
      stripped += "  ";
      index += 2;
      while (
        index < selector.length &&
        !(selector[index] === "*" && selector[index + 1] === "/")
      ) {
        stripped += " ";
        index += 1;
      }
      if (index < selector.length) stripped += "  ";
      index += 1;
      continue;
    }
    if (character === "[") {
      attributeDepth += 1;
      stripped += " ";
      continue;
    }
    if (attributeDepth > 0) {
      if (character === "]") attributeDepth -= 1;
      stripped += " ";
      continue;
    }
    if (character === "\\") {
      stripped += "  ";
      index += 1;
      continue;
    }
    stripped += character;
  }
  return stripped;
}

function isIdentifierStart(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    character === "-" ||
    character === "_" ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isIdentifierCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return isIdentifierStart(character) || (code >= 48 && code <= 57);
}

function typeSelectorTokens(selector: string): string[] {
  const stripped = stripSelectorNoise(selector);
  const tokens: string[] = [];
  for (let index = 0; index < stripped.length; ) {
    if (!isIdentifierStart(stripped[index])) {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < stripped.length && isIdentifierCharacter(stripped[index])) {
      index += 1;
    }
    const preceding = start === 0 ? "" : stripped[start - 1];
    if (start === 0 || TYPE_SELECTOR_BOUNDARIES.has(preceding)) {
      tokens.push(stripped.slice(start, index).toLowerCase());
    }
  }
  return tokens;
}

function selectorTargetsControl(selector: string): boolean {
  return typeSelectorTokens(selector).some((token) => CONTROL_ELEMENTS.includes(token));
}

type LowerBoundProof =
  | { resolved: true; px: number }
  | { resolved: false; reason: string };

function lengthLowerBound(value: string): LowerBoundProof {
  const normalized = value.trim();
  if (/^[+-]?0(?:\.0+)?$/.test(normalized)) return { resolved: true, px: 0 };

  const length = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|rem|em|pt)$/i.exec(normalized);
  if (length) {
    const amount = Number(length[1]);
    const unit = length[2].toLowerCase();
    if (unit === "em") {
      return { resolved: false, reason: `${normalized} depends on an unknown parent size` };
    }
    const multiplier = unit === "rem" ? FLOOR_PX : unit === "pt" ? 96 / 72 : 1;
    return { resolved: true, px: amount * multiplier };
  }

  const max = /^max\((.*)\)$/i.exec(normalized);
  if (max) {
    const terms = splitOutsideParentheses(max[1], ",");
    if (terms.length === 0) return { resolved: false, reason: "max() has no arguments" };
    const proofs = terms.map(lengthLowerBound);
    const safe = proofs.find((proof) => proof.resolved && proof.px >= FLOOR_PX);
    if (safe?.resolved) return safe;
    const unresolved = proofs.find((proof) => !proof.resolved);
    if (unresolved && !unresolved.resolved) {
      return {
        resolved: false,
        reason: `max() has no 16px floor; ${unresolved.reason}`,
      };
    }
    return {
      resolved: true,
      px: Math.max(...proofs.flatMap((proof) => (proof.resolved ? [proof.px] : []))),
    };
  }

  const clamp = /^clamp\((.*)\)$/i.exec(normalized);
  if (clamp) {
    const terms = splitOutsideParentheses(clamp[1], ",");
    if (terms.length !== 3) {
      return { resolved: false, reason: "clamp() must have three arguments" };
    }
    const minimum = lengthLowerBound(terms[0]);
    if (!minimum.resolved) {
      return { resolved: false, reason: `clamp() minimum is unresolved: ${minimum.reason}` };
    }
    return minimum;
  }

  return { resolved: false, reason: `${normalized || "empty value"} has no provable lower bound` };
}

function importantControlConflicts(css: string, file: string): ImportantControlConflict[] {
  return parseCssRules(css).flatMap((rule) => {
    const fontSizes = rule.declarations.filter((candidate) => candidate.property === "font-size");
    const important = fontSizes.filter((candidate) => candidate.important);
    const declaration = (important.length > 0 ? important : fontSizes).at(-1);
    if (!declaration?.important) return [];

    const proof = lengthLowerBound(declaration.value);
    if (proof.resolved && proof.px >= FLOOR_PX) return [];
    const reason = proof.resolved
      ? `lower bound ${Number(proof.px.toFixed(4))}px is below ${FLOOR_PX}px`
      : `could not prove ${FLOOR_PX}px lower bound: ${proof.reason}`;
    return rule.selectors
      .filter(selectorTargetsControl)
      .map((selector) => ({ file, selector, value: declaration.value, reason }));
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

  it.each([
    [".75rem !important", true],
    ["+16px   !IMPORTANT", false],
    ["16px !important", false],
    ["max(16px, 1em) !important", false],
    ["max(12px, 1em) !important", true],
    ["clamp(14px, 2vw, 20px) !important", true],
    ["var(--x) !important", true],
    ["11pt !important", true],
    ["12pt !important", false],
    ["1em !important", true],
    ["-16px !important", true],
    ["0.9rem", false],
  ])("evaluates control font-size %s", (declaration, refused) => {
    const css = `.field input { font-size: ${declaration}; }`;
    const conflicts = importantControlConflicts(css, "fixture.css");
    expect(conflicts.length).toBe(refused ? 1 : 0);
    if (refused) expect(conflicts[0]).toMatchObject({ reason: expect.any(String) });
  });

  it.each([
    [".field :is(input)", true],
    [":where(.a, textarea)", true],
    ["form:has(select)", true],
    [".x:not(.y) input", true],
    [":matches(.group, :is(textarea))", true],
    [".input-wrap", false],
    ["#select-all", false],
    ['[data-role="input"]', false],
    [".textarea-note", false],
  ])("recognizes control type selectors in %s", (selector, refused) => {
    const css = `${selector} { font-size: 12px !important; }`;
    expect(importantControlConflicts(css, "fixture.css")).toHaveLength(refused ? 1 : 0);
  });

  it("uses the last important font-size declaration in a rule", () => {
    const unsafe = `.field input {
      font-size: 16px !important;
      font-size: 15px !important;
    }`;
    const safe = `.field input {
      font-size: 15px !important;
      font-size: max(16px, 1em) !important;
    }`;
    expect(importantControlConflicts(unsafe, "unsafe.css")).toHaveLength(1);
    expect(importantControlConflicts(safe, "safe.css")).toHaveLength(0);
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
        .map(
          ({ file, selector, value, reason }) =>
            `${file}: ${selector} -> ${value} !important; ${reason}`,
        )
        .join("\n"),
    ).toEqual([]);
  });
});
