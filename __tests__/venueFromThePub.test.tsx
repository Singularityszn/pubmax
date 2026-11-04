// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// "From the pub" (launch plan 1 Nov 2026, section 7 item 1). The venue sheet's
// labelled block says each published fact's kind and date; the "Run this pub?"
// door is ONE row in the pub fold; Tonight's block names the pub and the night.
// Neither surface ever says "Sponsored": the pub's word is not paid.

vi.mock("@/components/auth/AuthProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/auth/AuthProvider")>();
  return { ...actual, useAuth: () => ({ ...actual.useAuth(), configured: true }) };
});

import TonightFromThePubs, { FROM_THE_PUBS_TONIGHT_LINE } from "@/app/tonight/TonightFromThePubs";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { FromThePubFacts } from "@/components/operators/VenueFromThePub";
import type { PublicOperatorFact, TonightOperatorFact } from "@/lib/operatorFacts";
import { slimVenueToPin } from "@/lib/slimPins";
import type { VenueKind } from "@/lib/venues";

const noop = () => {};

function host(markup: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  return element;
}

const FACTS: PublicOperatorFact[] = [
  {
    id: "f-event",
    venueId: "venue-synthetic",
    kind: "event",
    title: "Quiz night",
    body: "Teams of six.",
    field: null,
    when: "8pm",
    onDate: "2026-11-07",
    publishedAt: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "f-offer",
    venueId: "venue-synthetic",
    kind: "offer",
    title: "Two for one on cask",
    body: "Mondays before 7pm.",
    field: null,
    when: null,
    onDate: null,
    publishedAt: "2026-10-28T10:00:00.000Z",
  },
  {
    id: "f-correction",
    venueId: "venue-synthetic",
    kind: "correction",
    title: null,
    body: "Open till 1am on Fridays.",
    field: "Opening hours",
    when: null,
    onDate: null,
    publishedAt: "2026-10-20T10:00:00.000Z",
  },
  {
    id: "f-response",
    venueId: "venue-synthetic",
    kind: "response",
    title: null,
    body: "Thanks, the tap is fixed.",
    field: null,
    when: null,
    onDate: null,
    publishedAt: "2026-10-15T10:00:00.000Z",
  },
];

describe("the venue sheet's From the pub block", () => {
  it("labels the block and says each fact's kind and date", () => {
    const view = host(renderToStaticMarkup(createElement(FromThePubFacts, { facts: FACTS })));
    const block = view.querySelector("[data-from-the-pub]");
    expect(block?.querySelector("h3")?.textContent).toBe("From the pub");
    const items = [...view.querySelectorAll<HTMLElement>("[data-operator-fact-kind]")];
    expect(items.map((item) => item.dataset.operatorFactKind)).toEqual([
      "event",
      "offer",
      "correction",
      "response",
    ]);
    expect(items.map((item) => item.querySelector(".venueFromThePubKind")?.textContent)).toEqual([
      "Event",
      "Offer",
      "Correction",
      "Response",
    ]);
    const event = items[0];
    expect(event?.querySelector(".venueFromThePubMeta")?.textContent).toBe("Event · Sat 7 Nov");
    expect(event?.querySelector(".venueFromThePubMeta time")?.getAttribute("datetime")).toBe("2026-11-07");
    expect(event?.textContent).toContain("Quiz night");
    expect(event?.querySelector(".venueFromThePubAdded")?.textContent).toBe("Added by the pub, 1 Nov 2026");
    expect(items[2]?.querySelector(".venueFromThePubTitle")?.textContent).toBe("Opening hours");
    expect(items[3]?.querySelector(".venueFromThePubAdded time")?.getAttribute("datetime")).toBe(
      "2026-10-15T10:00:00.000Z",
    );
  });

  it("is not paid, so it never says Sponsored", () => {
    const markup = renderToStaticMarkup(createElement(FromThePubFacts, { facts: FACTS }));
    expect(markup).not.toMatch(/sponsor/i);
  });

  it("renders nothing with nothing published", () => {
    expect(renderToStaticMarkup(createElement(FromThePubFacts, { facts: [] }))).toBe("");
  });
});

function communityPrices(venueId: string): CommunityPricesState {
  return {
    byVenueId: new Map([[venueId, []]]),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    venuePriceStatus: new Map([[venueId, "ready"]]),
    noAlcoholIndexStatus: "idle",
    loadNoAlcoholIndex: noop,
    loadDrinkCategoryIndex: noop,
    drinkCategoryIndexStatus: new Map(),
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: noop,
    loadVenue: noop,
    submit: async () => ({ ok: false, error: "Not submitted", reason: "rejected" }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  };
}

function overview(kind: VenueKind): HTMLElement {
  // A synthetic pub, not an observation about a real one.
  const venueId = `synthetic-from-the-pub-${kind}`;
  const props: ComponentProps<typeof VenueOverviewTab> = {
    venue: slimVenueToPin({
      id: venueId,
      name: "The Synthetic Arms",
      lat: 51.52,
      lng: -0.11,
      borough: "Camden",
      zone: 2,
      cheapestPrice: 4.8,
      kind,
    }),
    tab: "overview",
    cityId: "london",
    latestContributorPrice: null,
    dropReadStatus: "ready",
    communityPrices: communityPrices(venueId),
    experienceLens: "all",
    drinkLensCategory: null,
    presenceState: "idle",
    markPresenceHere: noop,
    userLocation: null,
    locationRequestStatus: "idle",
    onRequestLocation: noop,
    onClearLocation: noop,
    onLogTonightPrice: noop,
    onOpenVisitReports: noop,
    priceEntryAllowed: false,
    priceSignInRequested: false,
    priceAuthLoading: false,
    priceFocusRequest: 0,
  };
  return host(renderToStaticMarkup(createElement(VenueOverviewTab, props)));
}

describe("the Run this pub? door on the venue sheet", () => {
  it("is one quiet row in the pub fold and nowhere else", () => {
    const view = overview("pub");
    const doors = [...view.querySelectorAll(".operatorRailTrigger")];
    expect(doors).toHaveLength(1);
    expect(doors[0]?.textContent).toBe("Run this pub?");
    expect(view.querySelector("#venueFold-pub .venueFromThePub .operatorRailTrigger")).not.toBeNull();
    // Closed until asked: the panel's form is not on the sheet.
    expect(view.querySelector(".operatorRailCard")).toBeNull();
    // One row, not a section with its own heading while nothing is published.
    expect(view.querySelector("#venueFold-pub .venueFromThePub h3")).toBeNull();
  });

  it("is not offered on a venue that is not a pub", () => {
    expect(overview("cafe").querySelector(".operatorRailTrigger")).toBeNull();
  });
});

describe("Tonight's From the pubs tonight block", () => {
  const PREPARED = Date.parse("2026-11-07T18:00:00.000Z");
  const tonight: TonightOperatorFact[] = [
    { ...FACTS[0]!, venueName: "The Synthetic Arms" },
    { ...FACTS[1]!, id: "f-undated-offer", venueName: "The Undated" },
    { ...FACTS[0]!, id: "f-next-week", onDate: "2026-11-14", venueName: "The Next Week" },
  ];

  it("names the pub, its kind and the night, under its own label", () => {
    const view = host(
      renderToStaticMarkup(createElement(TonightFromThePubs, { facts: tonight, preparedAt: PREPARED })),
    );
    const block = view.querySelector('[data-testid="tonight-from-the-pubs"]');
    expect(block?.querySelector("h2")?.textContent).toBe("From the pubs tonight");
    expect(block?.textContent).toContain(FROM_THE_PUBS_TONIGHT_LINE);
    const rows = [...view.querySelectorAll("li")];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector("a")?.textContent).toBe("The Synthetic Arms");
    expect(rows[0]?.querySelector("a")?.getAttribute("href")).toContain("sel=venue-synthetic");
    expect(rows[0]?.querySelector(".tonightFromThePubsKind")?.textContent).toBe("Event · Sat 7 Nov");
    expect(rows[0]?.textContent).toContain("Added by the pub, 1 Nov 2026");
    expect(view.innerHTML).not.toMatch(/sponsor/i);
  });

  it("waits while the first listings read is still running", () => {
    expect(
      renderToStaticMarkup(
        createElement(TonightFromThePubs, { facts: tonight, preparedAt: PREPARED, held: true }),
      ),
    ).toBe("");
  });

  it("renders nothing on a night with nothing dated for it", () => {
    const quiet = Date.parse("2026-11-08T18:00:00.000Z");
    expect(
      renderToStaticMarkup(createElement(TonightFromThePubs, { facts: tonight, preparedAt: quiet })),
    ).toBe("");
  });
});
