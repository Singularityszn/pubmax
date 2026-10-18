import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// ONE LOOK FOR EVERY PRICE (taste plan, 18 Oct 2026, change 3).
//
// A pint price on a row or a card goes through components/PriceBadge.tsx
// (`PintPriceBadge`, or `PriceBadge` with its band), so it wears its band and
// the one plaque. A figure that is not a pint (a deal, a coffee) takes
// `PriceBadge` with no band. Never a bare coloured number, never a plain
// "£5.40" beside a badge, never a second price style.
//
// __tests__/priceBandSurfaces.test.ts holds each banded surface to the band
// module. This file sweeps the tree for the opposite: a price printed as bare
// JSX text, `{formatPrice(…)}`, `{formatGbp(…)}` or `£{…}`, with no badge or
// band class around it. The captain's exceptions are listed by file with a
// count that may only go down.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

/** A price printed as a JSX child (a template string `${…}` is copy, not markup). */
const BARE_PRICE = /(?<![$\w])\{\s*(?:formatPrice|formatGbp)\(|£\{/;

/** Within this many lines above, a badge or a band class owns the figure. */
const OWNED = /<PriceBadge|<PintPriceBadge|price-plaque|[pP]riceBandClass\(/;
const WINDOW = 14;

/**
 * Where a bare price is still allowed, and why. Counts are the measured
 * figure (18 Oct 2026) and may only go down.
 */
const EXCEPTIONS: ReadonlyArray<readonly [file: string, count: number, reason: string]> = [
  // League tables and aggregate stats: dense tables of averages, not a pint.
  ["app/pint-index/page.tsx", 4, "aggregate stats and a sentence"],
  ["app/pint-index/[month]/page.tsx", 4, "aggregate stats and a sentence"],
  ["components/pintindex/PintIndexLeagueTable.tsx", 1, "league table of aggregates"],
  ["components/seo/FactBlock.tsx", 3, "fact table of aggregates"],
  ["components/borough/BoroughPintPriceCard.tsx", 2, "an average in running copy"],
  // A subtotal is a sum, not a pint price.
  ["app/crawls/CrawlsPageClient.tsx", 1, "a route subtotal"],
  ["app/crawls/[slug]/CrawlStoryPoster.tsx", 1, "a route subtotal"],
  ["app/rounds/[code]/RoundPageClient.tsx", 5, "round spend totals and the round's own menu lines"],
  // A pint price inside a sentence, where a badge would break the line.
  ["components/landing/LandingHero.tsx", 1, "the 'then' price in a sentence"],
  ["components/landing/LandingLondonCollage.tsx", 1, "'Pints from £x' in a caption"],
  ["components/drinks/DrinkBrandAreaLandingContent.tsx", 1, "'From £x' in the summary line"],
  ["components/map/VenuePriceThen.tsx", 2, "then and now in one sentence"],
  ["components/pintindex/NationalPintBenchmarks.tsx", 3, "national benchmarks in sentences"],
  ["components/map/VenuePriceStory.tsx", 4, "chart bar labels and an inflation sentence"],
  ["components/night/NightModeCard.tsx", 2, "a meta line in running copy"],
  ["components/onboarding/OnboardingPanels.tsx", 1, "the answer headline is a sentence"],
  ["components/onboarding/FirstRunOnboarding.tsx", 1, "the hero figure is decorative and aria-hidden"],
  // A receipt confirms what the reader typed; inputs offer amounts to choose.
  ["components/map/VenuePriceSubmit.tsx", 4, "the logged receipt, the quick amounts and the cap copy"],
  ["components/map/LondonFoodPlaceSheet.tsx", 1, "the logged receipt"],
  ["components/map/composer/ComposerPriceStep.tsx", 1, "a price input's choice"],
  ["components/map/inspector/VenueOverviewTab.tsx", 1, "the price door's own choice buttons"],
  ["components/map/inspector/VenueStoryTab.tsx", 1, "the no-price placeholder"],
  // Internal tools.
  ["app/admin/AdminClient.tsx", 3, "the moderation console"],
  ["app/admin/VenueSubmissionModeration.tsx", 1, "the moderation console"],
];

function tsxFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // An OG image and an API card render to a PNG, not a page.
        if (entry.name === "api") continue;
        walk(path);
      } else if (entry.name.endsWith(".tsx") && !/opengraph-image|route\.tsx$/.test(entry.name)) {
        files.push(relative(ROOT, path));
      }
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "components"));
  return files.sort();
}

function barePrices(file: string): number {
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  let count = 0;
  lines.forEach((line, index) => {
    if (!BARE_PRICE.test(line)) return;
    const context = lines.slice(Math.max(0, index - WINDOW), index + 1).join("\n");
    if (!OWNED.test(context)) count += 1;
  });
  return count;
}

const found = new Map(tsxFiles().map((file) => [file, barePrices(file)] as const));

describe("every pint price wears the one price look", () => {
  it("sweeps a corpus large enough to mean something", () => {
    expect(found.size).toBeGreaterThan(300);
  });

  it("prints no bare price outside the captain's exceptions", () => {
    const allowed = new Set(EXCEPTIONS.map(([file]) => file));
    const offences = [...found]
      .filter(([file, count]) => count > 0 && !allowed.has(file))
      .map(([file, count]) => `${file}: ${count}`);
    expect(offences, "put the figure in <PintPriceBadge> (a pint) or <PriceBadge> (anything else)").toEqual([]);
  });

  for (const [file, ceiling, reason] of EXCEPTIONS) {
    it(`${file} keeps at most ${ceiling} bare (${reason})`, () => {
      expect(found.has(file), `${file} still exists`).toBe(true);
      expect(found.get(file)).toBeLessThanOrEqual(ceiling);
    });
  }

  // The surfaces the taste pass moved onto the badge. Each must keep it.
  const BADGED: ReadonlyArray<readonly [file: string, call: RegExp]> = [
    ["app/pubs/[id]/page.tsx", /<PintPriceBadge/],
    ["app/bar-tab/[id]/page.tsx", /<PintPriceBadge/],
    ["app/invite/[token]/page.tsx", /<PintPriceBadge/],
    ["components/map/inspector/PintDropsList.tsx", /<PintPriceBadge/],
    ["components/map/inspector/VenueStoryTab.tsx", /<PintPriceBadge/],
    ["components/map/LastTrainCard.tsx", /<PintPriceBadge/],
    ["components/map/MapConciergeAsk.tsx", /<PintPriceBadge/],
    ["components/pal/PalChat.tsx", /<PintPriceBadge/],
    ["components/onboarding/OnboardingPanels.tsx", /<PintPriceBadge/],
    ["components/map/TonightLane.tsx", /<PriceBadge/],
    ["components/map/CoffeePilotSheet.tsx", /<PriceBadge/],
    ["components/ledger/LedgerLive.tsx", /<PriceBadge/],
    ["components/map/composer/SpillPreviewCard.tsx", /<PriceBadge/],
  ];

  for (const [file, call] of BADGED) {
    it(`${file} prints its price through the badge`, () => {
      expect(readFileSync(join(ROOT, file), "utf8")).toMatch(call);
    });
  }

  // A price's own class only places the badge; the face is the plaque's.
  const LAYOUT_ONLY: ReadonlyArray<readonly [file: string, selector: string]> = [
    ["app/bar-tab/[id]/barTab.css", ".barTabTilePrice"],
    ["app/invite/[token]/invite.css", ".invite__stopPrice"],
    ["app/ledger/[id]/ledger.css", ".ledgerEntryPriceValue"],
    ["components/map/spillComposer.css", ".spillPreviewPrice"],
    ["components/map/mapConciergeAsk.css", ".mapConciergeAskCardPrice"],
    ["components/map/tonightLane.css", ".tonightLaneCardPrice"],
    ["components/map/coffeePilotSheet.css", ".coffeePilotFigure"],
    ["components/pal/palChat.css", ".palChatCardPrice"],
  ];

  for (const [file, selector] of LAYOUT_ONLY) {
    it(`${selector} in ${file} sets no colour, face or fill of its own`, () => {
      const css = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const escaped = selector.replace(/[.[\]]/g, "\\$&");
      const bodies = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]!);
      expect(bodies.length, `${selector} has a rule`).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body).not.toMatch(/(?:^|[;\s])(?:color|background|font(?:-family|-size|-weight)?|border)\s*:/);
      }
    });
  }
});
