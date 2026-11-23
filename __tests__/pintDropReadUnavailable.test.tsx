// A FAILED PINT DROP READ IS NOT A PUB WITH NO PRICE (review finding F-8).
//
// `refreshVenueDrops` answered a non-ok response and a rejection the same way:
// it wrote `[]` into the venue's entry. `/api/pint-drops` answers 503 whenever
// its store read throws, so one hiccup replaced a pub's real drops with
// nothing, `pintTrustFor([])` read `none`, and the Overview printed the
// first-drop nudge over a pub holding a confirmed price - the one sentence
// #1495 exists to keep off a public drop. The city-wide refresh 25 lines above
// it already did the right thing.
//
// The rule is a pure leaf. Below it, the Overview and the map's hook are run
// through the same failure, so neither can grow a second answer.

// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: null, session: null, loading: false, configured: true, handle: null,
    identityResolved: true, getCurrentUserId: () => null,
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import { usePintDrops, type DropWithPhotos, type PintDropsState } from "@/components/map/usePintDrops";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { Venue } from "@/lib/venues";

import {
  venueDropsAfterRead,
  type VenueDropReadStatus,
} from "@/lib/venueDropRead";
import {
  DROP_READ_UNAVAILABLE_LINE,
  firstDropNudgeCopy,
  firstDropNudgeMayClaimAbsence,
} from "@/lib/firstDropNudge";
import { pintTrustFor } from "@/lib/pintTrust";

const DROP = {
  id: "drop-1",
  venueId: "venue-xjf3n0",
  handle: "alice",
  drink: "Beer",
  measure: "pint" as const,
  priceGbp: 5.5,
  passedDownNote: "",
  era: "",
  provenance: "contributor" as const,
  status: "visible" as const,
  visibility: "public" as const,
  createdAt: new Date().toISOString(),
  authorityKey: "key-one",
};

describe("what a venue holds after a drop read", () => {
  it("keeps every row it had when the read could not be run", () => {
    expect(
      venueDropsAfterRead([DROP], { status: "unavailable" }),
    ).toEqual([DROP]);
  });

  it("leaves an unread venue unread rather than answering with nothing", () => {
    // `undefined` is "not asked"; `[]` is "asked, and this pub has none". A
    // failed read may not turn the first into the second.
    expect(venueDropsAfterRead(undefined, { status: "unavailable" })).toBeUndefined();
  });

  it("adopts an answer, including an empty one", () => {
    expect(venueDropsAfterRead([DROP], { status: "ready", drops: [] })).toEqual([]);
    expect(venueDropsAfterRead(undefined, { status: "ready", drops: [DROP] })).toEqual([
      DROP,
    ]);
  });

  it("is what keeps the pub's own trust state alive across a 503", () => {
    // The consequence the finding is really about: the drop that survives is
    // what stops `pintTrustFor` reading `none` over a pub with a public price.
    const kept = venueDropsAfterRead([DROP], { status: "unavailable" }) ?? [];
    expect(pintTrustFor(kept).state).not.toBe("none");
    expect(pintTrustFor([]).state).toBe("none");
  });
});

describe("what the price area may say about it", () => {
  it("claims an absence only when the read is not known to have failed", () => {
    const answers: Record<VenueDropReadStatus, boolean> = {
      idle: true,
      ready: true,
      unavailable: false,
    };
    for (const [status, mayClaim] of Object.entries(answers)) {
      expect(
        firstDropNudgeMayClaimAbsence(status as VenueDropReadStatus),
        `a ${status} read`,
      ).toBe(mayClaim);
    }
  });

  it("says the true thing instead, and never a dead end", () => {
    expect(DROP_READ_UNAVAILABLE_LINE).toMatch(/could not read/i);
    expect(DROP_READ_UNAVAILABLE_LINE).not.toMatch(/no (pint )?price/i);
  });

});

const noop = () => {};

const PUB = {
  id: DROP.venueId,
  name: "The Lamb",
  address: "94 Lamb's Conduit Street",
  latitude: 51.52,
  longitude: -0.12,
  primaryBorough: "Camden",
  visibleBoroughs: [],
  prices: [],
  cheapestPrice: null,
  cheapestPint: "",
  averagePrice: null,
  hasStory: false,
  latestContributorPrice: null,
  latestContributorAt: null,
  amenities: {},
  website: "",
  bookingLink: "",
  imageUrl: "",
  description: "",
  dataQualityNotes: [],
  sourceDatasets: [],
  curation: {},
  kind: "pub",
} as unknown as Venue;

function overviewFor(dropReadStatus: VenueDropReadStatus): HTMLElement {
  const communityPrices = {
    byVenueId: new Map([[PUB.id, []]]),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    venuePriceStatus: new Map([[PUB.id, "ready"]]),
    drinkCategoryIndexStatus: new Map(),
    provisionalBaseVenueIds: new Set(),
    reportedIds: new Set(),
    submitting: false,
  } as unknown as CommunityPricesState;
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(VenueOverviewTab, {
      venue: PUB,
      tab: "overview",
      cityId: "london",
      latestContributorPrice: null,
      latestPintDropAt: null,
      confirmedPrice: null,
      provisionalPrice: null,
      agedPrice: null,
      disputedPrice: null,
      dropReadStatus,
      communityPrices,
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
    }),
  );
  return host;
}

describe("the Overview of a pub with no drop on hand", () => {
  it("says it could not read, and keeps the way to log a price, when the read failed", () => {
    const overview = overviewFor("unavailable");
    const note = overview.querySelector(".firstDropNudge");
    expect(note?.textContent).toContain(DROP_READ_UNAVAILABLE_LINE);
    expect(overview.textContent).not.toContain(firstDropNudgeCopy(PUB.id).line);
    expect(note?.querySelector('[data-price-door="log"]')).not.toBeNull();
  });

  it("claims the absence, with the same way onward, once the read has answered", () => {
    const overview = overviewFor("ready");
    const note = overview.querySelector(".firstDropNudge");
    expect(overview.textContent).not.toContain(DROP_READ_UNAVAILABLE_LINE);
    expect(note?.textContent).toContain("No regular pint price logged here yet.");
    expect(note?.querySelector('[data-price-door="log"]')).not.toBeNull();
  });
});

describe("the map's hook when a venue read fails", () => {
  const listed: DropWithPhotos = {
    ...DROP,
    venueId: "venue-1",
    drink: "Pale ale",
    vibeTags: [],
    pintPhotoUrl: null,
    venuePhotoUrl: null,
  } as DropWithPhotos;
  let venueRead: () => Promise<Response>;
  let state: PintDropsState;
  let root: Root;
  let container: HTMLDivElement;

  function Probe() {
    const drops = usePintDrops();
    useEffect(() => {
      state = drops;
    }, [drops]);
    return null;
  }

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    venueRead = async () => new Response(JSON.stringify({ drops: [listed] }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL) =>
      String(url).includes("venueId=")
        ? venueRead()
        : Promise.resolve(new Response(JSON.stringify({ drops: [listed] }), { status: 200 })),
    ));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Probe)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    ["a 503", async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })],
    ["a rejection", async (): Promise<Response> => { throw new TypeError("Failed to fetch"); }],
  ])("keeps the venue's drops and its trust state after %s", async (_label, answer) => {
    expect(state.venueSignals.get("venue-1")?.pintTrust).toBe("logged-once");
    venueRead = answer;
    await act(async () => {
      state.refreshVenueDrops("venue-1");
    });
    expect(state.venueDropStatus.get("venue-1")).toBe("unavailable");
    expect(state.dropsByVenueId.get("venue-1")?.map((drop) => drop.id)).toEqual([listed.id]);
    expect(state.venueSignals.get("venue-1")?.pintTrust).toBe("logged-once");
  });

  it("adopts an answered empty read", async () => {
    venueRead = async () => new Response(JSON.stringify({ drops: [] }), { status: 200 });
    await act(async () => {
      state.refreshVenueDrops("venue-1");
    });
    expect(state.venueDropStatus.get("venue-1")).toBe("ready");
    expect(state.dropsByVenueId.get("venue-1")).toEqual([]);
    expect(state.venueSignals.get("venue-1")?.pintTrust).toBe("none");
  });
});
