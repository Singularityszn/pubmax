import { describe, expect, it } from "vitest";

import {
  areaCoverageLabel,
  areaElsewhereOptions,
  areaUnderCentre,
  buildAreaSheetModel,
  cheapestPintsInArea,
  formatAreaDistance,
} from "@/lib/areaButton";
import { getNightArea } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

// Minimal Venue factory — only the fields the area models read matter. Mirrors
// the house pattern in __tests__/mapVenueList.test.ts.
function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: 51.5,
    longitude: -0.12,
    cheapestPrice: null,
    latestContributorPrice: null,
    ...overrides,
  } as Venue;
}

describe("areaUnderCentre — the live centre label", () => {
  it("names the area whose region contains the map centre", () => {
    const soho = getNightArea("piccadilly-soho");
    const area = areaUnderCentre("london", [soho.centre.lng, soho.centre.lat]);
    expect(area?.slug).toBe("piccadilly-soho");
  });

  it("falls back to the nearest area when the centre is between regions", () => {
    // Far out over the North Sea — inside no region; nearest area still returned.
    const area = areaUnderCentre("london", [0.6, 51.5]);
    expect(area).not.toBeNull();
    expect(area?.cityId).toBe("london");
  });

  it("prefers the nearer centre when two regions overlap the point", () => {
    // A point nudged from Islington toward King's Cross stays on the nearer one.
    const islington = getNightArea("islington");
    const area = areaUnderCentre("london", [
      islington.centre.lng,
      islington.centre.lat,
    ]);
    expect(area?.slug).toBe("islington");
  });

  it("returns null for non-finite coordinates and unmodelled cities", () => {
    expect(areaUnderCentre("london", [Number.NaN, 51.5])).toBeNull();
    // A city with no modelled Night Areas resolves to null, not a wrong guess.
    expect(areaUnderCentre("bath", [-2.36, 51.38])).toBeNull();
  });
});

describe("formatAreaDistance — honest, direct register", () => {
  it("reads close distances in metres and far ones in kilometres", () => {
    expect(formatAreaDistance(0)).toBe("right here");
    expect(formatAreaDistance(0.05)).toBe("right here");
    expect(formatAreaDistance(0.42)).toBe("420 m away");
    expect(formatAreaDistance(1.25)).toBe("1.3 km away");
  });

  it("returns empty for a non-finite or negative distance", () => {
    expect(formatAreaDistance(Number.NaN)).toBe("");
    expect(formatAreaDistance(-1)).toBe("");
  });
});

describe("cheapestPintsInArea — ranking + fail-soft pricing", () => {
  const soho = getNightArea("piccadilly-soho");
  const inArea = (id: string, extra: Partial<Venue> = {}) =>
    venue({
      id,
      latitude: soho.centre.lat + 0.001,
      longitude: soho.centre.lng + 0.001,
      ...extra,
    });

  it("ranks verified-priced pubs cheapest first", () => {
    const venues = [
      inArea("dear", { cheapestPrice: 7.2 }),
      inArea("cheap", { cheapestPrice: 4.5 }),
      inArea("mid", { cheapestPrice: 5.9 }),
    ];
    const rows = cheapestPintsInArea(soho, venues, [
      soho.centre.lng,
      soho.centre.lat,
    ]);
    expect(rows.map((r) => r.id)).toEqual(["cheap", "mid", "dear"]);
    expect(rows[0].priceLabel).toBe("£4.50");
  });

  it("prefers a contributor's verified price over the baseline", () => {
    const venues = [
      inArea("baseline", { cheapestPrice: 5.0 }),
      inArea("dropped", { cheapestPrice: 6.0, latestContributorPrice: 4.2 }),
    ];
    const rows = cheapestPintsInArea(soho, venues, [
      soho.centre.lng,
      soho.centre.lat,
    ]);
    expect(rows[0].id).toBe("dropped");
    expect(rows[0].priceLabel).toBe("£4.20");
  });

  it("keeps unpriced pubs after priced ones and fails their price soft", () => {
    const venues = [
      inArea("unpriced", { cheapestPrice: null }),
      inArea("priced", { cheapestPrice: 5.5 }),
    ];
    const rows = cheapestPintsInArea(soho, venues, [
      soho.centre.lng,
      soho.centre.lat,
    ]);
    expect(rows.map((r) => r.id)).toEqual(["priced", "unpriced"]);
    expect(rows[1].priceLabel).toBe("no priced pints yet");
    expect(rows[1].cheapestPrice).toBeNull();
  });

  it("excludes venues outside the area radius and caps the list", () => {
    const near = Array.from({ length: 12 }, (_, i) =>
      inArea(`near-${i}`, { cheapestPrice: 4 + i * 0.1 }),
    );
    const faraway = venue({
      id: "faraway",
      latitude: 51.9,
      longitude: -0.02,
      cheapestPrice: 1.0,
    });
    const rows = cheapestPintsInArea(
      soho,
      [...near, faraway],
      [soho.centre.lng, soho.centre.lat],
    );
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => r.id === "faraway")).toBe(false);
  });
});

describe("areaCoverageLabel + areaElsewhereOptions — honest evidence", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("shows no warning for a route-ready area", () => {
    expect(areaCoverageLabel(getNightArea("clapham"), now)).toBeNull();
  });

  it("labels warned areas the way the plan intake does", () => {
    expect(areaCoverageLabel(getNightArea("shoreditch"), now)).toEqual({
      label: "Plan with warnings",
      tone: "capture",
    });
    expect(areaCoverageLabel(getNightArea("dalston"), now)).toEqual({
      label: "Low confidence",
      tone: "discovery",
    });
    expect(areaCoverageLabel(getNightArea("richmond"), now)).toEqual({
      label: "Review expired",
      tone: "paused",
    });
  });

  it("lists every modelled London area with a fly-to centre", () => {
    const options = areaElsewhereOptions("london", now);
    expect(options.length).toBeGreaterThanOrEqual(20);
    const clapham = options.find((o) => o.slug === "clapham");
    expect(clapham?.center).toEqual([
      getNightArea("clapham").centre.lng,
      getNightArea("clapham").centre.lat,
    ]);
    expect(clapham?.coverage).toBeNull();
  });
});

describe("buildAreaSheetModel — the whole sheet in one derivation", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("is fail-soft when the centre resolved to no area", () => {
    const model = buildAreaSheetModel("london", null, [], [-0.13, 51.51], now);
    expect(model.areaName).toBe("");
    expect(model.pubs).toEqual([]);
    expect(model.elsewhere.length).toBeGreaterThanOrEqual(20);
  });

  it("names the area and derives its pubs when one is resolved", () => {
    const soho = getNightArea("piccadilly-soho");
    const venues = [
      venue({
        id: "a",
        latitude: soho.centre.lat,
        longitude: soho.centre.lng,
        cheapestPrice: 5.1,
      }),
    ];
    const model = buildAreaSheetModel(
      "london",
      soho,
      venues,
      [soho.centre.lng, soho.centre.lat],
      now,
    );
    expect(model.areaName).toBe("Piccadilly & Soho");
    expect(model.pubs).toHaveLength(1);
    expect(model.pubs[0].priceLabel).toBe("£5.10");
  });
});
