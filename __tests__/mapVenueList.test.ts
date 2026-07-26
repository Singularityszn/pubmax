import { describe, it, expect } from "vitest";

import {
  buildMapVenueListModel,
  buildUkBasePubListModel,
  MAP_VENUE_LIST_LIMIT,
} from "@/lib/mapVenueList";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { Venue } from "@/lib/venues";

// Minimal Venue factory — only the fields the list model reads matter.
function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: 51.5,
    longitude: -0.12,
    cheapestPrice: null,
    ...overrides,
  } as Venue;
}

describe("buildMapVenueListModel — the list-toggle gate", () => {
  it("is honest-empty on no venues (empty list, no truncation)", () => {
    const model = buildMapVenueListModel([], [-0.12, 51.5]);
    expect(model.rows).toEqual([]);
    expect(model.total).toBe(0);
    expect(model.shown).toBe(0);
    expect(model.truncated).toBe(false);
  });

  it("reports the full on-map total when under the cap", () => {
    const venues = [venue({ id: "a" }), venue({ id: "b" }), venue({ id: "c" })];
    const model = buildMapVenueListModel(venues, null);
    expect(model.total).toBe(3);
    expect(model.shown).toBe(3);
    expect(model.truncated).toBe(false);
  });

  it("caps the list and flags truncation past the limit", () => {
    const venues = Array.from({ length: MAP_VENUE_LIST_LIMIT + 5 }, (_, i) =>
      venue({ id: `v${i}` }),
    );
    const model = buildMapVenueListModel(venues, [-0.12, 51.5]);
    expect(model.total).toBe(MAP_VENUE_LIST_LIMIT + 5);
    expect(model.shown).toBe(MAP_VENUE_LIST_LIMIT);
    expect(model.rows).toHaveLength(MAP_VENUE_LIST_LIMIT);
    expect(model.truncated).toBe(true);
  });

  it("honours a custom limit", () => {
    const venues = [venue({ id: "a" }), venue({ id: "b" }), venue({ id: "c" })];
    const model = buildMapVenueListModel(venues, null, 2);
    expect(model.shown).toBe(2);
    expect(model.truncated).toBe(true);
  });
});

describe("buildMapVenueListModel — ordering (mirrors the eye)", () => {
  it("orders nearest-first to the viewport centre and carries a distance", () => {
    const near = venue({ id: "near", latitude: 51.5, longitude: -0.12 });
    const far = venue({ id: "far", latitude: 51.7, longitude: -0.4 });
    // Input order is far, near — the model must re-sort to near, far.
    const model = buildMapVenueListModel([far, near], [-0.12, 51.5]);
    expect(model.rows.map((r) => r.id)).toEqual(["near", "far"]);
    expect(typeof model.rows[0].distanceKm).toBe("number");
    expect(model.rows[0].distanceKm!).toBeLessThan(model.rows[1].distanceKm!);
  });

  it("preserves filtered map order and omits distance without a viewport fix", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "a" }), venue({ id: "b" })],
      null,
    );
    expect(model.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(model.rows[0].distanceKm).toBeUndefined();
  });

  it("treats a non-finite viewport centre as no fix (no crash, input order)", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "a" }), venue({ id: "b" })],
      [Number.NaN, 51.5],
    );
    expect(model.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(model.rows[0].distanceKm).toBeUndefined();
  });
});

describe("buildMapVenueListModel — selection wiring + labels", () => {
  it("carries the real venue id every row's select handler needs", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "abc-123", name: "The Test Arms" })],
      null,
    );
    expect(model.rows[0].id).toBe("abc-123");
    expect(model.rows[0].name).toBe("The Test Arms");
  });

  it("formats an honest price label (known price vs TBD)", () => {
    const model = buildMapVenueListModel(
      [
        venue({ id: "priced", cheapestPrice: 4.5 }),
        venue({ id: "unknown", cheapestPrice: null }),
      ],
      null,
    );
    const byId = new Map(model.rows.map((r) => [r.id, r.priceLabel]));
    expect(byId.get("priced")).toBe("£4.50");
    expect(byId.get("unknown")).toBe("Price TBD");
  });
});

describe("buildUkBasePubListModel", () => {
  const basePubs: UkBasePub[] = [
    {
      id: "venue-uk-n-far",
      name: "Far Arms",
      address: "",
      lat: 53.9,
      lng: -1.8,
    },
    {
      id: "venue-uk-n-near",
      name: "Near Arms",
      address: "",
      lat: 53.8008,
      lng: -1.5491,
    },
  ];

  it("keeps rendered base pubs separate, bounded, and nearest-first", () => {
    const model = buildUkBasePubListModel(basePubs, [-1.5491, 53.8008], 1);

    expect(model.total).toBe(2);
    expect(model.shown).toBe(1);
    expect(model.truncated).toBe(true);
    expect(model.rows[0]).toMatchObject({
      id: "venue-uk-n-near",
      name: "Near Arms",
      priceLabel: "Unverified · no price",
      pub: basePubs[1],
    });
  });
});
