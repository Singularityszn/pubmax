// Token debt only goes down (taste plan, 18 Oct 2026, change 6).
//
// The audit counted 170 font sizes against a scale of nine, 90 corners
// against a scale of four and 138 shadows against six. A raw figure is how a
// screen drifts from the rest: it does not follow the theme, and a raw rem
// does not grow when a reader picks large text, where every --text-* token
// does (app/globals.css, html[data-text-scale="large"]).
//
// Three things are pinned:
//   1. A bare var() names a token that exists. An undefined token is not a
//      quiet default: inside a `font:` shorthand it voids the whole
//      declaration, which is how two map chip rows lost their size and weight.
//   2. The corner scale has four sizes. 14px is not one of them.
//   3. Each kind of raw figure has a ceiling at the measured count. Lower the
//      ceiling in the commit that pays some down; never raise it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function files(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full, test));
    else if (test(name)) out.push(full);
  }
  return out;
}

const CSS = ["app", "components"].flatMap((d) => files(join(ROOT, d), (n) => n.endsWith(".css")));
const SOURCES = ["app", "components", "lib"].flatMap((d) =>
  files(join(ROOT, d), (n) => /\.(?:tsx?|mjs)$/.test(n) && !n.endsWith(".d.ts")),
);

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const sheets = CSS.map((file) => ({ file: relative(ROOT, file), css: stripComments(readFileSync(file, "utf8")) }));

function count(pattern: RegExp): number {
  return sheets.reduce((sum, { css }) => sum + (css.match(pattern)?.length ?? 0), 0);
}

describe("token debt", () => {
  it("names only tokens that exist in a bare var()", () => {
    const declared = new Set<string>();
    for (const { css } of sheets) for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) if (m[1]) declared.add(m[1]);
    // A token a component sets from script (style={{ "--x": ... }}) is declared there.
    const script = SOURCES.map((file) => readFileSync(file, "utf8")).join("\n");

    const undefinedTokens: string[] = [];
    for (const { file, css } of sheets) {
      for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        const token = m[1];
        if (token && !declared.has(token) && !script.includes(token)) undefinedTokens.push(`${file} :: ${token}`);
      }
    }
    expect([...new Set(undefinedTokens)].sort()).toEqual([]);
  });

  it("keeps the corner scale to four sizes, with no 14px step", () => {
    const fourteen = sheets
      .filter(({ css }) => /border-radius:[^;]*\b14px|--(?:control|topbar|map-chrome)-radius:\s*14px/.test(css))
      .map(({ file }) => file);
    expect(fourteen).toEqual([]);
  });

  // Measured on 18 Oct 2026 after the first snap: 1,022 font sizes within 5% of
  // a step, 492 corners and 978 dead fallbacks went to tokens.
  const CEILINGS = {
    "raw font sizes": { pattern: /font-size:\s*[0-9.]+(?:px|rem)\b/g, max: 484 },
    "raw corners": { pattern: /border-radius:\s*(?!0[\s;])[0-9.]+(?:px|rem)\b/g, max: 30 },
    "raw shadows": { pattern: /box-shadow:\s*(?:inset\s+)?-?[0-9]/g, max: 136 },
    "var() fallbacks": { pattern: /var\(--[\w-]+\s*,/g, max: 291 },
  } as const;

  for (const [name, { pattern, max }] of Object.entries(CEILINGS)) {
    it(`holds ${name} at or under ${max}`, () => {
      expect(count(pattern)).toBeLessThanOrEqual(max);
    });
  }
});
