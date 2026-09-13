// @vitest-environment jsdom

// A GETTING-HOME REQUEST LANDS ON THE OVERVIEW WITH THE FOLD OPEN, EVERY TIME.
//
// The route-end "Check last train" door asks the open sheet for the
// getting-home fold. When the same pub is already open, PubMap does not
// remount VenueInspector, and a request resolves to the same "overview" tab a
// plain open does, so only `gettingHomeRequestId` tells the sheet a new request
// arrived. These fences mount the real inspector, its tab strip and the real
// fold, and re-render the SAME mounted component the way PubMap does.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    handle: null,
    loading: false,
    configured: false,
    accountRevision: 0,
    supabaseAuthState: null,
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/lastRideClient", () => ({ prefetchLastRide: vi.fn() }));
vi.mock("@/components/media/VenueImage", () => ({ default: () => null }));
vi.mock("@/components/map/VenueTonightChips", () => ({ default: () => null }));
vi.mock("@/components/map/LastTrainCard", () => ({ default: () => null }));
vi.mock("@/components/map/NearbyBusDepartures", () => ({ default: () => null }));
vi.mock("@/components/night/RouteEndingCard", () => ({ GetHomeHandoffRow: () => null }));
vi.mock("@/components/night/SafeNightStrip", () => ({ SafeNightStrip: () => null }));
vi.mock("@/components/identity/ContributionGateDialog", () => ({
  ContributionGateDialog: () => null,
}));
vi.mock("@/components/map/inspector/VenueOverviewTab", () => ({
  default: ({ tab, gettingHome }: { tab: string; gettingHome: React.ReactNode }) =>
    createElement(
      "div",
      { id: "venuePanel-overview", role: "tabpanel", hidden: tab !== "overview" },
      gettingHome,
    ),
}));
vi.mock("@/components/map/inspector/VenuePhotosTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenuePintsTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenueMenuTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenueStoryTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenueAskTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenueStickyBar", () => ({ default: () => null }));

import VenueInspector from "@/components/map/VenueInspector";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { PintDropsState } from "@/components/map/usePintDrops";
import type { VenueTabRequest } from "@/lib/venueInspectorTabs";
import type { Venue } from "@/lib/venues";

const noop = () => {};

const venue = {
  id: "venue-getting-home",
  name: "The Test Arms",
  address: "1 Test Street",
  latitude: 51.52,
  longitude: -0.11,
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

const pintDrops = {
  dropsByVenueId: new Map(),
  venueDropStatus: new Map(),
  setComposerOpen: noop,
  seedComposerPrice: noop,
} as unknown as PintDropsState;

const communityPrices = {} as unknown as CommunityPricesState;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderInspector(initialTab: VenueTabRequest, gettingHomeRequestId: number) {
  await act(async () => {
    root.render(
      createElement(VenueInspector, {
        venue,
        mode: "cheap" as never,
        inCrawl: false,
        latestContributorPrice: null,
        onToggleStop: noop,
        initialTab,
        gettingHomeRequestId,
        pintDrops,
        communityPrices,
        userLocation: null,
        locationRequestStatus: "idle",
        onRequestLocation: noop,
        onClearLocation: noop,
      }),
    );
  });
}

function tabButton(key: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`#venueTab-${key}`);
  if (!button) throw new Error(`tab ${key} did not render`);
  return button;
}

function selectedTab(): string | null {
  return (
    container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.id ??
    null
  );
}

function gettingHomeFold(): HTMLDetailsElement {
  const fold = container.querySelector<HTMLDetailsElement>("#venueSection-getting-home");
  if (!fold) throw new Error("getting-home fold did not render");
  return fold;
}

async function readerSelects(key: string) {
  await act(async () => {
    tabButton(key).click();
  });
}

async function readerClosesFold() {
  await act(async () => {
    const fold = gettingHomeFold();
    fold.open = false;
    fold.dispatchEvent(new Event("toggle"));
  });
}

describe("VenueInspector getting-home request", () => {
  it("lands a pub open on Lore on the Overview with the fold open", async () => {
    await renderInspector("overview", 0);
    await readerSelects("story");
    expect(selectedTab()).toBe("venueTab-story");
    expect(gettingHomeFold().open).toBe(false);

    await renderInspector("getting-home", 1);

    expect(selectedTab()).toBe("venueTab-overview");
    expect(gettingHomeFold().open).toBe(true);
  });

  it("reopens the fold for a second request after the reader moved away", async () => {
    await renderInspector("overview", 0);
    await renderInspector("getting-home", 1);
    await readerClosesFold();
    await readerSelects("story");
    expect(gettingHomeFold().open).toBe(false);

    await renderInspector("getting-home", 2);

    expect(selectedTab()).toBe("venueTab-overview");
    expect(gettingHomeFold().open).toBe(true);
  });

  it("keeps the reader's tab when the sheet re-renders with the same request", async () => {
    await renderInspector("overview", 0);
    await renderInspector("getting-home", 1);
    await readerSelects("story");

    await renderInspector("getting-home", 1);

    expect(selectedTab()).toBe("venueTab-story");
  });
});
