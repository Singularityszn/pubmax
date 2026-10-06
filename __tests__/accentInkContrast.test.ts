import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

// ─────────────────────────────────────────────────────────────────────────────
// A HUE AS A WORD  (docs/DESIGN_SYSTEM.md · "Launch tokens", "Colour")
//
// The captain's audit (J37, section 5.5) asked whether the essential journeys
// work with a screen reader. The first sweep found the SAME defect on six
// surfaces at once: --brass, the accent, used as TEXT on a light surface. It
// reads 2.5:1 to 2.9:1 there, so the kicker, the city chooser's controls and
// two quiet links were all below AA in light and passed only in dark.
//
// --brass-ink is the fix for the ELEVATION LADDER and it is light-only,
// because dark already clears AA with the one coral. --tint-ink-* is the fix
// for the second shape the 17 September 2026 sweep measured: a hue printed as
// a word on a 7 to 20 per cent TINT of that same hue, which no ladder ink is
// tuned for (`--brass-ink` on a 12 per cent coral tint of the recessed panel
// is 4.25:1). /pubs shipped 24 source badges at 3.75:1 that way, the only axe
// finding in the whole sweep.
//
// This file holds four things:
//   1. the shipped token values, so a palette retune cannot silently drop
//      below AA;
//   2. the LIGHT ladder, every step of it, since the recessed panel is the
//      worst case and the one an eyeballed check misses;
//   3. a SWEEP over every stylesheet in app/** and components/**, resolving
//      each block's own color-over-background pair in both themes: no hue may
//      be a word on a tint of itself, and no raw accent may be a word on a
//      step of the ladder;
//   4. the surfaces the original audit fixed, pinned so they cannot drift
//      back.
//
// What the sweep deliberately CANNOT see, so nobody reads it as more than it
// is: a block that declares no background of its own (the ink lands on
// whatever ancestor paints, which CSS alone does not say), and a translucent
// fill (`color-mix(..., transparent)`, `rgba()`) whose composite depends on
// the same unknown ancestor. Those stay with the rendered fences,
// `e2e/a11y-core-journeys.spec.ts` and `e2e/a11y-keyboard-loop.spec.ts`.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

/** WCAG 2.1 AA for text under 18.66px bold / 24px regular. */
const AA_SMALL_TEXT = 4.5;

type Rgb = readonly [number, number, number];

function channels(hex: string): Rgb | null {
  let value = hex.replace("#", "");
  if (value.length === 3) {
    value = value
      .split("")
      .map((channel) => channel + channel)
      .join("");
  }
  if (value.length === 8) value = value.slice(0, 6);
  if (value.length !== 6) return null;
  const parsed = [0, 2, 4].map((index) =>
    Number.parseInt(value.slice(index, index + 2), 16),
  );
  return parsed.some(Number.isNaN) ? null : [defined(parsed[0]), defined(parsed[1]), defined(parsed[2])];
}

function hexOf(colour: Rgb): string {
  return `#${colour
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Hue in degrees, the axis the price band and the accent are held apart on. */
function hueOf(colour: Rgb): number {
  const [red, green, blue] = colour.map((channel) => channel / 255);
  const high = Math.max(defined(red), defined(green), defined(blue));
  const low = Math.min(defined(red), defined(green), defined(blue));
  const span = high - low;
  if (span === 0) return 0;
  const sextant =
    high === red
      ? (defined(green) - defined(blue)) / span
      : high === green
        ? (defined(blue) - defined(red)) / span + 2
        : (defined(red) - defined(green)) / span + 4;
  return ((sextant * 60) % 360 + 360) % 360;
}

/** The smaller of the two ways round the wheel, in degrees. */
function hueGap(first: Rgb, second: Rgb): number {
  const raw = Math.abs(hueOf(first) - hueOf(second));
  return Math.min(raw, 360 - raw);
}

function relativeLuminance(colour: Rgb): number {
  const [red, green, blue] = colour.map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * defined(red) + 0.7152 * defined(green) + 0.0722 * defined(blue);
}

function contrast(foreground: Rgb, background: Rgb): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function ratio(foreground: string, background: string): number {
  const first = channels(foreground);
  const second = channels(background);
  expect(first, `${foreground} is a hex colour`).not.toBeNull();
  expect(second, `${background} is a hex colour`).not.toBeNull();
  return contrast(first as Rgb, second as Rgb);
}

/** The value a token holds in the given sheet, read from its own declaration. */
function tokenValue(css: string, token: string): string {
  const match = css.match(
    new RegExp(`^\\s*${token}\\s*:\\s*(#[0-9a-f]{3,8})\\s*;`, "im"),
  );
  expect(match, `${token} is declared with a literal hex`).not.toBeNull();
  return defined((match as RegExpMatchArray)[1]);
}

// ── The theme a declaration is read against ──────────────────────────────────
// A token map per theme, so a `var()` in any stylesheet resolves to the value
// the browser would compute. Light is :root plus the `body` remap, which is
// what DOM text is really read against (the map keeps the :root values for
// --paper and --panel-raised). Dark is that map with the theme block over it.

const GLOBALS = read("app/globals.css");
const THEME = read("app/theme.css");

function declarationsIn(block: string): Array<[string, string]> {
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)].map((match) => [
    defined(match[1]),
    defined(match[2]).trim(),
  ]);
}

/**
 * Apply one rule's custom properties over the map, and refuse a rule that
 * matched nothing or carried no token: a remap this file reads by selector is
 * a moving target, and a silently empty match makes the whole sweep measure
 * the wrong surface while still passing.
 */
function applyRule(
  css: string,
  selector: RegExp,
  label: string,
  tokens: Map<string, string>,
): void {
  const rule = css.match(selector);
  expect(rule, label).not.toBeNull();
  const declared = declarationsIn(defined((rule as RegExpMatchArray)[1]));
  expect(declared.length, `${label} declares custom properties`).toBeGreaterThan(0);
  for (const [name, value] of declared) tokens.set(name, value);
}

function themeTokens(theme: "light" | "dark"): Map<string, string> {
  const tokens = new Map<string, string>();
  // First declaration wins, which is :root's, before any narrower block
  // retunes it for a legacy or chrome surface.
  for (const [name, value] of declarationsIn(GLOBALS)) {
    if (!tokens.has(name)) tokens.set(name, value);
  }
  // THE DOM IS NOT THE BASEMAP, and that remap is the whole reason to read a
  // rule here rather than stop at :root. --paper, --panel-raised and --line
  // keep their :root values so the WebGL map reads them unchanged at
  // documentElement; every DOM surface is painted by the `body` remap under
  // them. The selector is the REMAP's and not a bare `body`, because
  // globals.css declares a plain `body { margin: 0; ... }` first which carries
  // no token at all: matching that one read the page as #faf8f5 instead of the
  // deepened #f8f2ec it really paints, and called every light ratio in this
  // file higher than it ships.
  if (theme === "light") {
    applyRule(
      GLOBALS,
      /html:not\(\[data-theme="dark"\]\)\s+body\s*\{([\s\S]*?)\n\}/,
      "app/globals.css has the light DOM surface remap",
      tokens,
    );
    return tokens;
  }
  applyRule(
    THEME,
    /html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/,
    "app/theme.css has an html[data-theme=dark] rule",
    tokens,
  );
  applyRule(
    THEME,
    /html\[data-theme="dark"\]\s+body\s*\{([\s\S]*?)\n\}/,
    "app/theme.css has the dark DOM surface remap",
    tokens,
  );
  return tokens;
}

const THEMES = [
  ["light", themeTokens("light")],
  ["dark", themeTokens("dark")],
] as const;

// ── color-mix() and var() arithmetic ─────────────────────────────────────────
// A resolved colour carries the palette tokens it was DERIVED from and each
// one's share of the result, which is how "a hue on a tint of itself" is
// decided mechanically rather than by reading selector names.

interface Resolved {
  readonly rgb: Rgb;
  /** Palette token → its share of this colour, 0 to 1. */
  readonly share: ReadonlyMap<string, number>;
}

/** Split on top-level commas, so a nested `color-mix()` stays in one piece. */
function splitArguments(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of input) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function resolveColour(
  value: string,
  tokens: Map<string, string>,
  depth = 0,
): Resolved | null {
  if (depth > 12) return null;
  const input = value.trim();
  if (input.startsWith("#")) {
    const rgb = channels(input);
    return rgb ? { rgb, share: new Map() } : null;
  }
  if (input === "white") return { rgb: [255, 255, 255], share: new Map() };
  if (input === "black") return { rgb: [0, 0, 0], share: new Map() };

  const reference = input.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]+))?\)$/i);
  if (reference) {
    const declared = tokens.get(defined(reference[1]));
    const inner = declared
      ? resolveColour(declared, tokens, depth + 1)
      : reference[2]
        ? resolveColour(reference[2], tokens, depth + 1)
        : null;
    if (!inner) return null;
    const share = new Map(inner.share);
    share.set(defined(reference[1]), 1);
    return { rgb: inner.rgb, share };
  }

  const mix = input.match(/^color-mix\(\s*in\s+srgb\s*,([\s\S]+)\)$/i);
  if (mix) {
    const parts = splitArguments(defined(mix[1]));
    if (parts.length !== 2) return null;
    const split = (part: string) => {
      const percentage = part.match(/(-?[\d.]+)%\s*$/);
      return {
        colour: percentage
          ? part.slice(0, part.length - percentage[0].length).trim()
          : part.trim(),
        weight: percentage ? Number.parseFloat(defined(percentage[1])) : null,
      };
    };
    const first = split(defined(parts[0]));
    const second = split(defined(parts[1]));
    let firstWeight = first.weight;
    let secondWeight = second.weight;
    if (firstWeight === null && secondWeight === null) {
      firstWeight = 50;
      secondWeight = 50;
    } else if (firstWeight === null) firstWeight = 100 - (secondWeight as number);
    else if (secondWeight === null) secondWeight = 100 - firstWeight;
    const total = firstWeight + (secondWeight as number);
    if (total <= 0) return null;
    // `transparent` composites over an ancestor this file cannot see.
    const left = resolveColour(first.colour, tokens, depth + 1);
    const right = resolveColour(second.colour, tokens, depth + 1);
    if (!left || !right) return null;
    const rgb = [0, 1, 2].map(
      (index) =>
        (defined(left.rgb[index]) * (firstWeight as number) +
          defined(right.rgb[index]) * (secondWeight as number)) /
        total,
    ) as unknown as Rgb;
    const share = new Map<string, number>();
    for (const [token, weight] of left.share) {
      share.set(token, (share.get(token) ?? 0) + (weight * firstWeight) / total);
    }
    for (const [token, weight] of right.share) {
      share.set(
        token,
        (share.get(token) ?? 0) + (weight * (secondWeight as number)) / total,
      );
    }
    return { rgb, share };
  }
  return null;
}

// ── The sweep's own corpus ───────────────────────────────────────────────────

function stylesheets(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, directory))) {
    const relative = `${directory}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) stylesheets(relative, found);
    else if (entry.endsWith(".css")) found.push(relative);
  }
  return found;
}

interface Pair {
  readonly file: string;
  readonly selector: string;
  readonly foreground: string;
  readonly background: string;
}

/**
 * Every rule that paints BOTH a colour and a flat background. The pattern
 * matches innermost blocks, so a rule inside a media query is read the same
 * way as one at the top level; the selector is its own last line.
 */
function paintedPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const file of SHEETS) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = defined(block[2]);
      const foreground = body.match(/(?:^|[;\s])color\s*:\s*([^;]+)/);
      const background = body.match(/(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/);
      if (!foreground || !background) continue;
      pairs.push({
        file,
        selector: defined(block[1]).trim().split("\n").pop()?.trim() ?? "",
        foreground: defined(foreground[1]).trim(),
        background: defined(background[1]).trim(),
      });
    }
  }
  return pairs;
}

const SHEETS = [...stylesheets("app"), ...stylesheets("components")].filter(
  (file) => file !== "app/globals.css" && file !== "app/theme.css",
);
const PAINTED_PAIRS = paintedPairs();

/** The semantic hues a surface may mean something with, and their tint inks. */
const HUE_TINT_INKS = {
  "--brass": "--tint-ink-accent",
  "--pint": "--tint-ink-positive",
  "--amber": "--tint-ink-caution",
  "--brick": "--tint-ink-negative",
  "--river": "--tint-ink-info",
} as const;

/**
 * Every token that counts as CARRYING a hue. Four of the five are the palette
 * token alone; the accent also owns --brass-ink, its deepened warm, because a
 * coral word is that token by law and the tint ink is derived from it rather
 * than from raw --brass. Without this the accent's tint ink would read as
 * "derived from nothing" and drop out of the sweep below entirely.
 */
const HUE_FAMILY: Record<string, readonly string[]> = {
  "--brass": ["--brass", "--brass-ink"],
  "--pint": ["--pint"],
  "--amber": ["--amber"],
  "--brick": ["--brick"],
  "--river": ["--river"],
};

/** How much of this colour is the named hue, counting the hue's own family. */
function hueShare(colour: Resolved, hue: string): number {
  return Math.max(...defined(HUE_FAMILY[hue]).map((token) => colour.share.get(token) ?? 0));
}

/**
 * The elevation ladder, read out of the theme's own token map rather than
 * restated as four hexes here, so a retune of a surface cannot leave this file
 * measuring a colour the app stopped painting. ALL FOUR STEPS: the overlay is
 * the brightest light surface and the palest dark one, and it is what a sheet,
 * a popover and a menu paint, so leaving it out left the token row's own claim
 * ("the worst pair is a 20 per cent tint on the recessed panel in light, on
 * the overlay in dark") unmeasured in exactly the place it names.
 */
function ladder(tokens: Map<string, string>): Record<string, string> {
  const steps: ReadonlyArray<readonly [string, string]> = [
    ["--paper (page)", "--paper"],
    ["--panel (recessed well)", "--panel"],
    ["--panel-raised (card)", "--panel-raised"],
    ["--panel-overlay (sheet)", "--panel-overlay"],
  ];
  const resolved: Record<string, string> = {};
  for (const [label, token] of steps) {
    const colour = resolveColour(`var(${token})`, tokens);
    expect(colour, `${token} resolves to a colour`).not.toBeNull();
    resolved[label] = hexOf((colour as Resolved).rgb);
  }
  return resolved;
}

const LIGHT_LADDER = ladder(THEMES[0][1]);
const DARK_LADDER = ladder(THEMES[1][1]);

describe("the accent as ink", () => {
  it("declares --brass-ink in both themes", () => {
    expect(GLOBALS).toMatch(/--brass-ink\s*:/);
    expect(THEME).toMatch(/--brass-ink\s*:/);
    expect(GLOBALS).toMatch(/--color-accent-ink\s*:\s*var\(--brass-ink\)/);
  });

  it("clears AA as small text on every step of the LIGHT ladder", () => {
    const ink = tokenValue(GLOBALS, "--brass-ink");
    for (const [name, surface] of Object.entries(LIGHT_LADDER)) {
      const measured = ratio(ink, surface);
      expect(
        measured,
        `${ink} on ${name} (${surface}) is ${measured.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it("keeps the one coral in dark, where it already clears AA", () => {
    const darkInk = tokenValue(THEME, "--brass-ink");
    const darkBrass = tokenValue(THEME, "--brass");
    expect(darkInk, "dark deepens nothing: one coral").toBe(darkBrass);
    for (const [name, surface] of Object.entries(DARK_LADDER)) {
      const measured = ratio(darkInk, surface);
      expect(
        measured,
        `${darkInk} on ${name} (${surface}) is ${measured.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it("records why --brass itself may not be the ink", () => {
    // The measurement this whole token exists for. If a palette change ever
    // makes light --brass legible as small text, this fails and the token can
    // be retired rather than carried for ever.
    const brass = tokenValue(GLOBALS, "--brass");
    const worst = Math.min(
      ...Object.values(LIGHT_LADDER).map((surface) => ratio(brass, surface)),
    );
    expect(worst).toBeLessThan(AA_SMALL_TEXT);
  });

  it("is not the price band's crimson", () => {
    // A PRICE WEARS ITS BAND AND NO OTHER COLOUR (captain's law 2026-09-05).
    // A kicker in --brick would say "expensive"; these two stay apart.
    expect(tokenValue(GLOBALS, "--brass-ink")).not.toBe(tokenValue(GLOBALS, "--brick"));
  });

  it("leaves the login-only deepened coral alone", () => {
    // --brass-accessible is a coral FILL carrying a WHITE label, which is a
    // different question from a coral WORD on paper. Repointing one at the
    // other would put a 4.1:1 ink on the page.
    expect(tokenValue(GLOBALS, "--brass-ink")).not.toBe(
      tokenValue(GLOBALS, "--brass-accessible"),
    );
  });
});

describe("a hue on a tint of itself", () => {
  // The worst pair anywhere in the tree: the deepest tint any surface paints
  // (20 per cent, the Tonight lane's active chip) on every step of the ladder.
  const WORST_TINT = 20;

  it.each(THEMES)("%s: every tint ink clears AA over its own hue's tint", (name, tokens) => {
    const ladder = name === "light" ? LIGHT_LADDER : DARK_LADDER;
    for (const [hue, inkToken] of Object.entries(HUE_TINT_INKS)) {
      const ink = resolveColour(`var(${inkToken})`, tokens);
      expect(ink, `${inkToken} resolves in ${name}`).not.toBeNull();
      for (const [surfaceName, surface] of Object.entries(ladder)) {
        const tint = resolveColour(
          `color-mix(in srgb, var(${hue}) ${WORST_TINT}%, ${surface})`,
          tokens,
        );
        expect(tint, `a ${hue} tint resolves in ${name}`).not.toBeNull();
        const measured = contrast(
          (ink as Resolved).rgb,
          (tint as Resolved).rgb,
        );
        expect(
          measured,
          `${inkToken} on a ${WORST_TINT}% ${hue} tint of ${surfaceName} is ${measured.toFixed(2)}:1 in ${name}`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    }
  });

  it("holds a tint ink to the hue it is the ink for", () => {
    // A tint ink is the HUE deepened, not a neutral: if it stopped carrying
    // its own hue the badge would stop meaning anything, and the derivation
    // could be replaced by --color-text without anybody noticing.
    for (const [hue, inkToken] of Object.entries(HUE_TINT_INKS)) {
      for (const [, tokens] of THEMES) {
        const ink = resolveColour(`var(${inkToken})`, tokens);
        expect(ink, `${inkToken} resolves`).not.toBeNull();
        expect(
          hueShare(ink as Resolved, hue),
          `${inkToken} is derived from ${hue} or its own ink`,
        ).toBeGreaterThan(0.3);
      }
    }
  });

  it("keeps the accent's tint ink off the price band's hue in LIGHT", () => {
    // A PRICE WEARS ITS BAND AND NO OTHER COLOUR (captain's law 2026-09-05),
    // which is why --brass-ink is warmed to hue 12 against --brick's 356 and
    // is deliberately not the crimson (components/AGENTS.md). A tint ink mixed
    // straight off raw --brass lands on hue 357 - brick's own hue - so 24
    // chain-source badges and the Pint Index pill would have printed in the
    // colour the expensive band owns. The accent's tint ink is derived from
    // --brass-ink for exactly this reason, and this is what holds it there.
    // LIGHT ONLY, and deliberately so: the DARK palette already separates the
    // two by chroma and lightness rather than by hue (a full-chroma #ff5a5f
    // coral against a muted #d47a82 rose, 4.3 degrees apart on the wheel), and
    // __tests__/mapPinBandContrast.test.ts is what holds that pair apart.
    const [, tokens] = THEMES[0];
    const accentInk = resolveColour("var(--tint-ink-accent)", tokens);
    expect(accentInk, "--tint-ink-accent resolves in light").not.toBeNull();
    for (const crimson of ["--brick", "--tint-ink-negative", "--price-band-expensive-ink"]) {
      const other = resolveColour(`var(${crimson})`, tokens);
      expect(other, `${crimson} resolves in light`).not.toBeNull();
      const gap = hueGap((accentInk as Resolved).rgb, (other as Resolved).rgb);
      expect(
        gap,
        `--tint-ink-accent is ${gap.toFixed(1)} degrees from ${crimson} in light`,
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it("sweeps a corpus large enough to mean something", () => {
    // A sweep that resolved nothing would pass silently for ever, so the
    // corpus itself is asserted: every stylesheet under app/** and
    // components/**, and the pairs inside them that resolve to two colours.
    expect(SHEETS.length, "stylesheets walked").toBeGreaterThan(150);
    const resolvable = PAINTED_PAIRS.filter(({ foreground, background }) => {
      const tokens = THEMES[0][1];
      return (
        resolveColour(foreground, tokens) !== null &&
        resolveColour(background, tokens) !== null
      );
    });
    expect(resolvable.length, "colour-over-background pairs resolved").toBeGreaterThan(200);
  });

  it("finds no hue printed as a word on a tint of itself below AA", () => {
    const offences: string[] = [];
    for (const [name, tokens] of THEMES) {
      for (const pair of PAINTED_PAIRS) {
        const foreground = resolveColour(pair.foreground, tokens);
        const background = resolveColour(pair.background, tokens);
        if (!foreground || !background) continue;
        for (const hue of Object.keys(HUE_TINT_INKS)) {
          const tint = background.share.get(hue) ?? 0;
          // A minority share is a TINT; a majority share is a painted fill,
          // which is the other law (--color-on-accent) and another lane.
          if (tint <= 0 || tint > 0.5) continue;
          if (hueShare(foreground, hue) <= 0) continue;
          const measured = contrast(foreground.rgb, background.rgb);
          if (measured >= AA_SMALL_TEXT) continue;
          offences.push(
            `${pair.file} ${pair.selector} in ${name}: ${measured.toFixed(2)}:1 ` +
              `(${pair.foreground} on a ${(tint * 100).toFixed(0)}% ${hue} tint) ` +
              `- take var(${HUE_TINT_INKS[hue as keyof typeof HUE_TINT_INKS]})`,
          );
        }
      }
    }
    expect(offences, "a hue is never text on a tint of itself").toEqual([]);
  });
});

describe("no surface puts the raw accent back on a light word", () => {
  it("finds no raw accent printed on a step of the elevation ladder", () => {
    const LADDER = ["--paper", "--panel", "--panel-raised", "--panel-overlay"];
    const offences: string[] = [];
    for (const [name, tokens] of THEMES) {
      for (const pair of PAINTED_PAIRS) {
        const foreground = resolveColour(pair.foreground, tokens);
        const background = resolveColour(pair.background, tokens);
        if (!foreground || !background) continue;
        // The accent as a WORD: the foreground IS the raw coral, and the
        // background is a bare ladder surface rather than a tint of anything.
        if ((foreground.share.get("--brass") ?? 0) < 1) continue;
        if ((foreground.share.get("--brass-ink") ?? 0) > 0) continue;
        if (!LADDER.some((surface) => (background.share.get(surface) ?? 0) >= 1)) continue;
        const measured = contrast(foreground.rgb, background.rgb);
        if (measured >= AA_SMALL_TEXT) continue;
        offences.push(
          `${pair.file} ${pair.selector} in ${name}: ${measured.toFixed(2)}:1 ` +
            `(${pair.foreground} on ${pair.background}) - take var(--color-accent-ink)`,
        );
      }
    }
    expect(offences, "coral is a fill; coral as a word takes --color-accent-ink").toEqual(
      [],
    );
  });

  // The surfaces the original audit found and fixed. Each is held to the INK
  // rather than to a hex, so a retune moves them together. The sweeps above
  // cannot see these: none of them paints a background of its own, so the
  // surface their ink lands on is an ancestor's decision.
  const HOLD_TO_INK: ReadonlyArray<readonly [file: string, selector: string]> = [
    ["components/ui/kicker.css", ".kicker {"],
    ["components/map/venueOccupancy.css", ".venueOccupancySignIn a {"],
    ["components/plan/nightCrawl.css", ".nightCrawl__enterKicker {"],
  ];

  for (const [file, selector] of HOLD_TO_INK) {
    it(`${selector.replace(" {", "")} takes the accent's ink`, () => {
      const css = read(file);
      const start = css.indexOf(selector);
      expect(start, `${selector} still exists in ${file}`).toBeGreaterThan(-1);
      const block = css.slice(start);
      const declaration = block.slice(0, block.indexOf("}"));
      // The accent's ink, or the page's own ink: either is a word that is
      // not the raw coral.
      expect(
        declaration,
        `${selector} in ${file} paints its text with var(--color-accent-ink) or var(--color-text)`,
      ).toMatch(/color:\s*var\(--color-(?:accent-ink|text)\)/);
    });
  }

  it("the price door's own accent is untouched", () => {
    // The door is a FILL and keeps the coral it always had: this change is
    // about words, and turning a painted primary into ink would be a
    // different decision (AGENTS.md, the overview price door).
    expect(GLOBALS).toMatch(/--color-accent\s*:\s*var\(--brass\)/);
  });
});
