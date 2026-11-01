import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// THE CORAL RATCHET (docs/DESIGN_SYSTEM.md "Coral is spent twice"; taste plan,
// 18 Oct 2026, change 1).
//
// Coral is spent on the ONE primary action per screen. The floating create
// disc that was its second spend left with the five-tab dock (captain, 1 Nov
// 2026), and its allowance went with it. __tests__/visualDiscipline.test.ts
// pins the selections, suggestion
// chips and kickers by name, and __tests__/mapCoralEconomy.test.ts pins the
// map. This file holds the rest of the tree to a COUNT: every declaration in
// app/ and components/ CSS that paints coral, outside the allowlist below.
//
// The count may only go down. When a change pays coral off, lower CEILING to
// the new figure in the same commit. A new coral mark that is not a primary
// fails here: paint it in ink (a link takes --color-text and an underline, a
// label --color-text-muted, a selection the --state-selected-* row) rather
// than raising the ceiling.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

/** Every name the accent goes by, including the plan page's alias and the tint token. */
const CORAL =
  /var\(--(?:brass|color-accent|accent-action|tint-ink-accent|plan-accent|surface-tint-brass)[\w-]*[,)]|#ff5a5f/i;

/**
 * The places coral is allowed to rest. Each entry is a selector pattern and
 * the reason it may wear the accent.
 */
const ALLOWED: ReadonlyArray<readonly [pattern: RegExp, reason: string]> = [
  // The one primary per screen, by the names the tree gives it.
  [/primary|Primary|(?:\b|_|-)cta\b|Cta\b|CTA|data-primary-action/, "a screen's one primary action"],
  [/\.priceDoor\b/, "the venue sheet's one painted price action"],
  [/\.planBtn\b/, "the map toolbar's Plan an outing primary"],
  [/\.vpsubLog\b/, "the price form's one commit, opened by the price door"],
  [/\.mobileVenuePeekSummary button/, "the phone peek's one plan door (lib/venuePlanDoor.ts)"],
  [/\.mobilePalSummon a\b/, "the Pal summon sheet's one action"],
  [/\.momentDecoratorActions button:first-child/, "the photo decorator's one apply"],
  [/\.composerSend\b|\.messagesNewGroupCreate\b/, "the messages screen's send and the new-group dialog's create"],
  [/\.planComposer__submit\b|\.planIntake__continue\b|\.invitePreview__join\b/, "the /plan composer, intake and invite primaries"],
  [/\.tourNext\b|\.profileCropConfirm\b|\.nativePushPrompt__enable\b|\.weAreOutSubmit\b/, "a dialog's or a one-action route's commit"],
  [/\.nightCrawl__enterBtn\b|\.nightCard__nextAction\b|\.nightAreaCoverage__plannerLink\b/, "a night-mode card's one action"],
  [/\.wantedCapture__submit\b|\.wantedPromotion button/, "the wanted capture's commit"],
  [/\.webmcp/, "the WebMCP developer page's own commits"],
  // An affordance, not a resting mark.
  [/:focus/, "a focus ring marks where the keyboard is"],
  [/::selection/, "the text selection highlight"],
  // Marks whose colour the map canvas assigns by meaning (components/map/canvas/tokens.ts).
  [/\.mapKey|\.mapLegend/, "the map key mirrors the canvas pins and route"],
  [/\.brandMark|pubmaxxWordmark|nightSeal/, "the brand mark"],
];

/** Scopes that declare tokens rather than paint anything. */
const TOKEN_SCOPE = /^(?::root|html)(?:\[data-theme=["']?\w+["']?\]|:not\(\[data-theme=["']?\w+["']?\]\))*$/;

type Mark = { file: string; selector: string; declaration: string };

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
  return files.sort();
}

function restingCoral(file: string): Mark[] {
  const css = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const marks: Mark[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim().replace(/\s+/g, " ");
    if (selector.startsWith("@") || /^(?:from|to|\d+%)/.test(selector)) continue;
    if (selector.split(",").every((part) => TOKEN_SCOPE.test(part.trim()))) continue;
    if (ALLOWED.some(([pattern]) => pattern.test(selector))) continue;
    for (const raw of m[2]!.split(";")) {
      const declaration = raw.trim().replace(/\s+/g, " ");
      if (!declaration || !CORAL.test(declaration)) continue;
      // A focus outline keeps the accent everywhere (visualDiscipline.test.ts).
      if (/^outline(?:-color)?\s*:/.test(declaration)) continue;
      marks.push({ file, selector, declaration });
    }
  }
  return marks;
}

const marks = stylesheets().flatMap(restingCoral);

// Measured 18 Oct 2026 after the area G sweep (map chrome and sheets, landing,
// plan, drinks, feed, ledger, bar tab, messages, invites, onboarding, night
// cards). The sweep began at 936 by this count. What remains sits mostly in
// surfaces other passes own (the public profile, sign-in, rounds, the historic
// and crawl pages, the nav) and in custom-property aliases such as
// --plan-accent; each is a debt to pay down, never a licence to add.
const CEILING = 158;

describe("coral is spent on the one primary", () => {
  it("finds a corpus large enough to mean something", () => {
    expect(stylesheets().length).toBeGreaterThan(150);
  });

  it(`holds resting coral at or below ${CEILING} declarations`, () => {
    expect(
      marks.length,
      `resting coral grew to ${marks.length}:\n` +
        marks.map((m) => `  ${m.file} ${m.selector} { ${m.declaration} }`).join("\n"),
    ).toBeLessThanOrEqual(CEILING);
  });

  // The surfaces this sweep cleared stay clear: a new coral mark on the map
  // chrome, its sheets or the landing page fails by name, not by count.
  const CLEARED = [/^components\/map\//, /^components\/mobile\//, /^components\/landing\//];

  it("keeps the map chrome, its sheets and the landing page free of resting coral", () => {
    const offences = marks
      .filter((m) => CLEARED.some((area) => area.test(m.file)))
      .map((m) => `${m.file} ${m.selector} { ${m.declaration} }`);
    expect(offences, "paint it in ink, or name the primary in ALLOWED with its reason").toEqual([]);
  });

  it("gives every allowance a reason", () => {
    for (const [pattern, reason] of ALLOWED) {
      expect(reason.length, `${pattern} needs a reason`).toBeGreaterThan(10);
    }
  });
});
