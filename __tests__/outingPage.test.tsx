import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsOnRow } from "@/lib/whatsOn";

const state = vi.hoisted(() => ({
  outEvents: [] as WhatsOnRow[],
  outDay: null as string | null,
}));

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/night/SafeNightStrip", () => ({
  default: () => null,
  SafeNightStrip: () => (
    <a href="https://tfl.gov.uk/plan-a-journey/">Journey planner</a>
  ),
}));
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: async () => [],
}));
vi.mock("@/lib/out/loadOut", () => ({
  buildOutResponse: async (query: { day: string }) => {
    state.outDay = query.day;
    return { events: state.outEvents, listingsStatus: "ready" };
  },
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
});
