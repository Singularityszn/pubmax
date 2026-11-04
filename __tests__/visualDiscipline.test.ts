import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// VISUAL DISCIPLINE (docs/DESIGN_SYSTEM.md "Launch tokens" > "Coral is spent
// twice" and "Monospace is for figures"; rule:
// docs/rules/components-design-system-and-launch-primitives.md).
//
// Two laws, both read off the shipped stylesheets so a token retune or a new
// surface re-runs them:
//   1. A coral FILL is the one primary action per screen (the floating create
//      disc, its second spend, retired on 1 Nov 2026). A selection (active
//      tab, pressed chip, chosen segment, the
//      page you are on) reads through --state-selected-*, a suggestion chip is
//      a neutral outline, and a kicker or eyebrow is muted ink.
//   2. The data face (--font-data, JetBrains Mono) sets figures alone. A label,
//      a kicker, a footer, the legal line, a nav row and a word chip are set in
//      the UI sans.
// A focus ring is an affordance rather than a resting mark, so an `outline`
// may keep the accent everywhere.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const CORAL = /var\(--(?:brass|color-accent|accent-action|tint-ink-accent)[\w-]*[,)]|#ff5a5f/i;
const MONO = /var\(--(?:font-data|mono)\b|monospace/i;

type Rule = { file: string; selector: string; body: string };

function rulesOf(file: string): Rule[] {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ file, selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! });
  }
  return out;
}

function stylesheets(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".css")) files.push(relative(ROOT, path));
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "components"));
  return files;
}

/** Declarations that paint a resting mark: everything but the focus outline. */
function paint(body: string): string {
  return body.replace(/outline(?:-color)?\s*:[^;]+;?/g, "");
}

function family(body: string): string {
  const declared = [
    ...body.matchAll(/(?:^|[;\s])font-family\s*:\s*([^;]+)/g),
    ...body.matchAll(/(?:^|[;\s])font\s*:\s*([^;]+)/g),
  ];
  return declared.map((m) => m[1]!).join(" | ");
}

function rule(file: string, selector: string): Rule {
  const found = rulesOf(file).filter((r) => r.selector === selector);
  expect(found.length, `${selector} still has a rule in ${file}`).toBeGreaterThan(0);
  return { file, selector, body: found.map((r) => r.body).join(";") };
}

describe("coral is spent twice", () => {
  const globals = read("app/globals.css");

  it("declares the neutral selected row, mixed from ink and never from coral", () => {
    for (const token of ["--state-selected-surface", "--state-selected-border", "--state-selected-ink"]) {
      const value = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(globals)?.[1];
      expect(value, `${token} is declared in app/globals.css`).toBeDefined();
      expect(value, `${token} carries no coral`).not.toMatch(CORAL);
    }
  });

  // Every selection the P2-A audit found painted in coral. Each must read the
  // neutral selected row now, and none may paint coral outside a focus ring.
  const SELECTIONS: ReadonlyArray<readonly [file: string, selector: string]> = [
    ["components/ui/chip.css", '.uiChip[aria-pressed="true"]'],
    ["components/nav/nowSegment.css", '.nowSegmentOpt[aria-current="page"]'],
    ["components/nav/siteNav.css", ".siteNavLink.isActive"],
    ["components/nav/mobileNav.css", ".mobileTab.isActive .mobileTabIcon"],
    ["app/globals.css", ".segmented button.selected"],
    ["app/globals.css", ".routePaceBtn.active"],
    ["app/globals.css", ".vibeChip.selected"],
    ["components/vibe/vibeChips.css", '.vibeChip[data-active="true"]'],
    ["app/tonight/tonight.css", '.tonightChip[data-active="true"]'],
    ["app/feed/feed.css", ".feedFilterChip.isActive"],
    ["app/historic/historic.css", '.historicToggle[data-active="true"]'],
    ["app/crawls/crawls.css", ".routePackChip.isActive"],
    ["components/map/venueSheet.css", ".venueTab.active"],
    // The /plan wizard's chosen answer painted through --plan-accent, an alias
    // of --accent-action the CORAL pattern does not name, so it read coral here.
    ["app/plan/plan.css", '.planIntake__choices button[aria-pressed="true"], .planIntake__numberChoices button[aria-pressed="true"]'],
    ["components/nearme/nearModeSwitch.css", '.nearModeSwitchTab[aria-checked="true"]'],
    // The map's drink subtypes and Top shelf: a chosen filter, so a selection.
    // Top shelf painted a coral gradient fill with white type.
    ["components/map/mapToolbar.css", ".drinkSubtypeChip.isOn"],
    ["components/map/mapToolbar.css", ".drinkSubtypeChip.isTopShelf.isOn"],
    // The design-system tab audit (17 Oct 2026): the soft-drink chips wore the
    // category hue over a coral fallback and the admin sections a coral tint.
    ["components/drinks/drinkSubtypePricedView.css", ".softDrinksWater__chip.isOn"],
    ["app/admin/admin.css", ".admin-tab.active"],
    // The phone tab bar's pressed well (the pressed rail, 17 Oct 2026).
    ["components/nav/mobileNav.css", ".mobileTabHighlight"],
  ];

  // The Day | Tonight segment and the desktop nav pill took the same step on
  // main (#2127) with their own neutral recipes: the raised segment fill that
  // every segmented control shares (__tests__/deBoxSegmentedControl.test.ts),
  // and the phone tab bar's ink tint. Those two are held to "no coral" alone.
  const OWN_NEUTRAL = new Set(['.nowSegmentOpt[aria-current="page"]', ".siteNavLink.isActive"]);

  for (const [file, selector] of SELECTIONS) {
    it(`${selector} is a selection in ink, not a coral fill`, () => {
      const { body } = rule(file, selector);
      expect(paint(body), `${selector} in ${file} paints no coral`).not.toMatch(CORAL);
      if (OWN_NEUTRAL.has(selector)) return;
      expect(body, `${selector} in ${file} reads the --state-selected-* row`).toMatch(
        /var\(--state-selected-(?:surface|border|ink)\)/,
      );
    });
  }

  // A suggestion is never a second primary: a neutral outline, at rest and on
  // hover, in both the /plan describe chips and the tonight vibe chips.
  const SUGGESTIONS: ReadonlyArray<readonly [file: string, prefix: string]> = [
    ["app/plan/plan.css", ".planDescribeFirst__chip"],
    ["components/vibe/vibeChips.css", ".vibeChip"],
    ["app/globals.css", ".vibeChip"],
  ];

  for (const [file, prefix] of SUGGESTIONS) {
    it(`${prefix} in ${file} is a neutral outline chip`, () => {
      const rules = rulesOf(file).filter((r) =>
        r.selector.split(",").some((part) => part.trim().replace(/^(?:button|a|\.palChat \w+)/, "").trim().startsWith(prefix)),
      );
      expect(rules.length, `${prefix} has rules in ${file}`).toBeGreaterThan(0);
      const coral = rules.filter((r) => CORAL.test(paint(r.body))).map((r) => r.selector);
      expect(coral, `${prefix} rules painting coral`).toEqual([]);
    });
  }

  it("a kicker is muted ink, and so is every eyebrow", () => {
    const kicker = rule("components/ui/kicker.css", ".kicker");
    expect(kicker.body).toMatch(/(?:^|[;\s])color:\s*var\(--color-text-muted\)/);
    expect(read("components/ui/kicker.tsx"), "the coral tone is gone, not switched off").not.toMatch(
      /tone|kickerMuted|accent/,
    );

    const offences = stylesheets()
      .flatMap(rulesOf)
      .filter((r) => /eyebrow|kicker/i.test(r.selector))
      .filter((r) => {
        const colour = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(r.body)?.[1] ?? "";
        return CORAL.test(colour);
      })
      .map((r) => `${r.file} ${r.selector}`);
    expect(offences, "a kicker or eyebrow takes var(--color-text-muted), never coral").toEqual([]);
  });
});

describe("monospace is for figures", () => {
  // The labels the P2-A audit found in the data face. Each is a word, so each
  // takes the UI sans.
  const LABELS: ReadonlyArray<readonly [file: string, selector: string]> = [
    ["components/landing/landing.css", ".lpFooterCol h2"],
    ["components/landing/landing.css", ".lpFooterSmallPrint a"],
    ["components/landing/landing.css", ".lpFooterCredit"],
    ["components/landing/landing.css", ".lpFooterLegal"],
    ["components/landing/landing.css", ".dropStripEra, .provChip"],
    ["app/globals.css", ".venueHoverEyebrow"],
    ["app/places/places.css", ".placesPill"],
    ["app/legal.css", ".legalRow dt"],
    ["components/ui/kicker.css", ".kicker"],
  ];

  for (const [file, selector] of LABELS) {
    it(`${selector} is set in the UI sans`, () => {
      const { body } = rule(file, selector);
      expect(family(body), `${selector} in ${file} names the body face`).toMatch(/var\(--font-body\)/);
      expect(family(body), `${selector} in ${file} sets no monospace`).not.toMatch(MONO);
    });
  }

  // The sweep: a selector that NAMES a label may not reach for the data face,
  // so the next footer, kicker or pill lands on the sans by default. A selector
  // that also names a figure (a count inside a chip, a price inside a pill) is
  // a figure and keeps the mono face; that is the whole exemption.
  const LABEL = /eyebrow|kicker|label|legal|footer|\bnav|Nav[A-Z]|hint|pill|\bdt\b|\bh[1-6]\b/i;
  const FIGURE = /count|price|value|num|rank|figure|total|code|date|when|age|dist|time|stat/i;

  it("no stylesheet sets a label in the data face", () => {
    const offences = stylesheets()
      .flatMap(rulesOf)
      .filter((r) => !r.selector.startsWith("@") && !r.selector.startsWith("--"))
      .filter((r) => MONO.test(family(r.body)))
      .filter((r) => LABEL.test(r.selector) && !FIGURE.test(r.selector))
      .map((r) => `${r.file} ${r.selector}`);
    expect(offences, "a label takes var(--font-body); --font-data is for figures").toEqual([]);
  });
});
