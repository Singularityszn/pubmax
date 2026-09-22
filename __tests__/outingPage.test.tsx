import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsOnRow } from "@/lib/whatsOn";

const state = vi.hoisted(() => ({
  outEvents: [] as WhatsOnRow[],
  outDay: null as string | null,
  venues: [] as import("@/lib/concierge/rank").ConciergeVenue[],
}));

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/night/SafeNightStrip", () => ({
  default: () => null,
  SafeNightStrip: () => (
    <a href="https://tfl.gov.uk/plan-a-journey/">Journey planner</a>
  ),
}));
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: async () => state.venues,
}));
vi.mock("@/lib/out/loadOut", () => ({
  buildOutResponse: async (query: { day: string }) => {
    state.outDay = query.day;
    return { events: state.outEvents, listingsStatus: "ready" };
  },
  loadServedOutEvents: async () => ({ rows: state.outEvents, readStatus: "ready" }),
}));
import OutingsPage, { metadata } from "@/app/outings/page";

function listing(overrides: Partial<WhatsOnRow>): WhatsOnRow {
  return {
    id: overrides.id ?? "listing",
    placeName: overrides.placeName ?? "The Camden Assembly",
    kind: overrides.kind ?? "music",
    title: overrides.title ?? "Shared Whats-On gig",
    source: overrides.source ?? {
      label: "Venue programme",
      url: "https://venue.example/gig",
    },
    observedAt: overrides.observedAt ?? "2026-09-22T12:00:00.000Z",
    confidence: overrides.confidence ?? "listed",
    ...overrides,
  } as WhatsOnRow;
}

describe("public outing browse", () => {
  beforeEach(() => {
    state.outEvents = [];
    state.outDay = null;
    state.venues = [];
  });

  it("stays out of the index while the recovery surface shares current listing lanes", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it("shows seven choices and keeps area/day in refinement without chat first", async () => {
    const html = renderToStaticMarkup(
      await OutingsPage({
        searchParams: Promise.resolve({
          occasion: "date",
          area: "Soho",
          day: "tomorrow",
        }),
      }),
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("Dancing");
    expect(html).toContain("Gardens");
    expect(html).toContain(encodeURIComponent("in Soho, tomorrow"));
    expect(html).toContain("No matching pubs");
    expect(html).toContain('data-primary-action="true"');
    expect(html).toContain("How these filters affect browse");
  });
  it("does not replace missing dance listings with pubs and offers a private home handoff", async () => {
    const html = renderToStaticMarkup(
      await OutingsPage({
        searchParams: Promise.resolve({ occasion: "dancing" }),
      }),
    );
    expect(html).toContain("No sourced dance nights");
    expect(html).toContain("https://tfl.gov.uk/plan-a-journey/");
  });

  it("browses sourced music and retains the chosen day in the Ask handoff", async () => {
    state.outEvents = [
      listing({
        id: "published-gig",
        kind: "event",
        title: "Published live music listing",
      }),
    ];

    const html = renderToStaticMarkup(
      await OutingsPage({
        searchParams: Promise.resolve({
          occasion: "music",
          area: "Camden",
          day: "tomorrow",
        }),
      }),
    );

    expect(html).toContain("Published live music listing");
    expect(html).toContain("https://venue.example/gig");
    expect(state.outDay).toBe("tomorrow");
    expect(html).toContain(encodeURIComponent("in Camden, tomorrow"));
  });

  it("keeps typed area, date, time, group, budget and alcohol constraints in Ask and Plan links", async () => {
    const html = renderToStaticMarkup(
      await OutingsPage({
        searchParams: Promise.resolve({
          occasion: "friends",
          area: "Soho",
          date: "2026-09-27",
          time: "19:30",
          groupSize: "6",
          budgetGbp: "35",
          alcohol: "none",
        }),
      }),
    );

    expect(html).toContain('name="date"');
    expect(html).toContain('name="time"');
    expect(html).toContain('name="groupSize"');
    expect(html).toContain('name="budgetGbp"');
    expect(html).toContain('name="alcohol"');
    expect(html).toContain("for+6+people");
    expect(html).toContain("groupSize=6");
    expect(html).toContain("budgetGbp=35");
    expect(html).toContain("alcohol=none");
    expect(html).not.toContain("four of us");
  });

  it("carries a dancing listing as a typed event stop and keeps home timing local", async () => {
    state.outEvents = [
      listing({
        id: "dance-event-42",
        kind: "event",
        title: "Disco after dark",
        placeName: "Camden Assembly",
        venueId: "venue-camden-assembly",
        startsAt: "2026-09-27T18:30:00.000Z",
        endsAt: "2026-09-27T21:30:00.000Z",
        priceGbp: 12,
        source: { label: "Ticket publisher", url: "https://tickets.example/dance-event-42" },
      }),
      listing({
        id: "other-time-event",
        kind: "event",
        title: "Later disco after dark",
        placeName: "Camden Assembly",
        startsAt: "2026-09-27T19:30:00.000Z",
      }),
    ];

    const html = renderToStaticMarkup(
      await OutingsPage({
        searchParams: Promise.resolve({
          occasion: "dancing",
          area: "Camden",
          date: "2026-09-27",
          time: "19:30",
        }),
      }),
    );

    expect(html).toContain("Plan around this event");
    expect(html).toContain("dance-event-42");
    expect(html).not.toContain("other-time-event");
    expect(html).toContain("https%3A%2F%2Ftickets.example%2Fdance-event-42");
    expect(html).toContain("2026-09-27T18%3A30%3A00.000Z");
    expect(html).toContain("2026-09-27T21%3A30%3A00.000Z");
    expect(html).toContain("admissionGbp=12");
    expect(html).toContain("Add pubs before or after the event");
    expect(html).toContain("name=\"homeTime\"");
    expect(html).not.toMatch(/href="[^"]*homeTime/);
  });

  it("shows dated price provenance, explicit missing prices and garden weather gaps", async () => {
    state.venues = [
      {
        id: "venue-xjf3n0", name: "Arnos Arms", area: "Arnos Grove", lat: 51.61, lng: -0.13,
        cheapestPrice: 5.5, amenities: { beerGarden: true, cocktails: false, food: true, liveMusic: false, liveSports: false },
        nearWater: false, hasStory: false, canonical: true,
      },
      {
        id: "unpriced-venue", name: "Unpriced Garden", area: "Soho", lat: 51.51, lng: -0.13,
        cheapestPrice: null, amenities: { beerGarden: true, cocktails: false, food: true, liveMusic: false, liveSports: false },
        nearWater: false, hasStory: false, canonical: true,
      },
    ];

    const html = renderToStaticMarkup(
      await OutingsPage({
        searchParams: Promise.resolve({ occasion: "gardens", area: "London" }),
      }),
    );

    expect(html).toContain("£5.50");
    expect(html).toContain("Source reviewed");
    expect(html).toContain("https://www.pint-prices.com/pub/");
    expect(html).toContain("No price recorded");
    expect(html).toContain("Weather not checked for Arnos Grove");
  });
});
