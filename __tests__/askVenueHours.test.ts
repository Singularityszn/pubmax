import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ detail: vi.fn(), schedules: vi.fn() }));
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: async () => [{ id: "venue-example", name: "Example Arms", area: "Camden", lat: 51.5, lng: -0.1 }],
}));
vi.mock("@/lib/venueDetailIndex", () => ({ lookupVenueDetail: io.detail }));
vi.mock("@/lib/planRouteEvidence.server", () => ({ planOpeningSchedulesForVenues: io.schedules }));

import { runAsk } from "@/lib/ask/runAsk";

const now = Date.parse("2026-10-22T18:00:00Z");
const site = {
  sourceUrl: "https://example.org/hours", readOn: "2026-10-20",
  hours: { hours: { 4: [{ opens: "12:00", closes: "23:00" }] }, statedDays: [4], evidence: "Thursday noon to 11pm" },
};
const ask = () => runAsk({ query: "What are the opening hours of Example Arms?", now, skipModel: true });

beforeEach(() => {
  io.detail.mockResolvedValue({ status: "found", venue: {} });
  io.schedules.mockResolvedValue(new Map());
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Hours tests must stay offline."); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("recorded opening-hours sources", () => {
  it("keeps Google's own hours and date ahead of website hours", async () => {
    io.detail.mockResolvedValue({ status: "found", venue: {
      siteFacts: site,
      placesContent: { regularOpeningHours: {
        source: "google_places", observedAt: "2026-10-21T12:00:00Z",
        value: { periods: [{ open: { day: 4, hour: 11, minute: 0 }, close: { day: 4, hour: 22, minute: 0 } }] },
      } },
    } });
    const body = await ask();
    expect(body.answer).toContain("Thursday 11:00 to 22:00");
    expect(body.answer).not.toContain("12:00 to 23:00");
    expect(body.cards[0]?.provenance?.label).toBe("Google Places. Checked 2026-10-21");
  });

  it("reads a current website record when Google has no hours", async () => {
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: site } });
    const body = await ask();
    expect(body.answer).toContain("Thursday 12:00 to 23:00");
    expect(body.cards[0]?.provenance?.url).toBe(site.sourceUrl);
  });

  it("uses the existing directory schedule with its own source", async () => {
    io.schedules.mockResolvedValue(new Map([["venue-example", {
      venueListedOpen: true, ranges: [{ weekday: "Thursday", startsAt: "10:00", endsAt: "23:30" }],
      source: { label: "J D Wetherspoon - pub directory", url: site.sourceUrl, observedAt: "2026-10-20T12:00:00Z" },
    }]]));
    const body = await ask();
    expect(body.answer).toContain("Thursday 10:00 to 23:30");
    expect(body.cards[0]?.provenance?.label).toBe("J D Wetherspoon - pub directory. Checked 2026-10-20");
  });

  it.each(["2020-01-01", "2030-01-01"])("refuses website hours dated %s", async (readOn) => {
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: { ...site, readOn } } });
    const body = await ask();
    expect(body.answer).toBe("Opening hours for Example Arms are not known from a current record.");
    expect(body.sources).toEqual([]);
  });

  it("distinguishes an unavailable record from missing hours", async () => {
    io.detail.mockResolvedValue({ status: "unavailable" });
    const body = await ask();
    expect(body.status).toBe("degraded");
    expect(body.answer).toBe("I couldn't check the opening hours for Example Arms.");
    expect(body.cards).toEqual([]);
  });

  it("reports a failed read without inventing hours", async () => {
    io.detail.mockRejectedValue(new Error("read failed"));
    const body = await ask();
    expect(body.status).toBe("degraded");
    expect(body.answer).toContain("I couldn't check the opening hours.");
    expect(body.cards).toEqual([]);
  });
});
