import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// THE PUB'S WORD CHANGES NOTHING ELSE (launch plan 1 Nov 2026, section 7 item
// 1; docs/SPONSORSHIP_POLICY.md, the never-changes list). A published operator
// fact is shown in its own block, "From the pub" on the venue sheet and "From
// the pubs tonight" on Tonight, and nowhere else. This source fence holds that:
//
//   1. Only the files below may import an operator-fact module. A ranker, a pin
//      colour, a price band or a list order that reached for one would fail
//      here before it could read a single row.
//   2. The modules that rank, colour, band or order a venue name no operator
//      fact at all, so the rule is visible where a reader would look for it.
//   3. The pub's word is not paid: no operator-fact surface reaches the
//      sponsorship rail or prints "Sponsored".

const ROOT = process.cwd();

const OPERATOR_FACT_MODULES = [
  "@/lib/operatorFacts",
  "@/lib/operatorFactsStore",
  "@/lib/tonightOperatorFacts.server",
  "@/components/operators/VenueFromThePub",
  "./TonightFromThePubs",
];

/** Every file allowed to import an operator-fact module, and why. */
const ALLOWED_IMPORTERS: Record<string, string> = {
  "lib/operatorFactsStore.ts": "the store",
  "lib/tonightOperatorFacts.server.ts": "Tonight's server read",
  "app/api/operator-proposals/route.ts": "the one writer: the moderator's accept and decline",
  "app/api/operator-facts/route.ts": "the public read for the venue sheet",
  "components/operators/VenueFromThePub.tsx": "the venue sheet's block",
  "components/map/inspector/VenueOverviewTab.tsx": "mounts the block as one row in the pub fold",
  "app/tonight/TonightFromThePubs.tsx": "Tonight's block",
  "app/tonight/TonightClient.tsx": "mounts Tonight's block under the listings",
  "app/tonight/page.tsx": "reads tonight's facts when the page is prepared",
};

/** What ranks, colours, bands or orders a venue. None may name an operator fact. */
const NEVER_CHANGES_MODULES = [
  "lib/forYou.ts",
  "lib/concierge/rank.ts",
  "lib/nearMeAnswer.ts",
  "lib/priceTier.ts",
  "lib/priceBand.ts",
  "lib/pintTrust.ts",
  "lib/venues.ts",
  "lib/slimPins.ts",
  "lib/tonightListGrouping.ts",
  "lib/tonightOutListings.ts",
  "lib/tonightCheapPints.ts",
  "lib/hypedPubs.ts",
  "lib/dealsHonesty.ts",
];
const NEVER_CHANGES_DIRECTORIES = ["components/map/canvas"];

const OPERATOR_FACT_SURFACES = [
  "components/operators/VenueFromThePub.tsx",
  "app/tonight/TonightFromThePubs.tsx",
  "lib/operatorFacts.ts",
];

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** The code alone: a comment that explains the rule is not a breach of it. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules") continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(relative(ROOT, join(ROOT, rel)));
  }
}

function importsOperatorFacts(text: string): boolean {
  return OPERATOR_FACT_MODULES.some(
    (mod) => text.includes(`from "${mod}"`) || text.includes(`from '${mod}'`) || text.includes(`import("${mod}")`),
  );
}

describe("operator facts change nothing else", () => {
  it("are imported only by their own store, routes and blocks", () => {
    const files: string[] = [];
    for (const dir of ["app", "components", "lib"]) walk(dir, files);
    const importers = files.filter((file) => importsOperatorFacts(source(file))).sort();
    expect(importers).toEqual(Object.keys(ALLOWED_IMPORTERS).sort());
  });

  it("are never named by what ranks, colours, bands or orders a venue", () => {
    const files = [...NEVER_CHANGES_MODULES];
    for (const dir of NEVER_CHANGES_DIRECTORIES) walk(dir, files);
    for (const file of files) {
      const text = source(file);
      expect(text, file).not.toMatch(/operatorFact|operator_facts|OperatorFact|FROM_THE_PUB/);
    }
  });

  it("are not paid, so no surface reaches the sponsorship rail or says Sponsored", () => {
    for (const file of OPERATOR_FACT_SURFACES) {
      const text = code(file);
      expect(text, file).not.toContain("@/lib/sponsorship");
      expect(text, file).not.toMatch(/SPONSORED_DISCLOSURE_LABEL|"Sponsored"|>Sponsored</);
    }
  });

  it("leave the venue Overview with one mount line, in the pub fold", () => {
    const overview = source("components/map/inspector/VenueOverviewTab.tsx");
    expect(overview.match(/<VenueFromThePub\b/g)).toHaveLength(1);
    const pubFold = overview.slice(
      overview.indexOf('<OverviewFold foldKey="pub">'),
      overview.indexOf('<OverviewFold foldKey="record">'),
    );
    expect(pubFold).toContain("<VenueFromThePub");
  });

  it("sit outside Tonight's lede region, after it", () => {
    const client = source("app/tonight/TonightClient.tsx");
    const lede = client.indexOf('data-testid="tonight-lede"');
    const block = client.indexOf("<TonightFromThePubs");
    const lastOrders = client.indexOf("<TonightLastOrdersDoor");
    expect(lede).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(lede);
    // The lede region closes before the last orders door, which already sits
    // under it; the block lands between the two.
    expect(block).toBeLessThan(lastOrders);
    const between = client.slice(lede, block);
    const opened = (between.match(/<div\b/g) ?? []).length;
    const closed = (between.match(/<\/div>/g) ?? []).length;
    expect(closed, "the lede region is closed before the block").toBeGreaterThanOrEqual(opened);
  });
});
