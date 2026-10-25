// @vitest-environment jsdom

import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TonightClient from "@/app/tonight/TonightClient";
import { fetchThingsToDo } from "@/lib/citymcp/client";
import { buildOutVenueMatchIndex } from "@/lib/out/venueMatch";
import { loadOutVenueMatchIndex } from "@/lib/out/venueMatch.server";
import { loadTodayWhatsOnAnswer } from "@/lib/todayListings.server";
import { __resetWhatsOnLiveTopUp, type LoadWhatsOnResult } from "@/lib/whatsOnStore";

const listingStore = vi.hoisted(() => ({ readAll: vi.fn() }));
vi.mock("@/lib/whatsOnListingStore", () => ({
  whatsOnListingStore: () => listingStore,
}));
vi.mock("@/lib/citymcp/client", () => ({ fetchThingsToDo: vi.fn() }));
vi.mock("@/lib/out/venueMatch.server", () => ({ loadOutVenueMatchIndex: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));

const NOW = Date.parse("2026-10-16T17:00:00Z");
const OBSERVED = "2026-10-16T09:00:00Z";
const independent = {
  id: "independent-quiz",
  venueId: "venue-quiz",
  placeName: "The Fixture Arms",
  kind: "quiz" as const,
  startsAt: "2026-10-16T18:00:00Z",
  endsAt: "2026-10-16T21:00:00Z",
  title: "Friday pub quiz",
  source: { label: "The Fixture Arms", url: "https://example.com/quiz" },
  observedAt: OBSERVED,
  confidence: "listed" as const,
};
const whatsOn: LoadWhatsOnResult = {
  rows: [independent],
  readStatus: "ready",
  servedAt: new Date(NOW).toISOString(),
  revalidation: { status: "measured" },
  sourceObservedAt: OBSERVED,
  sourceFreshnessKind: "provider-observed",
  kindObservedAt: { quiz: OBSERVED },
  localityBasis: "london-default",
  asOf: OBSERVED,
};
const out = {
  body: { status: "not-configured" as const, events: [], observedAt: {}, reason: "No listings available." },
  failed: false,
  pending: false,
};

function documentFor(answer: LoadWhatsOnResult | null) {
  return renderToStaticMarkup(createElement(TonightClient, {
    initialListings: { whatsOn: answer, out, renderedAt: NOW },
    mapSelectableVenueIds: ["venue-quiz"],
  }));
}

describe("Tonight's server listing composition", () => {
  const nonPub = {
    ...independent,
    id: "theatre-quiz",
    venueId: "venue-theatre",
    placeName: "Fixture Theatre",
    title: "Theatre quiz",
  };

  beforeEach(() => {
    __resetWhatsOnLiveTopUp();
    vi.mocked(loadOutVenueMatchIndex).mockReset().mockResolvedValue(buildOutVenueMatchIndex([
      { id: "venue-quiz", name: independent.placeName, borough: "Camden", lat: 51.5, lng: -0.1 },
    ]));
    listingStore.readAll.mockReset().mockResolvedValue({
      rows: [nonPub, independent], generatedAt: OBSERVED,
    });
    vi.mocked(fetchThingsToDo).mockReset().mockResolvedValue({
      window: "tonight", asOf: OBSERVED, opportunities: [],
    });
  });

  afterEach(() => {
    __resetWhatsOnLiveTopUp();
    vi.restoreAllMocks();
  });

  it("server-renders an eligible pub quiz and excludes a non-pub before the limit", async () => {
    const answer = await loadTodayWhatsOnAnswer(NOW, { pubOnly: true, limit: 1 });

    expect(answer?.rows.map((row) => row.id)).toEqual(["independent-quiz"]);
    expect(answer?.readStatus).toBe("ready");
    expect(answer?.kindObservedAt.quiz).toBe("2026-10-16T09:00:00.000Z");
    expect(loadOutVenueMatchIndex).toHaveBeenCalledWith("london");
    const html = documentFor(answer);
    expect(html).toContain("Friday pub quiz");
    expect(html).toContain("via The Fixture Arms");
    expect(html).not.toContain("Theatre quiz");
  });

  it("matches live pub rows through the same index and excludes live non-pub rows", async () => {
    listingStore.readAll.mockResolvedValue({ rows: [], generatedAt: OBSERVED });
    vi.mocked(fetchThingsToDo).mockResolvedValue({
      window: "tonight", asOf: OBSERVED,
      opportunities: [independent.placeName, "Fixture Theatre"].map((name) => ({
        title: `${name} live music`, kind: "gig", startsAt: independent.startsAt,
        place: { name, location: { lat: 51.5, lng: -0.1 } }, source: independent.source,
      })),
    });

    const answer = await loadTodayWhatsOnAnswer(NOW, { pubOnly: true, limit: 60 });

    expect(answer?.rows).toEqual([expect.objectContaining({
      title: "The Fixture Arms live music", venueId: "venue-quiz",
    })]);
  });

  it.each(["missing", "failed"])("reports a %s index as unavailable rather than empty", async (state) => {
    if (state === "missing") vi.mocked(loadOutVenueMatchIndex).mockResolvedValue(null);
    else vi.mocked(loadOutVenueMatchIndex).mockRejectedValue(new Error("Index read failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const answer = await loadTodayWhatsOnAnswer(NOW, { pubOnly: true, limit: 60 });

    expect(answer).toBeNull();
    expect(listingStore.readAll).not.toHaveBeenCalled();
    expect(fetchThingsToDo).not.toHaveBeenCalled();
    expect(documentFor(answer)).toContain('data-picks-state="temporarily_unavailable"');
  });

  it("treats an available empty index as a healthy empty answer", async () => {
    vi.mocked(loadOutVenueMatchIndex).mockResolvedValue(buildOutVenueMatchIndex([]));

    const answer = await loadTodayWhatsOnAnswer(NOW, { pubOnly: true, limit: 60 });

    expect(answer?.rows).toEqual([]);
    expect(answer?.readStatus).toBe("ready");
  });

  it("preserves Today and landing defaults without a venue-index dependency", async () => {
    vi.mocked(loadOutVenueMatchIndex).mockRejectedValue(new Error("Index read failed"));

    const answer = await loadTodayWhatsOnAnswer(NOW);

    expect(answer?.rows).toEqual(expect.arrayContaining([independent, nonPub]));
    expect(answer?.readStatus).toBe("ready");
    expect(loadOutVenueMatchIndex).not.toHaveBeenCalled();
  });
});

describe("Tonight's completed server document", () => {
  it("acknowledges a pub-matched gig when ticket-platform listings stay outside the primary list", () => {
    const gig = {
      ...independent,
      id: "ticketmaster-lexington",
      kind: "music" as const,
      title: "REALLY GOOD TIME",
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/lexington" },
    };
    const html = renderToStaticMarkup(createElement(TonightClient, {
      initialListings: {
        whatsOn: { ...whatsOn, rows: [gig] },
        out: {
          body: { status: "ready", events: [gig], observedAt: { ticketmaster: OBSERVED }, venueMatch: "ready" },
          failed: false,
          pending: false,
        },
        renderedAt: NOW,
      },
      mapSelectableVenueIds: ["venue-quiz"],
    }));

    expect(html).toContain("1 sourced live music listing below.");
    expect(html).toContain("REALLY GOOD TIME");
    expect(html).toContain("1 listing via Ticketmaster");
    expect(html).not.toContain("No confirmed events");
    expect(html).not.toContain("No events listed");
    expect(html).not.toContain("Quiet night");
    expect(html).not.toContain("nothing’s confirmed");
  });

  it("does not publish a loading-picks placeholder in the completed document", () => {
    expect(documentFor(whatsOn)).not.toContain("Loading picks");
  });

  it("contains approved listings and their real source before browser reads run", () => {
    const html = documentFor(whatsOn);
    expect(html).toContain("Friday pub quiz");
    expect(html).toContain("The Fixture Arms");
    expect(html).toContain("via The Fixture Arms");
    expect(html).toContain("7:00 pm");
    expect(html).toContain("data-listings-status=\"ready\"");
    expect(html).not.toContain("Loading listings");
  });

  it("describes an unavailable read instead of claiming an empty city", () => {
    const html = documentFor(null);
    expect(html).toContain("data-picks-state=\"temporarily_unavailable\"");
    expect(html).not.toContain("Loading listings");
    expect(html).not.toContain("The city's having a quiet one");
  });

  it("keeps chain deals and ticket platforms out of the primary listing region", () => {
    const html = documentFor({
      ...whatsOn,
      rows: [
        independent,
        { ...independent, id: "chain", title: "Chain offer", kind: "deal", source: { label: "J D Wetherspoon", url: "https://www.jdwetherspoon.com/" } },
        { ...independent, id: "ticket", title: "Ticket platform show", kind: "event", source: { label: "Ticketmaster", url: "https://ticketmaster.co.uk/" } },
      ],
    });
    const lede = html.split('data-testid="tonight-lede"')[1]?.split('class="tonightWeather"')[0] ?? "";
    expect(lede).toContain("Friday pub quiz");
    expect(lede).not.toContain("Chain offer");
    expect(lede).not.toContain("Ticket platform show");
  });
  it("keeps a held deal's age on the server clock during hydration", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW + 2 * 60 * 60_000);
    try {
      const html = documentFor({ ...whatsOn, rows: [{
        ...independent, kind: "deal", title: "Friday deal",
        observedAt: new Date(NOW - (21 * 24 - 1) * 60 * 60_000).toISOString(),
      }] });
      expect(html).toContain("Listed 2 weeks ago");
      expect(html).not.toContain("Listed 3 weeks ago");
    } finally {
      clock.mockRestore();
    }
  });

  it("hydrates a held deal across an age boundary without changing its date copy", async () => {
    const initialListings = { whatsOn: { ...whatsOn, rows: [{
      ...independent, kind: "deal" as const, title: "Friday deal",
      observedAt: new Date(NOW - (21 * 24 - 1) * 60 * 60_000).toISOString(),
    }] }, out, renderedAt: NOW };
    const element = createElement(TonightClient, { initialListings });
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.append(container);
    const errors: string[] = [];
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW + 2 * 60 * 60_000);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(String(error)) });
      });
      expect(container.textContent).toContain("Listed 2 weeks ago");
      expect(container.textContent).not.toContain("Listed 3 weeks ago");
      expect(errors).toEqual([]);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      clock.mockRestore();
      vi.unstubAllGlobals();
    }
  });

});
