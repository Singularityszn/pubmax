import { describe, expect, it } from "vitest";

import {
  CHEAPEST_NEAR_NO_ANCHOR,
  CROWD_REPORTS_NOT_ON_RECORD,
  FIND_DESK_NO_SEAT_DATA,
  OCCUPANCY_LEVELS,
  WORK_FRIENDLY_VENUE_KINDS,
  cheapestNearEmptyLine,
  cheapestNearHeadline,
  cheapestNearRowNote,
  CONCIERGE_TOOL_DEFINITIONS,
  findDeskEmptyLine,
  findDeskRowNote,
  isWorkFriendlyVenueKind,
  occupancyReportOutcome,
  occupancyStoreState,
  parseOccupancyLevel,
  splitTonightRowsByNow,
  tonightNowLine,
  venueDrinkRowNote,
  venueDrinksEmptyLine,
} from "@/lib/ask/conciergeTools";
import type { WhatsOnRow } from "@/lib/whatsOn";

function row(overrides: Partial<WhatsOnRow>): WhatsOnRow {
  return {
    id: overrides.id ?? "r1",
    placeName: overrides.placeName ?? "The Lamb",
    kind: overrides.kind ?? "quiz",
    title: overrides.title ?? "Quiz night",
    source: overrides.source ?? { label: "Venue site", url: "https://example.com" },
    observedAt: overrides.observedAt ?? "2026-08-15T10:00:00.000Z",
    confidence: overrides.confidence ?? "listed",
    ...overrides,
  } as WhatsOnRow;
}

describe("cheapest_pint_near policy", () => {
  it("never offers a viewer-position parameter", () => {
    const definition = CONCIERGE_TOOL_DEFINITIONS.find(
      (tool) => tool.function.name === "cheapest_pint_near",
    );
    const properties = Object.keys(
      (definition?.function.parameters as { properties: Record<string, unknown> })
        .properties,
    );
    expect(properties).not.toContain("lat");
    expect(properties).not.toContain("lng");
    expect(properties).toEqual(["venueId", "venueName", "area", "limit"]);
  });

  it("names the anchor it actually used", () => {
    expect(
      cheapestNearHeadline(
        { kind: "venue", venueId: "v1", name: "The Lamb", area: "Camden" },
        "walkable",
      ),
    ).toBe("Cheapest listed pints near The Lamb");
    expect(
      cheapestNearHeadline(
        { kind: "venue", venueId: "v1", name: "The Lamb", area: "Camden" },
        "widened",
      ),
    ).toBe("Nearest listed pints to The Lamb");
    expect(cheapestNearHeadline({ kind: "area", area: "Camden" }, "walkable")).toBe(
      "Cheapest listed pints in Camden",
    );
  });

  it("separates an empty area from a read that failed", () => {
    const anchor = { kind: "area", area: "Camden" } as const;
    expect(cheapestNearEmptyLine(anchor, "ready")).toContain("No listed pint prices");
    const failed = cheapestNearEmptyLine(anchor, "unavailable");
    expect(failed).toContain("couldn't read");
    expect(failed).not.toContain("No listed pint prices");
  });

  it("asks for an anchor rather than guessing at one", () => {
    expect(CHEAPEST_NEAR_NO_ANCHOR).toContain("listed pub");
    expect(CHEAPEST_NEAR_NO_ANCHOR).not.toMatch(/location|your position/i);
  });

  it("drops the walk when there is no distance to quote", () => {
    expect(cheapestNearRowNote({ area: "Camden", walkMinutes: 7 })).toBe(
      "Camden · 7 min walk",
    );
    expect(cheapestNearRowNote({ area: "Camden", walkMinutes: null })).toBe("Camden");
  });
});

describe("tonight_now policy", () => {
  it("splits rows on their own window", () => {
    const now = Date.parse("2026-08-15T20:30:00.000Z");
    const running = row({
      id: "running",
      startsAt: "2026-08-15T20:00:00.000Z",
      endsAt: "2026-08-15T22:00:00.000Z",
    });
    const upcoming = row({
      id: "upcoming",
      startsAt: "2026-08-15T21:30:00.000Z",
      endsAt: "2026-08-15T23:00:00.000Z",
    });
    const split = splitTonightRowsByNow([running, upcoming], now);
    expect(split.onNow.map((r) => r.id)).toEqual(["running"]);
    expect(split.later.map((r) => r.id)).toEqual(["upcoming"]);
  });

  it("treats a row with no start as not running", () => {
    const now = Date.parse("2026-08-15T20:30:00.000Z");
    const split = splitTonightRowsByNow([row({ id: "undated" })], now);
    expect(split.onNow).toHaveLength(0);
    expect(split.later.map((r) => r.id)).toEqual(["undated"]);
  });

  it("says plainly that no crowd report exists", () => {
    expect(CROWD_REPORTS_NOT_ON_RECORD).toMatch(/can't tell you what's quiet/);
  });

  it("separates a quiet city from a read that failed", () => {
    expect(tonightNowLine({ area: "Soho", onNow: 0, later: 0, read: "ready" })).toBe(
      "Nothing sourced in Soho for tonight.",
    );
    expect(
      tonightNowLine({ area: "Soho", onNow: 0, later: 0, read: "unavailable" }),
    ).toContain("couldn't read");
    expect(tonightNowLine({ area: null, onNow: 2, later: 3, read: "ready" })).toBe(
      "2 on right now, 3 still to start tonight.",
    );
  });
});

describe("venue_drinks policy", () => {
  it("separates an unlogged pub from a read that failed", () => {
    expect(venueDrinksEmptyLine("The Lamb", "ready")).toContain("No drink prices logged");
    expect(venueDrinksEmptyLine("The Lamb", "unavailable")).toContain("couldn't read");
  });

  it("says how far a figure reaches, per row", () => {
    expect(
      venueDrinkRowNote({ label: "Beer", day: "12 Aug", corroborated: true }),
    ).toContain("reaches the map");
    expect(
      venueDrinkRowNote({ label: "Wine", day: "12 Aug", corroborated: false }),
    ).toContain("stays on this pub's page");
  });
});

describe("find_desk policy", () => {
  it("answers only from work-friendly kinds, never a pub", () => {
    expect(WORK_FRIENDLY_VENUE_KINDS).toEqual(["cafe", "coworking", "library"]);
    expect(isWorkFriendlyVenueKind("pub")).toBe(false);
    expect(isWorkFriendlyVenueKind("bar")).toBe(false);
    expect(isWorkFriendlyVenueKind("cafe")).toBe(true);
    expect(isWorkFriendlyVenueKind(undefined)).toBe(false);
  });

  it("says no seat data yet rather than offering a pub", () => {
    expect(FIND_DESK_NO_SEAT_DATA).toContain("No seat data yet");
    expect(findDeskEmptyLine(null, "ready")).toBe(FIND_DESK_NO_SEAT_DATA);
    expect(findDeskEmptyLine("Angel", "ready")).toContain("Angel");
    expect(findDeskEmptyLine("Angel", "unavailable")).toContain("couldn't read");
  });

  it("admits what is missing on a row it did find", () => {
    expect(findDeskRowNote({ area: "Angel", kind: "coworking" })).toBe(
      "co-working space in Angel · no seat or wifi report on record",
    );
  });
});

describe("report_occupancy policy", () => {
  it("holds the three buttons R-011 names", () => {
    expect(OCCUPANCY_LEVELS).toEqual(["empty", "some-seats", "full"]);
  });

  it("reads plain speech into a level", () => {
    expect(parseOccupancyLevel("Full")).toBe("full");
    expect(parseOccupancyLevel("some seats")).toBe("some-seats");
    expect(parseOccupancyLevel("it's rammed")).toBe("full");
    expect(parseOccupancyLevel("dead in here")).toBe("empty");
    expect(parseOccupancyLevel("mustard")).toBeNull();
    expect(parseOccupancyLevel(7)).toBeNull();
  });

  it("ships with no crowd store, so nothing is written or promised", () => {
    expect(occupancyStoreState()).toBe("unbuilt");
    const outcome = occupancyReportOutcome({
      venueId: "v1",
      venueName: "The Lamb",
      level: "full",
      store: "unbuilt",
    });
    expect(outcome.status).toBe("store-unbuilt");
    expect(outcome.line).toContain("nowhere to land");
    expect(outcome.line).toContain("haven't saved it");
  });

  it("becomes a confirm-gated proposal the moment a store exists", () => {
    const outcome = occupancyReportOutcome({
      venueId: "v1",
      venueName: "The Lamb",
      level: "some seats",
      store: "ready",
    });
    expect(outcome.status).toBe("proposed");
    expect(outcome.line).toContain("Nothing is saved until you confirm.");
  });

  it("asks for the pub and the level rather than assuming either", () => {
    expect(
      occupancyReportOutcome({
        venueId: "",
        venueName: "",
        level: "full",
        store: "unbuilt",
      }).status,
    ).toBe("no-venue");
    expect(
      occupancyReportOutcome({
        venueId: "v1",
        venueName: "The Lamb",
        level: "mustard",
        store: "unbuilt",
      }).status,
    ).toBe("no-level");
  });
});
