import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { WeeklyOpeningHours } from "@/lib/busyness";
import { haversineMeters } from "@/lib/greatCircle.mjs";
import { parseOsmOpeningHours } from "@/lib/nearDesk";
import { omitVerifiedClosedPubs } from "@/lib/verifiedClosedPubs";
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
  osmHoursAgreeWithPlaces,
  osmRefFromLayerId,
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
  "openingHours",
  "periods",
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
      decideIdOnlyPlaceMatch(["places/ChIJabcdefghij123456"]),
    ).toEqual({ outcome: "matched", placeId: "ChIJabcdefghij123456" });
  });

  it("skips when the circle is empty", () => {
    expect(decideIdOnlyPlaceMatch([])).toEqual({ outcome: "skipped", reason: "no_result" });
  });

  it("skips two different place ids instead of guessing", () => {
    expect(
      decideIdOnlyPlaceMatch(["ChIJabcdefghij123456", "ChIJzyxwvutsrq123456"]),
    ).toEqual({ outcome: "skipped", reason: "ambiguous" });
  });

  it("treats the same place id twice as one match", () => {
    expect(
      decideIdOnlyPlaceMatch(["ChIJabcdefghij123456", "places/ChIJabcdefghij123456"]),
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
    const hidden = omitVerifiedClosedPubs(pubs, new Set(["n222", "w333"]));
    expect(hidden.map((pub) => pub.id)).toEqual(["venue-uk-n111"]);
    expect(pubs).toHaveLength(3);
    expect(osmRefFromLayerId("venue-osm-n222")).toBe("n222");
  });

  it("does not hide a pub the verification skipped", () => {
    expect(omitVerifiedClosedPubs(pubs, new Set())).toEqual(pubs);
    expect(omitVerifiedClosedPubs(pubs)).toEqual(pubs);
  });
});

describe("cafe hours are checked, never copied", () => {
  it("reads period points into weekly windows for the comparison", () => {
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

  it("agrees when every OSM day matches Google, including a midnight close", () => {
    const places = weeklyHoursFromPlacesPeriods(
      [1, 2, 3, 4, 5].map((day) => ({
        open: { day, hour: 8, minute: 0 },
        close: { day: (day + 1) % 7, hour: 0, minute: 0 },
      })),
    );
    expect(places).not.toBeNull();
    expect(
      osmHoursAgreeWithPlaces(parseOsmOpeningHours("Mo-Fr 08:00-24:00"), places as WeeklyOpeningHours),
    ).toBe(true);
  });

  it("disagrees when one day differs or OSM has no hours", () => {
    const places: WeeklyOpeningHours = {
      0: [{ opens: "07:30", closes: "16:30" }],
      1: [{ opens: "06:30", closes: "18:00" }],
    };
    expect(osmHoursAgreeWithPlaces(parseOsmOpeningHours("Mo 06:30-18:00"), places)).toBe(false);
    expect(
      osmHoursAgreeWithPlaces(parseOsmOpeningHours("Mo 06:30-18:00; Su 07:30-16:30"), places),
    ).toBe(true);
    expect(osmHoursAgreeWithPlaces(parseOsmOpeningHours(""), places)).toBe(false);
  });

  it("stores only the place id, our verdict and the day", () => {
    expect(cafeVerificationRow("venue-osm-n9", "ChIJabcdefghij123456", false, "2026-10-03")).toEqual({
      venueId: "venue-osm-n9",
      googlePlaceId: "ChIJabcdefghij123456",
      osmHoursAgree: false,
      verifiedAt: "2026-10-03",
    });
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

  it("keeps each cafe row to the place id, our hours verdict and the day", () => {
    const cafes = JSON.parse(
      readFileSync(path.join(ROOT, "data/places_verification/shoreditch_cafes.json"), "utf8"),
    ) as { rows: Record<string, unknown>[] };
    expect(cafes.rows.length).toBeGreaterThan(0);
    for (const row of cafes.rows) {
      expect(Object.keys(row).sort()).toEqual(["googlePlaceId", "osmHoursAgree", "venueId", "verifiedAt"]);
      expect(typeof row.osmHoursAgree).toBe("boolean");
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
