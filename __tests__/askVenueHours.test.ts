import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ venues: vi.fn(), detail: vi.fn(), schedules: vi.fn() }));
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: io.venues,
}));
vi.mock("@/lib/venueDetailIndex", () => ({ lookupVenueDetail: io.detail }));
vi.mock("@/lib/planRouteEvidence.server", () => ({ planOpeningSchedulesForVenues: io.schedules }));

import { runAsk } from "@/lib/ask/runAsk";
import { offlineFetch } from "@/evals/pal/offlineFetch";

const now = Date.parse("2026-10-22T18:00:00Z");
const site = {
  sourceUrl: "https://example.org/hours", readOn: "2026-10-20",
  hours: { hours: { 4: [{ opens: "12:00", closes: "23:00" }] }, statedDays: [4], evidence: "Thursday noon to 11pm" },
};
const ask = () => runAsk({ query: "What are the opening hours of Example Arms?", now, skipModel: true });

beforeEach(() => {
  io.venues.mockResolvedValue([{ id: "venue-example", name: "Example Arms", area: "Camden", lat: 51.5, lng: -0.1 }]);
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
  it.each([
    "What are The King's Arms' opening hours?",
    "What are The King's Arms's opening hours, please?",
    "What are the opening hours of The King's Arms, please?",
    "What are the opening hours of The King's Arms - JD Wetherspoon, please?",
    "What are The King’s Arms’ opening hours?",
    "What are the opening hours of The King's Arms and are there Tube delays?",
    "Are there Tube delays and what are The King's Arms's opening hours?",
  ])("preserves name words, internal apostrophes and source aliases: %s", async (query) => {
    io.venues.mockResolvedValue([{
      id: "venue-example", name: "The King's Arms", sourceName: "The King's Arms - JD Wetherspoon",
      area: "Camden", lat: 51.5, lng: -0.1,
    }]);
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: site } });
    const body = await runAsk({ query, now, skipModel: true, fetchImpl: offlineFetch });
    expect(body.answer).toContain("The King's Arms: recorded regular opening hours: Thursday 12:00 to 23:00");
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]?.venueId).toBe("venue-example");
    expect(body.sources[0]?.url).toBe(site.sourceUrl);
  });

  it("isolates the requested pub before reading details", async () => {
    io.venues.mockResolvedValue([
      { id: "blackfriar", name: "The Blackfriar", area: "City", lat: 51.5, lng: -0.1 },
      { id: "old-bell", name: "The Old Bell Tavern", area: "City", lat: 51.5, lng: -0.1 },
    ]);
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: site } });
    const body = await runAsk({
      query: "What are the opening hours of The Blackfriar near The Old Bell Tavern?", now, skipModel: true,
    });
    expect(body.cards.map((card) => card.venueId)).toEqual(["blackfriar"]);
    expect(io.detail).toHaveBeenCalledExactlyOnceWith("blackfriar");
  });

  it("preserves a conjunction inside the requested name", async () => {
    io.venues.mockResolvedValue([{ id: "venue-example", name: "Fox and Anchor", area: "City", lat: 51.5, lng: -0.1 }]);
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: site } });
    const body = await runAsk({ query: "What are the opening hours of Fox and Anchor and are there Tube delays?", now, skipModel: true, fetchImpl: offlineFetch });
    expect(body.answer).toContain("Fox and Anchor: recorded regular opening hours: Thursday 12:00 to 23:00");
    expect(body.cards.map((card) => card.venueId)).toContain("venue-example");
  });

  it.each([
    ["What are the opening hours of Erin's?", "erins"],
    ["What are Erin's opening hours?", "erins"],
    ["What are the opening hours of Erin's's?", "erins"],
    ["What are Erin's's opening hours?", "erins"],
    ["What are the opening hours at a pub called Erin's - Listed?", "erins"],
    ["What are the opening hours at a pub named Erin's - Listed's?", "erins"],
    ["What are the opening hours of Erin?", "erin"],
    ["What are the opening hours of Erin's and are there Tube delays?", "erins"],
    ["Are there Tube delays and what are Erin's's opening hours?", "erins"],
  ])("prefers complete names and aliases before possessives: %s", async (query, venueId) => {
    io.venues.mockResolvedValue([
      { id: "erins", name: "Erin's", sourceName: "Erin's - Listed", area: "City", lat: 51.5, lng: -0.1 },
      { id: "erin", name: "Erin", area: "Camden", lat: 51.5, lng: -0.1 },
    ]);
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: site } });
    const body = await runAsk({ query, now, skipModel: true, fetchImpl: offlineFetch });
    expect(body.cards.filter((card) => card.venueId).map((card) => card.venueId)).toEqual([venueId]);
    expect(io.detail).toHaveBeenCalledExactlyOnceWith(venueId);
  });

  it("rejects an ambiguous complete name before any detail or schedule read", async () => {
    io.venues.mockResolvedValue([
      { id: "erins-one", name: "Erin's", area: "City", lat: 51.5, lng: -0.1 },
      { id: "erins-two", name: "Erin's", area: "Camden", lat: 51.5, lng: -0.1 },
      { id: "erin", name: "Erin", area: "Camden", lat: 51.5, lng: -0.1 },
    ]);
    const body = await runAsk({ query: "What are the opening hours of Erin's?", now, skipModel: true });
    expect(body.cards).toEqual([]);
    expect(body.answer).toContain("Which pub do you mean?");
    expect(io.detail).not.toHaveBeenCalled();
    expect(io.schedules).not.toHaveBeenCalled();
  });

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
