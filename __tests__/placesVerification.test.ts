import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { WeeklyOpeningHours } from "@/lib/busyness";
import { haversineMeters } from "@/lib/greatCircle.mjs";
import { parseOsmOpeningHours } from "@/lib/nearDesk";
import { omitClosedCuratedVenues, omitVerifiedClosedPubs } from "@/lib/verifiedClosedPubs";
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
  OSM_HOURS_VERDICTS,
  osmHoursVerdict,
  curatedVenueIdsForClosedOsmRefs,
  mergeClosedOsmRefs,
  osmRefFromLayerId,
  placesNameMatchesOsm,
  placesRequestWithinBudget,
  restoreQuotasUntilVerified,
  resumedDetailsBaseline,
  pubClosureVerdict,
  projectedPlacesSpendUsd,
  textQueryForOsmVenue,
  weeklyHoursFromPlacesPeriods,
} from "@/lib/placesVerification";
import { defined } from "@/__tests__/helpers/defined";

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

describe("a pub is closed only on a name-confirmed match", () => {
  it("closes a pub when Google says closed and the names match", () => {
    expect(pubClosureVerdict("CLOSED_PERMANENTLY", "The Crown & Anchor", "Crown and Anchor")).toBe("closed");
    expect(placesNameMatchesOsm("The Queen's Head", "Queens Head")).toBe(true);
  });

  it("sends a closed listing with another name to review instead of hiding the pub", () => {
    expect(pubClosureVerdict("CLOSED_PERMANENTLY", "Crown & Anchor", "The Crown")).toBe("closed_unconfirmed");
    expect(pubClosureVerdict("CLOSED_PERMANENTLY", "The Crown", null)).toBe("closed_unconfirmed");
    expect(pubClosureVerdict("CLOSED_PERMANENTLY", "", "")).toBe("closed_unconfirmed");
  });

  it("treats every other status as open", () => {
    expect(pubClosureVerdict("OPERATIONAL", "The Crown", "The Crown")).toBe("open");
    expect(pubClosureVerdict("CLOSED_TEMPORARILY", "The Crown", "The Crown")).toBe("open");
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

  it("reads Google's always-open shape as open all seven days", () => {
    const places = weeklyHoursFromPlacesPeriods([{ open: { day: 0, hour: 0, minute: 0 } }]);
    for (let day = 0; day < 7; day += 1) {
      expect(places?.[day]).toEqual([{ opens: "00:00", closes: "24:00" }]);
    }
    expect(osmHoursVerdict(parseOsmOpeningHours("24/7"), places as WeeklyOpeningHours)).toBe("agree");
  });

  it("refuses an unclosed period that is not the always-open shape", () => {
    expect(weeklyHoursFromPlacesPeriods([{ open: { day: 2, hour: 0, minute: 0 } }])).toBeNull();
    expect(
      weeklyHoursFromPlacesPeriods([
        { open: { day: 0, hour: 0, minute: 0 } },
        { open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
      ]),
    ).toBeNull();
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
      osmHoursVerdict(parseOsmOpeningHours("Mo-Fr 08:00-24:00"), places as WeeklyOpeningHours),
    ).toBe("agree");
  });

  it("disagrees only when OSM has readable hours that differ on a day", () => {
    const places: WeeklyOpeningHours = {
      0: [{ opens: "07:30", closes: "16:30" }],
      1: [{ opens: "06:30", closes: "18:00" }],
    };
    expect(osmHoursVerdict(parseOsmOpeningHours("Mo 06:30-18:00"), places)).toBe("disagree");
    expect(
      osmHoursVerdict(parseOsmOpeningHours("Mo 06:30-18:00; Su 07:30-16:30"), places),
    ).toBe("agree");
  });

  it("keeps a cafe with no readable OSM hours out of the disagreements", () => {
    const places: WeeklyOpeningHours = { 1: [{ opens: "06:30", closes: "18:00" }] };
    expect(osmHoursVerdict(parseOsmOpeningHours(""), places)).toBe("no_osm_hours");
    expect(osmHoursVerdict(parseOsmOpeningHours("by appointment"), places)).toBe("no_osm_hours");
  });

  it("stores only the place id, our verdict and the day", () => {
    expect(cafeVerificationRow("venue-osm-n9", "ChIJabcdefghij123456", "disagree", "2026-10-03")).toEqual({
      venueId: "venue-osm-n9",
      googlePlaceId: "ChIJabcdefghij123456",
      osmHoursVerdict: "disagree",
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
    expect(PLACES_PUB_DETAILS_FIELD_MASK).toBe("businessStatus,displayName");
    expect(PLACES_CAFE_DETAILS_FIELD_MASK).toBe("businessStatus,regularOpeningHours.periods");
    const ledger = JSON.parse(
      readFileSync(path.join(ROOT, "data/places_verification/london.json"), "utf8"),
    ) as { spend: { skus: { fieldMask: string }[] } };
    expect(ledger.spend.skus.map((sku) => sku.fieldMask)).toEqual([
      PLACES_TEXT_SEARCH_FIELD_MASK,
      PLACES_PUB_DETAILS_FIELD_MASK,
      PLACES_CAFE_DETAILS_FIELD_MASK,
    ]);
  });
});

describe("committed Places verification files", () => {
  it("keeps the resumable checkpoint and temp writes out of git", () => {
    const ignored = execFileSync(
      "git",
      [
        "check-ignore",
        "--no-index",
        "data/places_verification/progress.json",
        "data/places_verification/progress.json.tmp",
        "data/places_verification/london.json.tmp",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(ignored.trim().split("\n")).toHaveLength(3);
  });

  it("keeps verdict-only verification files separate from the dated content lane", () => {
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
      expect(Object.keys(row).sort()).toEqual(["googlePlaceId", "osmHoursVerdict", "venueId", "verifiedAt"]);
      expect(OSM_HOURS_VERDICTS).toContain(row.osmHoursVerdict);
    }
  });

  it("commits cafe verdicts once and keeps only their counts in the ledger", () => {
    const ledger = JSON.parse(
      readFileSync(path.join(ROOT, "data/places_verification/london.json"), "utf8"),
    ) as { cafes?: unknown; summary: Record<string, number> };
    const cafes = JSON.parse(
      readFileSync(path.join(ROOT, "data/places_verification/shoreditch_cafes.json"), "utf8"),
    ) as { rows: { osmHoursVerdict: string }[] };
    const count = (verdict: string) => cafes.rows.filter((row) => row.osmHoursVerdict === verdict).length;
    expect(ledger).not.toHaveProperty("cafes");
    expect(ledger.summary.cafesVerified).toBe(cafes.rows.length);
    expect(ledger.summary.cafesOsmHoursAgree).toBe(count("agree"));
    expect(ledger.summary.cafesOsmHoursDisagree).toBe(count("disagree"));
    expect(ledger.summary.cafesNoOsmHours).toBe(count("no_osm_hours"));
  });

  it("keeps pub closure only in closed_pubs.json", () => {
    const ledger = JSON.parse(
      readFileSync(path.join(ROOT, "data/places_verification/london.json"), "utf8"),
    ) as { pubs: Record<string, unknown>[]; summary: Record<string, number> };
    expect(ledger).not.toHaveProperty("closedForReview");
    for (const row of ledger.pubs) {
      expect(Object.keys(row).sort()).toEqual(["googlePlaceId", "venueId", "verifiedAt"]);
    }
    expect(defined(ledger.summary.closedPermanently) + defined(ledger.summary.closedUnconfirmed))
      .toBeLessThanOrEqual(defined(ledger.summary.pubsVerified));
  });

  it("keeps closed_pubs.json a sorted set of OSM refs and their curated owners", () => {
    const closed = JSON.parse(
      readFileSync(path.join(ROOT, "data/places_verification/closed_pubs.json"), "utf8"),
    ) as { verifiedAt: string; osmRefs: string[]; curatedVenueIds: string[] };
    const sortedSet = (values: string[]) => [...new Set(values)].sort();
    expect(Object.keys(closed).sort()).toEqual(["curatedVenueIds", "osmRefs", "verifiedAt"]);
    expect(closed.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(closed.osmRefs).toEqual(sortedSet(closed.osmRefs));
    for (const ref of closed.osmRefs) expect(ref).toMatch(/^[nwr]\d+$/);
    expect(closed.curatedVenueIds).toEqual(sortedSet(closed.curatedVenueIds));
    for (const id of closed.curatedVenueIds) expect(id).toMatch(/^venue-/);
    if (closed.osmRefs.length === 0) expect(closed.curatedVenueIds).toEqual([]);
  });
});

describe("closed pubs stay hidden across a partial rerun", () => {
  it("keeps a prior closure the new run did not re-check", () => {
    expect(mergeClosedOsmRefs({
      previous: ["n1", "n2"],
      confirmedClosed: ["w9"],
      confirmedOperational: [],
    })).toEqual(["n1", "n2", "w9"]);
  });

  it("drops a prior closure only after a name-matched operational result", () => {
    expect(mergeClosedOsmRefs({
      previous: ["n1", "n2"],
      confirmedClosed: [],
      confirmedOperational: ["n1"],
    })).toEqual(["n2"]);
  });

  it("keeps a name-matched permanent closure over an operational claim for the same ref", () => {
    expect(mergeClosedOsmRefs({
      previous: [],
      confirmedClosed: ["n1"],
      confirmedOperational: ["n1"],
    })).toEqual(["n1"]);
  });

  it("resolves the curated owner of a closed OSM ref and leaves every other owner", () => {
    const ids = curatedVenueIdsForClosedOsmRefs(
      [
        { osmRef: "n1", curatedVenueId: "venue-owner" },
        { osmRef: "n2", curatedVenueId: "venue-open" },
        { osmRef: "n3", curatedVenueId: "" },
      ],
      new Set(["n1", "n3"]),
    );
    expect(ids).toEqual(["venue-owner"]);
    expect(omitClosedCuratedVenues(
      [{ id: "venue-owner" }, { id: "venue-open" }],
      new Set(ids),
    )).toEqual([{ id: "venue-open" }]);
  });

  it("retries quota restoration and clears nothing until both limits match", async () => {
    const seen: string[] = [];
    await expect(restoreQuotasUntilVerified({
      attempts: 2,
      expectedSearch: "100",
      expectedDetails: "60",
      attempt: async () => {
        seen.push("try");
        if (seen.length === 1) throw new Error("transient");
        return { search: "100", details: "60" };
      },
    })).resolves.toEqual({ search: "100", details: "60" });
    await expect(restoreQuotasUntilVerified({
      attempts: 1,
      expectedSearch: "100",
      expectedDetails: "60",
      attempt: async () => ({ search: "500", details: "500" }),
    })).rejects.toThrow(/mismatch/);
  });
});

describe("a UK Details run resumes within its cap", () => {
  it("resumes from the checkpoint baseline once monitoring counts the job's own attempts", () => {
    const checkpoint = { checkpointPrior: 4130, checkpointAttempts: 12 };
    expect(resumedDetailsBaseline({ measured: 4142, ...checkpoint })).toBe(4130);
    expect(() => resumedDetailsBaseline({ measured: 4135, ...checkpoint })).toThrow(/checkpoint usage differs/);
    expect(() => resumedDetailsBaseline({ measured: 4143, ...checkpoint })).toThrow(/checkpoint usage differs/);
    expect(resumedDetailsBaseline({ measured: 4130 })).toBe(4130);
  });

  it("refuses lagged usage that can mask another client's requests", () => {
    expect(() => resumedDetailsBaseline({
      measured: 4700, // 4,130 baseline + 500 reflected own attempts + 70 foreign calls
      checkpointPrior: 4130,
      checkpointAttempts: 1000,
    })).toThrow(/checkpoint usage differs/);
  });

  it("skips a venue when a retry would pass the cap instead of failing the job", async () => {
    let reserved = 0;
    const statuses: number[] = [];
    await expect(placesRequestWithinBudget({
      attempts: 4,
      pace: async () => {},
      reserve: () => {
        if (reserved === 1) return false;
        reserved += 1;
        return true;
      },
      release: () => {},
      send: async () => {
        statuses.push(429);
        return { status: 429, body: {} };
      },
      backoff: async () => {},
    })).resolves.toBeNull();
    expect(statuses).toEqual([429]);
  });

  it("records nothing for an attempt interrupted while it waits for its pacing slot", async () => {
    let openSlot = () => {};
    const slot = new Promise<void>((resolve) => {
      openSlot = resolve;
    });
    let reserved = 0;
    let sent = 0;
    const request = placesRequestWithinBudget({
      attempts: 4,
      pace: () => slot,
      reserve: () => {
        reserved += 1;
        return true;
      },
      release: () => {},
      send: async () => {
        sent += 1;
        return { status: 200, body: { id: "p1" } };
      },
      backoff: async () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect({ reserved, sent }).toEqual({ reserved: 0, sent: 0 });
    openSlot();
    await expect(request).resolves.toEqual({ id: "p1" });
    expect({ reserved, sent }).toEqual({ reserved: 1, sent: 1 });
  });

  it("releases an attempt whose connection was refused before the request was sent", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));
    let reserved = 0;
    await expect(placesRequestWithinBudget({
      attempts: 4,
      pace: async () => {},
      reserve: () => {
        reserved += 1;
        return true;
      },
      release: () => {
        reserved -= 1;
      },
      send: async () => {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        return { status: response.status, body: {} };
      },
      backoff: async () => {},
    })).rejects.toThrow("fetch failed");
    expect(reserved).toBe(0);
  });

  it("keeps an attempt reserved when a sent request times out", async () => {
    const hanging = createServer(() => {});
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const { port } = hanging.address() as AddressInfo;
    let reserved = 0;
    try {
      await expect(placesRequestWithinBudget({
        attempts: 4,
        pace: async () => {},
        reserve: () => {
          reserved += 1;
          return true;
        },
        release: () => {
          reserved -= 1;
        },
        send: async () => {
          const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(50) });
          return { status: response.status, body: {} };
        },
        backoff: async () => {},
      })).rejects.toThrow();
      expect(reserved).toBe(1);
    } finally {
      hanging.closeAllConnections();
      await new Promise((resolve) => hanging.close(resolve));
    }
  });

  it("retries a throttled request and still fails on another HTTP error", async () => {
    const replies: { status: number; body: { id?: string } }[] = [
      { status: 503, body: {} },
      { status: 200, body: { id: "p1" } },
    ];
    await expect(placesRequestWithinBudget({
      attempts: 4,
      pace: async () => {},
      reserve: () => true,
      release: () => {},
      send: async () => replies.shift()!,
      backoff: async () => {},
    })).resolves.toEqual({ id: "p1" });
    await expect(placesRequestWithinBudget({
      attempts: 4,
      pace: async () => {},
      reserve: () => true,
      release: () => {},
      send: async () => ({ status: 500, body: {} }),
      backoff: async () => {},
    })).rejects.toThrow("Places HTTP 500");
  });
});
