import { describe, expect, it } from "vitest";

import {
  LOG_IN_PUBLIC_DAY,
  logInPublicDayActive,
  logInPublicTime,
  pickLogInPublicDrops,
} from "@/lib/logInPublicDay";

// The Product Hunt "log in public" day shows only real, priced, public Pint
// Drops logged on that London day. A demo seed, an unpriced note, a friends-only
// drop or a drop from the day before must never reach it.

const DAY = "2026-11-17";

function drop(overrides: Record<string, unknown>) {
  return {
    id: "d1",
    handle: "@reader",
    priceGbp: 5.6,
    drink: "Guinness",
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    visibility: "public",
    venueId: "venue-abc",
    venueName: "The Crown",
    venueMapUrl: "/map?sel=venue-abc",
    createdAt: "2026-11-17T19:05:00.000Z",
    ...overrides,
  };
}

describe("the log in public day", () => {
  it("is set for the Product Hunt launch day", () => {
    expect(LOG_IN_PUBLIC_DAY).toBe("2026-11-17");
  });

  it("is active only on that London calendar day", () => {
    expect(logInPublicDayActive(new Date("2026-11-16T23:59:59.000Z"), DAY)).toBe(false);
    expect(logInPublicDayActive(new Date("2026-11-17T00:00:00.000Z"), DAY)).toBe(true);
    expect(logInPublicDayActive(new Date("2026-11-17T23:59:59.000Z"), DAY)).toBe(true);
    expect(logInPublicDayActive(new Date("2026-11-18T00:00:00.000Z"), DAY)).toBe(false);
  });

  it("follows London summer time, not UTC", () => {
    expect(logInPublicDayActive(new Date("2026-06-30T23:30:00.000Z"), "2026-07-01")).toBe(true);
    expect(logInPublicDayActive(new Date("2026-07-01T23:30:00.000Z"), "2026-07-01")).toBe(false);
  });

  it("is off when no day is set", () => {
    expect(logInPublicDayActive(new Date("2026-11-17T12:00:00.000Z"), null)).toBe(false);
  });
});

describe("the drops the day shows", () => {
  it("keeps only real priced public drops logged that London day, newest first", () => {
    const picked = pickLogInPublicDrops(
      {
        drops: [
          drop({ id: "early", createdAt: "2026-11-17T08:00:00.000Z" }),
          drop({ id: "late", createdAt: "2026-11-17T21:40:00.000Z", measure: "half" }),
          drop({ id: "anon", visibility: "anonymous", createdAt: "2026-11-17T12:00:00.000Z" }),
          drop({ id: "old-row", visibility: undefined, createdAt: "2026-11-17T13:00:00.000Z" }),
          drop({ id: "demo", provenance: "demo" }),
          drop({ id: "unpriced", priceGbp: null }),
          drop({ id: "zero", priceGbp: 0 }),
          drop({ id: "friends", visibility: "friends" }),
          drop({ id: "day-before", createdAt: "2026-11-16T23:59:00.000Z" }),
          drop({ id: "day-after", createdAt: "2026-11-18T00:01:00.000Z" }),
          drop({ id: "bad-date", createdAt: "not a date" }),
        ],
      },
      DAY,
    );
    expect(picked?.map((row) => row.id)).toEqual(["late", "old-row", "anon", "early"]);
    expect(picked?.[0]).toMatchObject({
      venueName: "The Crown",
      venueMapUrl: "/map?sel=venue-abc",
      drink: "Guinness",
      measure: "Half",
      priceGbp: 5.6,
      createdAt: "2026-11-17T21:40:00.000Z",
    });
    expect(picked?.[3]?.measure).toBe("Pint");
  });

  it("never prints a raw venue id or an unsafe link", () => {
    const [row] = pickLogInPublicDrops(
      { drops: [drop({ venueName: "", venueMapUrl: "https://elsewhere.example/x" })] },
      DAY,
    ) ?? [];
    expect(row?.venueName).toBe("A London pub");
    expect(row?.venueMapUrl.startsWith("/map")).toBe(true);
    expect(row?.venueMapUrl).toContain("venue-abc");
  });

  it("tells an empty day apart from a body it could not read", () => {
    expect(pickLogInPublicDrops({ drops: [] }, DAY)).toEqual([]);
    expect(pickLogInPublicDrops({ drops: [drop({ provenance: "demo" })] }, DAY)).toEqual([]);
    expect(pickLogInPublicDrops(null, DAY)).toBeNull();
    expect(pickLogInPublicDrops({ nope: true }, DAY)).toBeNull();
  });

  it("stamps each drop with its London clock time", () => {
    expect(logInPublicTime("2026-11-17T19:05:00.000Z")).toBe("19:05");
    expect(logInPublicTime("2026-07-01T18:05:00.000Z")).toBe("19:05");
  });
});
