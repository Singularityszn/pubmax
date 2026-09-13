import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// CORAL AS A WORD  (docs/DESIGN_SYSTEM.md · "Launch tokens")
//
// The captain's audit (J37, section 5.5) asked whether the essential journeys
// work with a screen reader. The first sweep found the SAME defect on six
// surfaces at once: --brass, the accent, used as TEXT on a light surface. It
// reads 2.5:1 to 2.9:1 there, so the kicker, the city chooser's controls and
// two quiet links were all below AA in light and passed only in dark.
//
// --brass-ink is the fix and it is light-only, because dark already clears AA
// with the one coral. This file holds three things:
//   1. the shipped values, so a palette retune cannot silently drop below AA;
//   2. the LIGHT ladder, every step of it, since the recessed panel is the
//      worst case and the one an eyeballed check misses;
//   3. a sweep, so a coral is not put back on a light word by hand.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

/** WCAG 2.1 AA for text under 18.66px bold / 24px regular. */
const AA_SMALL_TEXT = 4.5;

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const parsed = [0, 2, 4].map((index) =>
    Number.parseInt(value.slice(index, index + 2), 16),
  );
  return [parsed[0], parsed[1], parsed[2]];
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The value a token holds in the given sheet, read from its own declaration. */
function tokenValue(css: string, token: string): string {
  const match = css.match(
    new RegExp(`^\\s*${token}\\s*:\\s*(#[0-9a-f]{3,8})\\s*;`, "im"),
  );
  expect(match, `${token} is declared with a literal hex`).not.toBeNull();
  return (match as RegExpMatchArray)[1];
}

describe("the accent as ink", () => {
  const globals = read("app/globals.css");
  const theme = read("app/theme.css");

  // The light elevation ladder as the DOM paints it. --paper and
  // --panel-raised are remapped for the DOM at the body rule (globals.css),
  // because the map keeps the :root values; these are the DOM ones, which is
  // what text is actually read against.
  const LIGHT_LADDER = {
    "--paper (page)": "#f8f2ec",
    "--panel (recessed well)": "#eee7df",
    "--panel-raised (card)": "#fdf9f4",
  } as const;

  const DARK_LADDER = {
    "--paper": "#0a0a0b",
    "--panel": "#141416",
    "--panel-raised": "#202024",
  } as const;

  it("declares --brass-ink in both themes", () => {
    expect(globals).toMatch(/--brass-ink\s*:/);
    expect(theme).toMatch(/--brass-ink\s*:/);
    expect(globals).toMatch(/--color-accent-ink\s*:\s*var\(--brass-ink\)/);
  });

  it("clears AA as small text on every step of the LIGHT ladder", () => {
    const ink = tokenValue(globals, "--brass-ink");
    for (const [name, surface] of Object.entries(LIGHT_LADDER)) {
      const ratio = contrastRatio(ink, surface);
      expect(
        ratio,
        `${ink} on ${name} (${surface}) is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it("keeps the one coral in dark, where it already clears AA", () => {
    const darkInk = tokenValue(theme, "--brass-ink");
    const darkBrass = tokenValue(theme, "--brass");
    expect(darkInk, "dark deepens nothing: one coral").toBe(darkBrass);
    for (const [name, surface] of Object.entries(DARK_LADDER)) {
      const ratio = contrastRatio(darkInk, surface);
      expect(
        ratio,
        `${darkInk} on ${name} (${surface}) is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it("records why --brass itself may not be the ink", () => {
    // The measurement this whole token exists for. If a palette change ever
    // makes light --brass legible as small text, this fails and the token can
    // be retired rather than carried for ever.
    const brass = tokenValue(globals, "--brass");
    const worst = Math.min(
      ...Object.values(LIGHT_LADDER).map((surface) => contrastRatio(brass, surface)),
    );
    expect(worst).toBeLessThan(AA_SMALL_TEXT);
  });

  it("is not the price band's crimson", () => {
    // A PRICE WEARS ITS BAND AND NO OTHER COLOUR (captain's law 2026-09-05).
    // A kicker in --brick would say "expensive"; these two stay apart.
    expect(tokenValue(globals, "--brass-ink")).not.toBe(
      tokenValue(globals, "--brick"),
    );
  });

  it("leaves the login-only deepened coral alone", () => {
    // --brass-accessible is a coral FILL carrying a WHITE label, which is a
    // different question from a coral WORD on paper. Repointing one at the
    // other would put a 4.1:1 ink on the page.
    expect(tokenValue(globals, "--brass-ink")).not.toBe(
      tokenValue(globals, "--brass-accessible"),
    );
  });
});

describe("no surface puts the raw coral back on a light word", () => {
  // The surfaces the audit found and fixed. Each is held to the INK rather
  // than to a hex, so a retune moves them together.
  const HOLD_TO_INK: ReadonlyArray<readonly [file: string, selector: string]> = [
    ["components/ui/kicker.css", ".kicker {"],
    ["components/city/cityChooser.css", ".cityChooser--section .cityChooserLocate {"],
    [
      "components/city/cityChooser.css",
      ".cityChooser--section .cityChooserReleaseBadge {",
    ],
    ["components/map/venueOccupancy.css", ".venueOccupancySignIn a {"],
    ["components/plan/nightCrawl.css", ".nightCrawl__enterKicker {"],
    // The 13 Sep site audit (D13) measured ten coral words on /tonight in
    // light at 2.9:1: every source credit and every "Open on map". The same
    // sweep of the lane's own sheets found the Out pub-pair label and three
    // coral words on /historic.
    ["app/tonight/tonightLede.css", ".tonightHypedSource {"],
    ["app/tonight/tonightLede.css", ".tonightChainRowMap {"],
    ["app/out/out.css", ".outListingPubPairLabel {"],
    ["app/historic/historic.css", ".historicPagination a {"],
    ["app/historic/historic.css", ".historicEra {"],
    ["app/historic/historic.css", ".historicBoroughLink {"],
  ];

  for (const [file, selector] of HOLD_TO_INK) {
    it(`${selector.replace(" {", "")} takes the accent's ink`, () => {
      const css = read(file);
      const start = css.indexOf(selector);
      expect(start, `${selector} still exists in ${file}`).toBeGreaterThan(-1);
      const block = css.slice(start);
      const declaration = block.slice(0, block.indexOf("}"));
      // The accent's ink, or the page's own ink: either is a word that is
      // not the raw coral. The city chooser's locate control moved to the
      // plain pill the landing answer card wears, whose label is --color-text.
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
    expect(read("app/globals.css")).toMatch(/--color-accent\s*:\s*var\(--brass\)/);
  });
});
