import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The native first run put the analytics consent card ON TOP of the onboarding
// list: on the iPhone 17 Pro simulator it lay across the reviewed-area rows and
// the "Use London" button. Consent outranking every other prompt
// (analyticsChoiceHasPriority, lib/promptBudget.ts) is correct and is NOT what
// changed; the placement was the defect, so this fence is about geometry alone.
//
// It is a LAYOUT MODEL rather than a regex over selectors. The lengths are read
// out of the shipped CSS, resolved for a real phone viewport with a real iOS
// bottom inset, and turned into two bands: the band the onboarding surface
// occupies and the band the card occupies. The assertion is that those bands do
// not share a bounding box. A rule that still matched but that quietly stopped
// making room would pass a text check and fail this one.
//
// The rendered proof is a browser's, not a parser's, and the simulator captures
// on the pull request are that. This fence exists because the first-run surface
// is native-only, and no browser test reaches it without a Capacitor double,
// so the arithmetic has to be held somewhere that always runs.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const globalCss = read("app/globals.css");
const onboardingCss = read("app/onboarding/onboarding.css");

/** A phone the shell actually ships on, with iOS's home-indicator inset. */
type Viewport = {
  name: string;
  width: number;
  height: number;
  safeAreaBottom: number;
  safeAreaTop: number;
};

const NATIVE_VIEWPORTS: Viewport[] = [
  // The simulator PR 1452 reported the overlap on.
  { name: "iPhone 17 Pro", width: 393, height: 852, safeAreaBottom: 34, safeAreaTop: 59 },
  { name: "iPhone 14/15 (390x844)", width: 390, height: 844, safeAreaBottom: 34, safeAreaTop: 47 },
  { name: "iPhone Pro Max (430x932)", width: 430, height: 932, safeAreaBottom: 34, safeAreaTop: 59 },
  // The narrow floor the phone chrome is held to elsewhere; no inset on the
  // devices that small, which is the case a safe-area-only berth must survive.
  { name: "320x568", width: 320, height: 568, safeAreaBottom: 0, safeAreaTop: 20 },
  // The entry Android tier verify-preview-4 found the card over "Use London" on.
  { name: "360x640", width: 360, height: 640, safeAreaBottom: 0, safeAreaTop: 24 },
];

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every body of the media query written as `condition`. A stylesheet this size
 * reopens the same breakpoint many times over, so taking the first one would
 * read a block that has nothing to do with the rule being asked about.
 */
function mediaBodies(css: string, condition: string): string[] {
  const bodies: string[] = [];
  const opener = `@media ${condition}`;
  for (let start = css.indexOf(opener); start >= 0; start = css.indexOf(opener, start + 1)) {
    // A longer condition starting with this one is a different query.
    const rest = css.slice(start + opener.length);
    if (!/^\s*{/.test(rest)) continue;
    const open = css.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(css.slice(open + 1, end));
  }
  expect(bodies.length, `media query "${condition}" is present`).toBeGreaterThan(0);
  return bodies;
}

/** The rule bodies matching `selector`, in document order. */
function ruleBodies(css: string, selector: string, within?: string): string[] {
  const scopes = within ? mediaBodies(strip(css), within) : [strip(css)];
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n|})\\s*${escaped}\\s*{([^{}]*)}`, "g");
  return scopes.flatMap((scope) => [...scope.matchAll(pattern)].map((match) => match[1]!));
}

function parseDeclarations(body: string, into = new Map<string, string>()): Map<string, string> {
  for (const declaration of body.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    into.set(
      declaration.slice(0, separator).trim(),
      declaration.slice(separator + 1).trim(),
    );
  }
  return into;
}

/**
 * Declarations of the LAST rule matching `selector`, optionally restricted to
 * the named media query. Last wins, which is what the cascade does for rules of
 * equal specificity.
 */
function declarationsFor(
  css: string,
  selector: string,
  within?: string,
): Map<string, string> {
  const bodies = ruleBodies(css, selector, within);
  expect(bodies.length, `rule for "${selector}" is present`).toBeGreaterThan(0);
  return parseDeclarations(bodies[bodies.length - 1]!);
}

/** Split on `separator`, ignoring separators inside parentheses. */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Resolve a CSS length to pixels for one viewport. Handles the subset the
 * consent lane is written in: px, dvh, var(), env() with a fallback, calc()
 * arithmetic and max()/min(). Anything outside that subset throws rather than
 * being guessed at, so a future declaration this cannot read fails loudly
 * instead of quietly resolving to zero.
 */
function resolvePx(
  value: string,
  viewport: Viewport,
  variables: Map<string, string>,
  seen: ReadonlySet<string> = new Set(),
): number {
  const input = value.trim();

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(input);
  if (varMatch) {
    const name = varMatch[1]!;
    expect(seen.has(name), `custom property ${name} is not self-referential`).toBe(false);
    const resolved = variables.get(name) ?? varMatch[2];
    if (resolved === undefined) {
      throw new Error(`custom property ${name} has no declaration and no fallback`);
    }
    return resolvePx(resolved, viewport, variables, new Set([...seen, name]));
  }

  const envMatch = /^env\(\s*([\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(input);
  if (envMatch) {
    const name = envMatch[1]!;
    if (name === "safe-area-inset-bottom") return viewport.safeAreaBottom;
    if (name === "safe-area-inset-top") return viewport.safeAreaTop;
    if (name === "safe-area-inset-left" || name === "safe-area-inset-right") return 0;
    throw new Error(`unhandled env() keyword: ${name}`);
  }

  const fnMatch = /^(calc|max|min)\(([\s\S]*)\)$/.exec(input);
  if (fnMatch) {
    const fn = fnMatch[1]!;
    const args = splitTopLevel(fnMatch[2]!, ",");
    if (fn === "max" || fn === "min") {
      const values = args.map((arg) => resolvePx(arg, viewport, variables, seen));
      return fn === "max" ? Math.max(...values) : Math.min(...values);
    }
    expect(args.length, "calc() takes one expression").toBe(1);
    return evaluateSum(args[0]!, viewport, variables, seen);
  }

  const lengthMatch = /^(-?[\d.]+)(px|dvh|vh)?$/.exec(input);
  if (lengthMatch) {
    const amount = Number(lengthMatch[1]);
    const unit = lengthMatch[2] ?? "px";
    if (unit === "px") return amount;
    return (amount / 100) * viewport.height;
  }

  // A bare additive expression: the inside of a calc() with its own
  // parentheses already taken off.
  if (/[+\-]/.test(input)) return evaluateSum(input, viewport, variables, seen);

  throw new Error(`cannot resolve length: "${input}"`);
}

/** Evaluate a top-level `a + b - c` chain of lengths. */
function evaluateSum(
  input: string,
  viewport: Viewport,
  variables: Map<string, string>,
  seen: ReadonlySet<string>,
): number {
  const terms: { sign: number; text: string }[] = [];
  let depth = 0;
  let current = "";
  let sign = 1;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    // CSS requires whitespace around + and - in calc(), which is also what
    // keeps a negative literal or a custom-property name from splitting here.
    const isOperator =
      depth === 0
      && (char === "+" || char === "-")
      && index > 0
      && /\s/.test(input[index - 1]!)
      && /\s/.test(input[index + 1] ?? "");
    if (isOperator) {
      terms.push({ sign, text: current });
      sign = char === "+" ? 1 : -1;
      current = "";
      continue;
    }
    current += char;
  }
  terms.push({ sign, text: current });
  return terms.reduce(
    (total, term) => total + term.sign * resolvePx(term.text, viewport, variables, seen),
    0,
  );
}

/**
 * Custom properties declared on :root, merged in document order, optionally
 * including the ones a media query redeclares. Both stylesheets reopen :root
 * several times, so every block counts, not the last one.
 */
function rootVariables(within?: string): Map<string, string> {
  const variables = new Map<string, string>();
  for (const css of [globalCss, onboardingCss]) {
    const scopes: (string | undefined)[] = within ? [undefined, within] : [undefined];
    for (const scope of scopes) {
      if (scope && !strip(css).includes(`@media ${scope}`)) continue;
      for (const body of ruleBodies(css, ":root", scope)) {
        for (const [name, value] of parseDeclarations(body)) {
          if (name.startsWith("--")) variables.set(name, value);
        }
      }
    }
  }
  return variables;
}

type Band = { top: number; bottom: number };

const bandsShareABoundingBox = (a: Band, b: Band): boolean =>
  a.top < b.bottom && b.top < a.bottom;

const PHONE_MEDIA = "(max-width: 760px)";
const CARD_MEDIA = "(max-width: 640px)";
const SURFACE_RULE = "body:has(.analyticsConsentPrompt) .firstRunOnboarding";
const CARD_RULE = "body:has(.firstRunOnboarding) .analyticsConsentPrompt";

describe("native first-run consent placement", () => {
  it("publishes the consent lane once so the surface does not restate it", () => {
    const roots = rootVariables();
    expect(roots.get("--analytics-consent-clearance")).toBe("72px");
    expect(roots.get("--analytics-consent-mobile-clearance")).toBe("128px");

    // The first-run surface must READ those, never carry its own copy.
    const lane = rootVariables(PHONE_MEDIA).get("--first-run-consent-lane") ?? "";
    expect(lane).toContain("var(--analytics-consent-mobile-clearance)");
    expect(lane).not.toMatch(/\b128px\b/);
  });

  it("parks the card on the safe area, because the surface hides the tab bar", () => {
    // .mobileTabBar is display:none on this surface but still in the document,
    // so the card's tab-bar berth would hold it 72px up over a bar nobody can
    // see, and the :not(:has()) rule beside it cannot tell.
    expect(onboardingCss).toMatch(
      /body:has\(\.firstRunOnboarding\)\s*\.mobileTabBar\s*{[^}]*display:\s*none/,
    );
    expect(declarationsFor(globalCss, CARD_RULE, CARD_MEDIA).get("bottom")).toBe(
      "max(12px, env(safe-area-inset-bottom))",
    );
  });

  it("keeps the surface and the card in bands that never share a bounding box", () => {
    const variables = rootVariables(PHONE_MEDIA);
    const surfaceHeight = declarationsFor(onboardingCss, SURFACE_RULE).get("height");
    expect(surfaceHeight, "the surface takes an explicit height").toBeDefined();

    const cardBerth = declarationsFor(globalCss, CARD_RULE, CARD_MEDIA).get("bottom")!;
    const cardMaxHeight = declarationsFor(
      globalCss,
      ".analyticsConsentPrompt",
      CARD_MEDIA,
    ).get("max-height")!;

    for (const viewport of NATIVE_VIEWPORTS) {
      const surface: Band = { top: 0, bottom: resolvePx(surfaceHeight!, viewport, variables) };
      const berth = resolvePx(cardBerth, viewport, variables);
      const card: Band = {
        top: viewport.height - berth - resolvePx(cardMaxHeight, viewport, variables),
        bottom: viewport.height - berth,
      };

      expect(
        bandsShareABoundingBox(surface, card),
        `${viewport.name}: surface ${JSON.stringify(surface)} and card ${JSON.stringify(card)} overlap`,
      ).toBe(false);
      // The card belongs BELOW the surface, not merely elsewhere: a surface
      // pushed off the top of the screen would also fail to overlap.
      expect(surface.bottom, `${viewport.name}: surface ends above the card`)
        .toBeLessThanOrEqual(card.top);
      expect(card.bottom, `${viewport.name}: card stays on screen`)
        .toBeLessThanOrEqual(viewport.height);
      expect(surface.bottom, `${viewport.name}: surface keeps most of the screen`)
        .toBeGreaterThan(viewport.height * 0.6);
    }
  });

  it("scrolls the onboarding surface itself, so nothing passes under the card", () => {
    // Reserving foot room is not enough on a viewport-height surface: content
    // taller than the screen would still slide beneath a fixed card while it
    // scrolled. The surface owns its own scroll and the card sits outside it.
    const surface = declarationsFor(onboardingCss, SURFACE_RULE);
    expect(surface.get("overflow-y")).toBe("auto");
    expect(surface.get("min-height")).toBe("0");

    // The body no longer scrolls, so the foot padding globals.css adds for the
    // card would be dead space below a page that cannot reach it.
    expect(
      declarationsFor(
        onboardingCss,
        "body:has(.firstRunOnboarding):has(.analyticsConsentPrompt)",
        PHONE_MEDIA,
      ).get("padding-bottom"),
    ).toBe("0");
  });

  it("leaves the surface untouched when no consent card is mounted", () => {
    // Every declaration added for the card is gated on the card being mounted,
    // so a viewer who has already answered gets the surface exactly as before.
    const rules = [
      ...strip(onboardingCss).matchAll(/(^|\n)([^{}\n][^{}]*?)\s*{([^{}]*)}/g),
    ];
    const readers = rules.filter(([, , , body]) => body!.includes("--first-run-consent-lane"));
    expect(readers.length, "the lane is read somewhere").toBeGreaterThan(0);
    for (const [, , selector] of readers) {
      const name = selector!.trim();
      const declaresTheToken = name === ":root";
      expect(
        declaresTheToken || name.includes(":has(.analyticsConsentPrompt)"),
        `"${name}" reads the consent lane without checking the card is mounted`,
      ).toBe(true);
    }
  });

  it("keeps the one action on screen on a short phone, and only while the card is up", () => {
    // 320x568 and 360x640 (verify-preview-4, check 7): the lane-reduced
    // surface was 428 and 500px tall against a 553px panel, so "Use London"
    // sat past the surface's end inside a scroller no phone draws a bar for.
    // The short-phone block compresses the panel's rhythm and pins the action
    // row to the surface's foot. Every rule in it is gated on the card.
    const block = mediaBodies(strip(onboardingCss), "(max-width: 760px) and (max-height: 700px)");
    expect(block.length).toBe(1);
    const rules = [...block[0]!.matchAll(/([^{}]+){([^{}]*)}/g)];
    expect(rules.length).toBeGreaterThan(3);
    for (const [, selector] of rules) {
      expect(selector!.trim(), `"${selector!.trim()}" is gated on the card`).toContain(
        "body:has(.analyticsConsentPrompt)",
      );
    }
    const actions = parseDeclarations(
      rules.find(([, selector]) => selector!.trim().endsWith(".firstRunActions"))?.[2] ?? "",
    );
    expect(actions.get("position")).toBe("sticky");
    expect(actions.get("bottom")).toBe("0");
  });
});
