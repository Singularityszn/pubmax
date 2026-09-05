import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import PriceBadge from "@/components/PriceBadge";
import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import { hoverCardCopy } from "@/components/map/canvas/hoverCard";
import { priceBand } from "@/lib/priceBand";
import { priceBucket } from "@/lib/communityPrice";
import { orientationLegendRows } from "@/lib/mapPriceLegend";
import type { Venue } from "@/lib/venues";

// Every price a reader sees takes its colour from lib/priceBand.ts and from
// nothing else (captain's law 2026-09-05). This file is the per-surface fence:
// each surface below is held to importing the band module and to painting
// through its class family, and the tree is swept for a colour that still
// comes from a trust standing.

const ROOT = process.cwd();

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".next-prod") continue;
      walk(full, out);
    } else if (/\.(tsx?|css)$/.test(entry)) {
      out.push(full);
    }
  }
}

/** Surface, and the call it must paint through. */
const SURFACES: ReadonlyArray<[file: string, paint: RegExp]> = [
  // Map pins and cluster donuts: the numeric bucket IS the band.
  ["components/map/canvas/geojson.ts", /priceBucket\(/],
  ["lib/communityPrice.ts", /priceBandBucket\(/],
  ["lib/mapPriceLegend.ts", /priceBandLegendLabel\(/],
  // The desktop hover card and the List view rows.
  ["components/map/canvas/hoverCard.ts", /priceBand\(/],
  ["lib/mapVenueList.ts", /priceBand\(/],
  ["components/map/CompactVenuePrice.tsx", /priceBandClass\(/],
  // The phone peek chip and the drink-lens badge.
  ["components/PubMap.tsx", /priceBand\(/],
  // Landing answer card and its rail.
  ["components/landing/LandingHero.tsx", /priceBand\(/],
  ["components/landing/PintDropStrip.tsx", /priceBand\(/],
  // Venue sheet Overview and Drinks rows, and the UK base sheet.
  ["components/map/inspector/VenueOverviewTab.tsx", /priceBand\(/],
  ["components/map/VenueDrinkPrices.tsx", /priceBand\(/],
  ["components/map/UnverifiedPubSheet.tsx", /priceBand\(/],
  ["components/ui/trust-pill.tsx", /priceBand\(/],
  // Near-you and cheapest rails, /today, borough pages, drink landings, boards.
  ["components/nearme/NearMeNow.tsx", /priceBand\(/],
  ["app/today/TodayPintsCard.tsx", /priceBand\(/],
  ["app/borough/[slug]/page.tsx", /priceBand\(/],
  ["app/borough/page.tsx", /priceBand\(/],
  ["components/drinks/PricedLandingRows.tsx", /priceBand\(/],
  ["components/discovery/LeaderboardTable.tsx", /priceBand\(/],
  ["components/discovery/TonightBoard.tsx", /priceBand\(/],
  ["components/feed/FeedCard.tsx", /priceBand\(/],
  ["components/drinks/DrinkMenu.tsx", /priceBand\(/],
  // The zone strip on the Pint Index.
  ["components/zones/ZonePintIndexStrip.tsx", /priceBand\(/],
];

describe("every price surface paints through lib/priceBand.ts", () => {
  for (const [file, paint] of SURFACES) {
    it(file, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).toMatch(/from "@\/lib\/(priceBand|communityPrice)"/);
      expect(source).toMatch(paint);
    });
  }

  it("PriceBadge takes the band as a prop and paints the class family, or nothing", () => {
    const banded = renderToStaticMarkup(createElement(PriceBadge, { band: "expensive" }, "£6.50"));
    expect(banded).toMatch(/class="priceBadge priceBadge--neutral priceBand-expensive /);
    const bare = renderToStaticMarkup(createElement(PriceBadge, {}, "£6.50"));
    expect(bare).not.toContain("priceBand-");
  });

  it("a List view figure wears its band inside the compact price", () => {
    const html = renderToStaticMarkup(
      createElement(CompactVenuePrice, { priceLabel: "£4.20", anchor: null, band: "cheap" }),
    );
    expect(html).toContain('<span class="priceBand-cheap">£4.20</span>');
  });

  it("the hover card carries the band of a pint and none for an anchor", () => {
    const pub = { id: "venue-x", kind: "pub", cheapestPrice: 6.5, name: "X" } as unknown as Venue;
    expect(hoverCardCopy(pub, undefined, null).priceBand).toBe("expensive");
    const bar = { id: "venue-y", kind: "bar", cheapestPrice: 12, anchorLabel: "Cocktail" } as unknown as Venue;
    expect(hoverCardCopy(bar, undefined, null).priceBand).toBeNull();
  });

  it("the pin bucket, the legend and the band module agree on one £6.50", () => {
    expect(priceBucket(6.5)).toBe(2);
    expect(priceBand(6.5)).toBe("expensive");
    expect(orientationLegendRows()[2]).toMatchObject({ tone: "red", label: "Over £6.15" });
  });
});

describe("no colour comes from a trust standing", () => {
  it("leaves no tone-per-standing class, token or table anywhere in the tree", () => {
    const files: string[] = [];
    for (const dir of ["app", "components", "lib"]) walk(join(ROOT, dir), files);
    const banned = /trustPill-(green|amber|modelled|grey)|lpStanding-(green|amber|grey|modelled)|PRICE_STANDING_TONE|TRUST_PILL_TONE|data-tone="(green|amber|modelled)"/;
    const offenders = files
      .filter((file) => banned.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("keeps the plaque neutral until a band paints it", () => {
    const globals = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
    const plaque = /\.price-plaque \{[\s\S]*?\}/.exec(globals)?.[0] ?? "";
    expect(plaque).toContain("var(--price-band-ink, var(--badge-ink))");
    expect(plaque).toContain("var(--price-band-surface, var(--badge-surface))");
    expect(plaque).not.toContain("--accent-price");
  });
});
