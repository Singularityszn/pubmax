import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { WeeklyOpeningHours } from "@/lib/busyness";
import { haversineMeters } from "@/lib/greatCircle.mjs";
import { applyVerifiedCafeHours } from "@/lib/verifiedCafeHours";
import { hideVerifiedClosedPubs } from "@/lib/verifiedClosedPubs";
import {
  PLACES_CAFE_DETAILS_FIELD_MASK,
  PLACES_MATCH_RADIUS_METERS,
  PLACES_PUB_DETAILS_FIELD_MASK,
  PLACES_TEXT_SEARCH_FIELD_MASK,
  PLACES_VERIFY_JOB_CAP_USD,
  cafeVerificationRow,
  decideIdOnlyPlaceMatch,
  matchRectangle,
  isInShoreditchCoffeeBox,
  omitVerifiedClosedPubs,
  osmRefFromLayerId,
  placeWithinMatchRadius,
  projectedPlacesSpendUsd,
  textQueryForOsmVenue,
  weeklyHoursFromPlacesPeriods,
} from "@/lib/placesVerification";

const ROOT = path.resolve(__dirname, "..");
const FORBIDDEN_KEYS = [
  "displayName",
  "formattedAddress",
  "weekdayDescriptions",
  "businessStatus",
  "regularOpeningHours",
  "rating",
  "reviews",
  "userRatingCount",
  "priceLevel",
  "editorialSummary",
  "googleMapsUri",
  "photos",
];

function forbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) forbiddenKeys(item, found);
    return found;
  }
  if (typeof value !== "object" || value === null) return found;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key)) found.push(key);
    forbiddenKeys(child, found);
  }
  return found;
}

describe("Places id-only match", () => {
  it("matches the single place id inside the search radius", () => {
    expect(
      decideIdOnlyPlaceMatch([{ placeId: "places/ChIJabcdefghij123456", distanceMeters: null }]),
    ).toEqual({ outcome: "matched", placeId: "ChIJabcdefghij123456" });
  });

  it("skips when the circle is empty", () => {
    expect(decideIdOnlyPlaceMatch([])).toEqual({ outcome: "skipped", reason: "no_result" });
  });

  it("skips two different place ids instead of guessing", () => {
    expect(
      decideIdOnlyPlaceMatch([
        { placeId: "ChIJabcdefghij123456", distanceMeters: 20 },
        { placeId: "ChIJzyxwvutsrq123456", distanceMeters: 40 },
      ]),
    ).toEqual({ outcome: "skipped", reason: "ambiguous" });
  });

  it("treats the same place id twice as one match", () => {
    expect(
      decideIdOnlyPlaceMatch([
        { placeId: "ChIJabcdefghij123456", distanceMeters: 10 },
        { placeId: "places/ChIJabcdefghij123456", distanceMeters: 10 },
      ]),
    ).toEqual({ outcome: "matched", placeId: "ChIJabcdefghij123456" });
  });

  it("keeps the search rectangle inside the match circle", () => {
    const lat = 51.525;
    const lng = -0.08;
    const box = matchRectangle(lat, lng);
    const corners = [
      [box.low.latitude, box.low.longitude],
      [box.low.latitude, box.high.longitude],
      [box.high.latitude, box.low.longitude],
      [box.high.latitude, box.high.longitude],
    ] as const;
    for (const [cornerLat, cornerLng] of corners) {
      expect(haversineMeters(lat, lng, cornerLat, cornerLng)).toBeLessThanOrEqual(
        PLACES_MATCH_RADIUS_METERS + 0.05,
      );
    }
  });

  it("rejects a place past the match radius", () => {
    expect(placeWithinMatchRadius(PLACES_MATCH_RADIUS_METERS)).toBe(true);
    expect(placeWithinMatchRadius(PLACES_MATCH_RADIUS_METERS + 1)).toBe(false);
    expect(
      decideIdOnlyPlaceMatch([
        { placeId: "ChIJabcdefghij123456", distanceMeters: PLACES_MATCH_RADIUS_METERS + 1 },
      ]),
    ).toEqual({ outcome: "skipped", reason: "no_result" });
  });

  it("queries by name and postcode, and by coordinates when OSM has no postcode", () => {
    expect(
      textQueryForOsmVenue({
        name: "The Crown",
        address: "12 High Street, London EC2A 3AY",
        lat: 51.525,
        lng: -0.08,
      }),
    ).toBe("The Crown EC2A 3AY");
    expect(
      textQueryForOsmVenue({
        name: "The Crown",
        address: "12 High Street",
        lat: 51.52512,
        lng: -0.08123,
      }),
    ).toBe("The Crown 51.52512 -0.08123");
  });
});

describe("verified closed pubs stay out of the drawable set", () => {
  const pubs = [
    { id: "venue-uk-n111", name: "Open Arms" },
    { id: "venue-uk-n222", name: "Gone Arms" },
    { id: "venue-osm-w333", name: "Also Gone" },
  ];

  it("hides permanently closed refs and leaves every other row", () => {
    const hidden = hideVerifiedClosedPubs(pubs, new Set(["n222", "w333"]));
    expect(hidden.map((pub) => pub.id)).toEqual(["venue-uk-n111"]);
    expect(pubs).toHaveLength(3);
    expect(osmRefFromLayerId("venue-osm-n222")).toBe("n222");
  });

  it("does not hide a pub the verification skipped", () => {
    expect(omitVerifiedClosedPubs(pubs, new Set())).toEqual(pubs);
  });
});

describe("derived cafe hours", () => {
  it("turns period points into our weekly windows and drops hours text", () => {
    const hours = weeklyHoursFromPlacesPeriods([
      {
        open: { day: 1, hour: 8, minute: 0 },
        close: { day: 1, hour: 17, minute: 30 },
      },
      {
        open: { day: 5, hour: 18, minute: 0 },
        close: { day: 6, hour: 0, minute: 30 },
      },
    ]);
    expect(hours?.[1]).toEqual([{ opens: "08:00", closes: "17:30" }]);
    expect(hours?.[5]).toEqual([{ opens: "18:00", closes: "00:30" }]);
    expect(hours?.[0]).toEqual([]);
    expect(JSON.stringify(hours)).not.toContain("weekday");
  });

  it("refuses a period that spans more than overnight", () => {
    expect(
      weeklyHoursFromPlacesPeriods([
        {
          open: { day: 1, hour: 8, minute: 0 },
          close: { day: 3, hour: 8, minute: 0 },
        },
      ]),
    ).toBeNull();
  });

  it("stores hours for an open cafe and only the closure flag when it has gone", () => {
    const open = cafeVerificationRow({
      venueId: "venue-osm-n9",
      googlePlaceId: "ChIJabcdefghij123456",
      verifiedAt: "2026-10-03",
      closedPermanently: false,
      openingHours: { 1: [{ opens: "08:00", closes: "17:00" }] },
    });
    expect(open?.openingHours?.[1]).toEqual([{ opens: "08:00", closes: "17:00" }]);
    expect(open).not.toHaveProperty("closedPermanently");
    expect(
      cafeVerificationRow({
        venueId: "venue-osm-n9",
        googlePlaceId: "ChIJabcdefghij123456",
        verifiedAt: "2026-10-03",
        closedPermanently: true,
        openingHours: null,
      }),
    ).toEqual({
      venueId: "venue-osm-n9",
      googlePlaceId: "ChIJabcdefghij123456",
      verifiedAt: "2026-10-03",
      closedPermanently: true,
    });
    expect(
      cafeVerificationRow({
        venueId: "venue-osm-n9",
        googlePlaceId: "ChIJabcdefghij123456",
        verifiedAt: "2026-10-03",
        closedPermanently: false,
        openingHours: null,
      }),
    ).toBeNull();
  });

  it("overlays verified hours onto the matching desk venue only", () => {
    const hours: WeeklyOpeningHours = { 1: [{ opens: "08:00", closes: "16:00" }] };
    const venues = [
      { id: "venue-osm-n1", openingHours: null },
      { id: "venue-osm-n2", openingHours: { 2: [{ opens: "09:00", closes: "12:00" }] } },
    ];
    const next = applyVerifiedCafeHours(venues, new Map([["venue-osm-n1", hours]]));
    expect(next[0]?.openingHours).toEqual(hours);
    expect(next[1]?.openingHours).toEqual(venues[1]?.openingHours);
  });
});

describe("Shoreditch coffee box and spend cap", () => {
  it("includes the pilot box and excludes a pub-shaped point outside it", () => {
    expect(isInShoreditchCoffeeBox(51.525, -0.078)).toBe(true);
    expect(isInShoreditchCoffeeBox(51.5, -0.078)).toBe(false);
  });

  it("prices the full sweep at zero while the free caps still cover it", () => {
    const projected = projectedPlacesSpendUsd({
      proCalls: 3650,
      enterpriseCalls: 61,
      proAlreadyUsed: 148,
      enterpriseAlreadyUsed: 148,
    });
    expect(projected).toBe(0);
    expect(projected).toBeLessThanOrEqual(PLACES_VERIFY_JOB_CAP_USD);
  });

  it("stops when Place Details Pro would pass the job cap", () => {
    const projected = projectedPlacesSpendUsd({
      proCalls: 3650,
      enterpriseCalls: 0,
      proAlreadyUsed: 5000,
    });
    expect(projected).toBeGreaterThan(PLACES_VERIFY_JOB_CAP_USD);
  });

  it("keeps the field masks on the free and narrowest paid SKUs", () => {
    expect(PLACES_TEXT_SEARCH_FIELD_MASK).toBe("places.id");
    expect(PLACES_PUB_DETAILS_FIELD_MASK).toBe("businessStatus");
    expect(PLACES_CAFE_DETAILS_FIELD_MASK).toBe("businessStatus,regularOpeningHours.periods");
  });
});

describe("committed Places verification files", () => {
  it("stores our fields only", () => {
    for (const file of [
      "data/places_verification/london.json",
      "data/places_verification/closed_pubs.json",
      "data/places_verification/shoreditch_cafes.json",
    ]) {
      const parsed = JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as unknown;
      expect(forbiddenKeys(parsed), file).toEqual([]);
    }
  });

  it("lists exactly the pubs marked permanently closed", () => {
    const ledger = JSON.parse(
      readFileSync(path.join(ROOT, "data/places_verification/london.json"), "utf8"),
    ) as { pubs?: { venueId?: string; closedPermanently?: boolean }[] };
    const closed = JSON.parse(
      readFileSync(path.join(ROOT, "data/places_verification/closed_pubs.json"), "utf8"),
    ) as { osmRefs?: string[] };
    const fromLedger = (ledger.pubs ?? [])
      .filter((row) => row.closedPermanently === true)
      .map((row) => osmRefFromLayerId(row.venueId ?? ""))
      .filter((ref): ref is string => ref !== null)
      .sort();
    expect([...(closed.osmRefs ?? [])].sort()).toEqual(fromLedger);
  });
});
