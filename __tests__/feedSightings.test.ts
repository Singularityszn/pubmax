// Hermetic coverage for the feed's ambient sightings (lib/feedSightings.ts):
// the pure mapping from drink price updates → sightings, and the placement
// logic that decides where they sit relative to real user drops. No fetch, no
// fs, no serverEnv — every fixture is built inline.

import { describe, expect, it } from "vitest";

import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import {
  buildSightings,
  formatSightingPrice,
  SIGHTINGS_CAP,
  sightingPlacement,
  sourceDomain,
  type ResolveSightingVenue,
} from "@/lib/feedSightings";

// Minimal valid DrinkPriceUpdate; overrides customise a single field per test.
function update(overrides: Partial<DrinkPriceUpdate> = {}): DrinkPriceUpdate {
  return {
    venueKey: "the churchill arms|119 kensington church st|51.50700|-0.19400",
    drinkName: "Doom Bar",
    category: "beer",
    priceGbp: 5.29,
    source: {
      label: "J D Wetherspoon — official site",
      url: "https://www.jdwetherspoon.com/pubs/the-example",
      licence: "Attributed use only.",
    },
    observedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

// A resolver that echoes a deterministic venue from the grouping key's first
// segment, so the mapping is checkable without the real venue index.
const echoResolve: ResolveSightingVenue = (venueKey) => {
  const name = venueKey.split("|")[0] ?? "a pub";
  const venueId = `venue-${name.replace(/\s+/g, "")}`;
  return { venueId, venueName: name, venueMapUrl: `/map?sel=${venueId}` };
};

describe("sourceDomain", () => {
  it("strips www and lowercases the host", () => {
    expect(sourceDomain("https://www.JDWetherspoon.com/x")).toBe("jdwetherspoon.com");
  });

  it("keeps a bare host untouched", () => {
    expect(sourceDomain("https://facebook.com/thepub")).toBe("facebook.com");
  });

  it("returns '' for an unparseable or empty url", () => {
    expect(sourceDomain("not a url")).toBe("");
    expect(sourceDomain("")).toBe("");
  });
});

describe("formatSightingPrice", () => {
  it("renders two decimals with a pound sign", () => {
    expect(formatSightingPrice(5)).toBe("£5.00");
    expect(formatSightingPrice(6.8)).toBe("£6.80");
  });
});

describe("buildSightings mapping", () => {
  it("maps one update to one sighting with resolved venue + source fields", () => {
    const [s] = buildSightings([update()], echoResolve);
    expect(s).toMatchObject({
      venueName: "the churchill arms",
      venueMapUrl: "/map?sel=venue-thechurchillarms",
      drink: "Doom Bar",
      priceGbp: 5.29,
      priceLabel: "£5.29",
      sourceLabel: "J D Wetherspoon — official site",
      sourceDomain: "jdwetherspoon.com",
      observedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(s.id).toBe("sighting-venue-thechurchillarms");
  });

  it("keeps ONE sighting per venue — the freshest observation", () => {
    const out = buildSightings(
      [
        update({ drinkName: "Old", observedAt: "2026-07-01T00:00:00.000Z", priceGbp: 4.5 }),
        update({ drinkName: "Fresh", observedAt: "2026-07-10T00:00:00.000Z", priceGbp: 6.2 }),
      ],
      echoResolve,
    );
    expect(out).toHaveLength(1);
    expect(out[0].drink).toBe("Fresh");
  });

  it("breaks an identical-timestamp tie by the cheaper price", () => {
    const out = buildSightings(
      [
        update({ drinkName: "Pricey", priceGbp: 7.5 }),
        update({ drinkName: "Cheap", priceGbp: 4.2 }),
      ],
      echoResolve,
    );
    expect(out).toHaveLength(1);
    expect(out[0].drink).toBe("Cheap");
  });

  it("drops rows with no positive price or no attributable source", () => {
    const out = buildSightings(
      [
        update({ venueKey: "free|a|1|1", priceGbp: 0 }),
        update({ venueKey: "neg|b|2|2", priceGbp: -3 }),
        update({ venueKey: "nosrc|c|3|3", source: { label: "x", url: "not a url", licence: "y" } }),
        update({ venueKey: "good|d|4|4", priceGbp: 5.1 }),
      ],
      echoResolve,
    );
    expect(out).toHaveLength(1);
    expect(out[0].venueName).toBe("good");
  });

  it("orders newest observation first, venue name breaking ties", () => {
    const out = buildSightings(
      [
        update({ venueKey: "zulu|a|1|1", observedAt: "2026-07-05T00:00:00.000Z" }),
        update({ venueKey: "alpha|b|2|2", observedAt: "2026-07-09T00:00:00.000Z" }),
        update({ venueKey: "bravo|c|3|3", observedAt: "2026-07-09T00:00:00.000Z" }),
      ],
      echoResolve,
    );
    expect(out.map((s) => s.venueName)).toEqual(["alpha", "bravo", "zulu"]);
  });

  it("caps the output (default SIGHTINGS_CAP)", () => {
    const many = Array.from({ length: SIGHTINGS_CAP + 8 }, (_, i) =>
      update({
        venueKey: `pub${String(i).padStart(2, "0")}|a|1|1`,
        observedAt: `2026-07-${String((i % 27) + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    expect(buildSightings(many, echoResolve)).toHaveLength(SIGHTINGS_CAP);
    expect(buildSightings(many, echoResolve, { cap: 3 })).toHaveLength(3);
  });

  it("skips a venue the resolver cannot resolve (returns null)", () => {
    const out = buildSightings(
      [update({ venueKey: "known|a|1|1" }), update({ venueKey: "unknown|b|2|2" })],
      (key) => (key.startsWith("known") ? echoResolve(key) : null),
    );
    expect(out).toHaveLength(1);
    expect(out[0].venueName).toBe("known");
  });

  it("returns [] for no updates", () => {
    expect(buildSightings([], echoResolve)).toEqual([]);
  });
});

describe("sightingPlacement", () => {
  const base = {
    tab: "london",
    filter: "latest" as const,
    status: "ready" as const,
    userItemCount: 0,
    sightingCount: 5,
  };

  it("is 'primary' on the London tab when ready with sightings and no user drops", () => {
    expect(sightingPlacement(base)).toBe("primary");
  });

  it("is 'strip' when user drops exist alongside sightings", () => {
    expect(sightingPlacement({ ...base, userItemCount: 3 })).toBe("strip");
  });

  it("is 'none' with no sightings, whatever the user count", () => {
    expect(sightingPlacement({ ...base, sightingCount: 0 })).toBe("none");
    expect(sightingPlacement({ ...base, sightingCount: 0, userItemCount: 4 })).toBe("none");
  });

  it("is 'none' off the London tab", () => {
    expect(sightingPlacement({ ...base, tab: "lot" })).toBe("none");
    expect(sightingPlacement({ ...base, tab: "nearby" })).toBe("none");
  });

  it("is 'none' when the London feed is filtered to Yours", () => {
    expect(sightingPlacement({ ...base, filter: "for-you" })).toBe("none");
  });

  it("is 'none' while loading or errored (never masks those states)", () => {
    expect(sightingPlacement({ ...base, status: "loading" })).toBe("none");
    expect(sightingPlacement({ ...base, status: "error" })).toBe("none");
  });
});
