import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isVenueUnpriced } from "@/lib/firstDropNudge";
import {
  venuePriceLane,
  venueSourcedPrice,
  type VenuePriceLaneName,
} from "@/lib/venuePriceLane";
import type { PricedVenue } from "@/lib/priceUpdates";
import type { Venue } from "@/lib/venues";

const ROOT = process.cwd();

// Minimal Venue factory (same shape the other map tests use). Defaults are the
// fully-unpriced pub so each fixture overrides only the field it exercises.
function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-1",
    name: "The Test Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Barking and Dagenham",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...overrides,
  } as Venue;
}

const SOURCED: PricedVenue["sourcedPrice"] = {
  provenance: "sourced",
  sourceLabel: "pub.example",
  sourceUrl: "https://pub.example",
  observedAt: "2026-01-01",
};

function withSourced(venue: Venue): Venue {
  (venue as PricedVenue).sourcedPrice = SOURCED;
  return venue;
}

// One fixture per branch the overview price area can take, plus the empty case
// the first-drop nudge fills. `contributor` is the price passed in beside the
// venue, exactly as the render component receives it as a prop.
const FIXTURES: ReadonlyArray<{
  name: string;
  venue: Venue;
  contributor: number | null | undefined;
  lane: VenuePriceLaneName | null;
}> = [
  {
    name: "unpriced pub — nothing on record",
    venue: makeVenue(),
    contributor: null,
    lane: null,
  },
  {
    name: "unpriced pub — contributor undefined rather than null",
    venue: makeVenue(),
    contributor: undefined,
    lane: null,
  },
  {
    name: "unpriced non-pub carrying an anchor label but no figure",
    venue: makeVenue({ kind: "restaurant", anchorLabel: "Cheapest beer" }),
    contributor: null,
    lane: null,
  },
  {
    name: "contributor price wins over everything below it",
    venue: withSourced(makeVenue({ cheapestPrice: 6.2 })),
    contributor: 5.4,
    lane: "contributor",
  },
  {
    name: "a zero contributor price is still a price",
    venue: makeVenue(),
    contributor: 0,
    lane: "contributor",
  },
  {
    name: "sourced price wins over the baseline",
    venue: withSourced(makeVenue({ cheapestPrice: 6.2 })),
    contributor: null,
    lane: "sourced",
  },
  {
    name: "sourced price with no baseline behind it",
    venue: withSourced(makeVenue()),
    contributor: null,
    lane: "sourced",
  },
  {
    name: "baseline dataset price alone",
    venue: makeVenue({ cheapestPrice: 6.2 }),
    contributor: null,
    lane: "baseline",
  },
  {
    name: "non-pub anchor claim beats the baseline wording",
    venue: makeVenue({
      kind: "restaurant",
      anchorLabel: "Cheapest beer",
      cheapestPrice: 6.2,
    }),
    contributor: null,
    lane: "anchor",
  },
  {
    name: "a pub is never an anchor, however it is labelled",
    venue: makeVenue({ anchorLabel: "Cheapest beer", cheapestPrice: 6.2 }),
    contributor: null,
    lane: "baseline",
  },
];

describe("venuePriceLane — one precedence for the overview price area", () => {
  it.each(FIXTURES)("picks the $lane lane for $name", ({ venue, contributor, lane }) => {
    const decided = venuePriceLane(venue, contributor, venueSourcedPrice(venue));
    expect(decided?.lane ?? null).toBe(lane);
  });

  it("agrees with the first-drop gate on every fixture", () => {
    // #1413: isVenueUnpriced used to restate this ordering by hand, so a lane
    // added or reordered in the render component would leave the nudge behind.
    for (const { name, venue, contributor, lane } of FIXTURES) {
      expect(isVenueUnpriced(venue, contributor), name).toBe(lane === null);
    }
  });

  it("carries the figure its branch prints, so the render re-tests nothing", () => {
    // The lane is a discriminated union rather than a bare name: the overview
    // branches used to narrow `latestContributorPrice` and `sourcedPrice`
    // themselves, which is the restated precedence this module replaces.
    const contributor = venuePriceLane(makeVenue(), 5.4, null);
    expect(contributor).toEqual({ lane: "contributor", contributorPrice: 5.4 });

    const sourcedVenue = withSourced(makeVenue());
    expect(venuePriceLane(sourcedVenue, null, venueSourcedPrice(sourcedVenue))).toEqual({
      lane: "sourced",
      sourcedPrice: SOURCED,
    });

    expect(venuePriceLane(makeVenue({ cheapestPrice: 6.2 }), null, null)).toEqual({
      lane: "baseline",
      cheapestPrice: 6.2,
    });

    const anchored = makeVenue({
      kind: "restaurant",
      anchorLabel: "Cheapest beer",
      cheapestPrice: 6.2,
    });
    expect(venuePriceLane(anchored, null, null)).toEqual({
      lane: "anchor",
      anchorLabel: "Cheapest beer",
      cheapestPrice: 6.2,
    });
  });

  it("covers every lane plus the empty case", () => {
    const covered = new Set(FIXTURES.map((fixture) => fixture.lane));
    expect(covered).toEqual(new Set(["anchor", "contributor", "sourced", "baseline", null]));
  });
});

describe("VenueOverviewTab renders from the shared lane", () => {
  const overview = readFileSync(
    join(ROOT, "components/map/inspector/VenueOverviewTab.tsx"),
    "utf8",
  );

  it("branches on venuePriceLane rather than restating the precedence", () => {
    expect(overview).toContain('from "@/lib/venuePriceLane"');
    expect(overview).toContain(
      "const lane = venuePriceLane(venue, latestContributorPrice, sourcedPrice);",
    );
    for (const lane of ["anchor", "contributor", "sourced", "baseline"]) {
      expect(overview, `price area must branch on the ${lane} lane`).toContain(
        `if (lane?.lane === "${lane}") {`,
      );
    }
  });

  it("keeps the first-drop nudge in the branch the lane leaves empty", () => {
    const summaryStart = overview.indexOf("function VenuePriceSummary(");
    const summaryEnd = overview.indexOf("export default function VenueOverviewTab");
    expect(summaryStart).toBeGreaterThan(-1);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    const summary = overview.slice(summaryStart, summaryEnd);

    // The nudge is the fall-through, after the last lane branch has returned.
    const lastLaneBranch = summary.lastIndexOf('if (lane?.lane === "');
    expect(summary.indexOf("<FirstDropNudge")).toBeGreaterThan(lastLaneBranch);

    // And the summary must not hand-roll the precedence beside the lane call.
    expect(summary).not.toMatch(
      /if \(\s*latestContributorPrice !== null && latestContributorPrice !== undefined\s*\)/,
    );
    expect(summary).not.toMatch(/if \(sourcedPrice\) \{/);

    // The branches print the figure the lane decided on, not the raw props.
    expect(summary).toContain("{formatPrice(lane.contributorPrice)}");
    expect(summary).toContain("href={lane.sourcedPrice.sourceUrl}");
  });
});
