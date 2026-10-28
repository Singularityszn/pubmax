import { beforeEach, describe, expect, it, vi } from "vitest";

// The stats route resolves boroughs from the server-only venue index. Stub it
// with a tiny fixture so the test never touches the bundled dataset on disk and
// the borough tally is deterministic. London-prefixed venue ids keep the drops
// on the default London city surface.
vi.mock("@/lib/venueIndex", () => ({
  getVenueIndex: async () =>
    new Map([
      ["venue-hack1", { id: "venue-hack1", name: "The Hackney", borough: "Hackney", lat: 51.5, lng: -0.05 }],
      ["venue-hack2", { id: "venue-hack2", name: "The Other Hackney", borough: "Hackney", lat: 51.5, lng: -0.05 }],
      ["venue-camd1", { id: "venue-camd1", name: "The Camden", borough: "Camden", lat: 51.53, lng: -0.14 }],
    ]),
}));

import { GET } from "@/app/api/pint-drops/stats/route";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import type { PintDrop } from "@/lib/pintDrops";
import { palYearFacts } from "@/lib/palYear";
import { buildYearInPintsShareText } from "@/lib/shareArtifacts";
import { parseYearShare, yearShareFrom, yearShareHeading, yearShareLines, yearShareQuery } from "@/lib/yearInPints";

const BASE = "http://localhost/api/pint-drops/stats";

function statsFor(handle?: string): Promise<Response> {
  const url = handle ? `${BASE}?handle=${encodeURIComponent(handle)}` : BASE;
  return GET(new Request(url));
}

function drop(partial: Partial<PintDrop> & Pick<PintDrop, "venueId">): void {
  addPintDrop({
    id: crypto.randomUUID(),
    handle: "statman",
    drink: "pint",
    priceGbp: 4.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date().toISOString(),
    ...partial,
  });
}

beforeEach(() => {
  __resetPintDrops();
  process.env.RATE_LIMIT_SALT = "test-salt";
});

describe("GET /api/pint-drops/stats", () => {
  it("400s (flat envelope) when no handle is supplied", async () => {
    const res = await statsFor();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "handle_required", retryable: false });
    expect(typeof body.error).toBe("string");
  });

  it("summarises a contributor's priced drops by borough", async () => {
    drop({ venueId: "venue-hack1", priceGbp: 4.5 });
    drop({ venueId: "venue-hack2", priceGbp: 5 });
    drop({ venueId: "venue-camd1", priceGbp: 6 });
    // A note-only anecdote — counts toward the streak, not the "pints mapped".
    drop({ venueId: "venue-camd1", priceGbp: null, provenance: "anecdote", passedDownNote: "my old local" });

    const res = await statsFor("statman");
    expect(res.status).toBe(200);
    const { stats } = await res.json();

    expect(stats.handle).toBe("statman");
    expect(stats.pintsMapped).toBe(3);
    expect(stats.total).toBe(4);
    expect(stats.byBorough).toEqual([
      { borough: "Hackney", count: 2 },
      { borough: "Camden", count: 1 },
    ]);
    expect(stats.streak.current).toBeGreaterThanOrEqual(1);
  });

  it("returns an empty summary for a handle with no drops", async () => {
    const res = await statsFor("nobody");
    expect(res.status).toBe(200);
    const { stats } = await res.json();
    expect(stats.pintsMapped).toBe(0);
    expect(stats.byBorough).toEqual([]);
    expect(stats.streak.current).toBe(0);
  });

  it("shares no prices in 2027 for twelve prices mapped only in 2026", async () => {
    for (let day = 1; day <= 12; day += 1) {
      drop({ venueId: "venue-hack1", createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z` });
    }
    const previous = await GET(new Request(`${BASE}?handle=statman&year=2026`));
    expect((await previous.json()).stats.pintsMapped).toBe(12);
    const response = await GET(new Request(`${BASE}?handle=statman&year=2027`));
    expect(response.status).toBe(200);
    const { stats } = await response.json();
    expect(stats).toMatchObject({ pintsMapped: 0, total: 0, byBorough: [] });
    const facts = palYearFacts({
      year: 2027, nightsKeptDays: ["2027-01-01"], crawls: [],
      contributions: { pricesMapped: stats.pintsMapped, boroughs: stats.byBorough.length },
    });
    const share = yearShareFrom(facts, new Set(["nights", "prices"]), "2027-12-31", {})!;
    expect(yearShareQuery(share)).toBe("to=12&n=1");
    expect(yearShareLines(parseYearShare("2027", new URLSearchParams(yearShareQuery(share)), "2027-12-31")!, {}))
      .toEqual(["One night out."]);
    expect(buildYearInPintsShareText({ heading: yearShareHeading(share), nights: share.nights, prices: share.prices?.count }))
      .toBe("My 2027 in pints: 1 night out. Read yours on PUBMAXX.");
  });

  it("filters both prices and boroughs by London contribution year", async () => {
    drop({ venueId: "venue-camd1", createdAt: "2026-12-31T23:59:59.000Z" });
    drop({ venueId: "venue-hack1", createdAt: "2027-01-01T00:00:00.000Z" });
    drop({ venueId: "venue-hack2", createdAt: "2027-12-31T23:59:59.000Z" });
    drop({ venueId: "venue-camd1", createdAt: "2028-01-01T00:00:00.000Z" });
    drop({ venueId: "venue-camd1", createdAt: "2027-06-01T12:00:00.000Z", priceGbp: null });
    const response = await GET(new Request(`${BASE}?handle=statman&year=2027`));
    expect(response.status).toBe(200);
    expect((await response.json()).stats).toMatchObject({
      pintsMapped: 2, total: 3, byBorough: [{ borough: "Hackney", count: 2 }],
    });
    const lifetime = await statsFor("statman");
    expect((await lifetime.json()).stats.pintsMapped).toBe(4);
  });

  it.each(["", "27", "2027junk", "2027.5"])("rejects an invalid year %j instead of returning lifetime totals", async (year) => {
    const response = await GET(new Request(`${BASE}?handle=statman&year=${year}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_year", retryable: false });
  });
});
