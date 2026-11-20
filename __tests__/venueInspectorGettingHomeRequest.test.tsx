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

const photoReads = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/map" }));
vi.mock("@/lib/authedFetch", () => ({
  authedFetch: (...args: unknown[]) => photoReads.read(...args),
  authedActionFetch: (...args: unknown[]) => photoReads.write(...args),
}));
vi.mock("@/components/profile/ProfileImageCropper", () => ({
  default: ({ onCropped }: { onCropped: (file: File) => void }) => createElement("button", {
    type: "button",
    onClick: () => onCropped(new File(["jpeg"], "crop.jpg", { type: "image/jpeg" })),
  }, "Use photo"),
}));
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
  default: ({
    tab,
    gettingHome,
    journeyFoldOpenKey,
  }: {
    tab: string;
    gettingHome: React.ReactNode;
    journeyFoldOpenKey?: string | null;
  }) =>
    createElement(
      "div",
      {
        id: "venuePanel-overview",
        role: "tabpanel",
        hidden: tab !== "overview",
        "data-journey-open-key": journeyFoldOpenKey ?? "",
      },
      gettingHome,
    ),
}));
vi.mock("@/components/map/inspector/VenuePintsTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenueMenuTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenueStoryTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenueAskTab", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/VenueActionCard", () => ({ default: () => null }));

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
  photoReads.read.mockReset().mockImplementation(async () => Response.json({ photos: [], status: "degraded", nextCursor: null }));
  photoReads.write.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderInspector(initialTab: VenueTabRequest, gettingHomeRequestId: number, selectedVenue = venue) {
  await act(async () => {
    root.render(
      createElement(VenueInspector, {
        venue: selectedVenue,
        latestContributorPrice: null,
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
    // The journey fold is told by an explicit key, one per ask.
    const panel = document.getElementById("venuePanel-overview");
    expect(panel?.getAttribute("data-journey-open-key")).toMatch(/:getting-home:1$/);
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

const wallPhoto = {
  id: "photo-1",
  venueId: venue.id,
  wallCategory: "pub",
  placeLabel: null,
  url: "/api/venue-photos/photo-1",
  drinkCategory: null,
  caption: "The garden",
  width: 1080,
  height: 1350,
  createdAt: "2026-11-19T18:00:00.000Z",
  author: { handle: "mia" },
  ownedByViewer: true,
};

describe("VenueInspector photo navigation", () => {
  it("keeps focus in the photo caption when an empty read moves the composer to Overview", async () => {
    let finish!: (response: Response) => void;
    photoReads.read.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:photo");
      static revokeObjectURL = vi.fn();
    });
    await renderInspector("photos", 0);
    const click = async (label: string) => {
      const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
      await act(async () => button.click());
    };
    await click("Add a photo");
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("Use photo");
    const caption = container.querySelector<HTMLTextAreaElement>("#venue-photo-caption")!;
    caption.focus();
    expect(document.activeElement).toBe(caption);

    await act(async () => finish(Response.json({ photos: [], status: "ready", nextCursor: null })));

    expect(container.querySelector("#venueTab-photos")).toBeNull();
    expect(selectedTab()).toBe("venueTab-overview");
    expect(caption.closest("[hidden]")).toBeNull();
    expect(document.activeElement).toBe(caption);
  });

  it("moves keyboard focus to Overview when a pending Photos tab becomes empty", async () => {
    let finish!: (response: Response) => void;
    photoReads.read.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await renderInspector("overview", 0);
    await act(async () => {
      tabButton("overview").focus();
      tabButton("overview").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(tabButton("photos"));

    await act(async () => finish(Response.json({ photos: [], status: "ready", nextCursor: null })));

    expect(container.querySelector("#venueTab-photos")).toBeNull();
    expect(selectedTab()).toBe("venueTab-overview");
    expect(document.activeElement).toBe(tabButton("overview"));
    await act(async () => {
      tabButton("overview").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(tabButton("menu"));
  });

  it("moves an empty Photos request to Overview and keeps the first-photo action", async () => {
    photoReads.read.mockResolvedValueOnce(Response.json({ photos: [], status: "ready", nextCursor: null }));
    await renderInspector("photos", 0);

    expect(container.querySelector("#venueTab-photos")).toBeNull();
    expect(selectedTab()).toBe("venueTab-overview");
    const add = [...container.querySelectorAll("button")].find((button) => button.textContent === "Add a photo")!;
    expect(add.closest("[hidden]")).toBeNull();
    await act(async () => add.click());
    expect(container.querySelector(".venuePhotoComposer")?.closest("[hidden]")).toBeNull();
    expect(container.querySelector("#venueTab-photos")).toBeNull();

    await act(async () => {
      tabButton("overview").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(selectedTab()).toBe("venueTab-menu");
  });

  it("keeps Photos when the venue cannot be checked", async () => {
    photoReads.read.mockRejectedValueOnce(new Error("offline"));
    await renderInspector("photos", 0);

    expect(selectedTab()).toBe("venueTab-photos");
    expect(container.querySelector(".venuePhotoWallEmpty")?.textContent).toContain("could not read");
  });

  it("opens Photos after the first photo is posted from Overview", async () => {
    photoReads.read.mockResolvedValueOnce(Response.json({ photos: [], status: "ready", nextCursor: null }));
    photoReads.write.mockResolvedValueOnce(Response.json({ photo: wallPhoto, crosspost: { state: "off" } }));
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:photo");
      static revokeObjectURL = vi.fn();
    });
    await renderInspector("overview", 0);
    const click = async (label: string) => {
      const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
      await act(async () => button.click());
    };
    await click("Add a photo");
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("Use photo");
    await click("Post photo");

    expect(selectedTab()).toBe("venueTab-photos");
    expect(document.activeElement).toBe(tabButton("photos"));
    expect(container.querySelectorAll(".venuePhotoTile")).toHaveLength(1);
    expect(container.querySelector(".venuePhotoTile")?.closest("[hidden]")).toBeNull();
  });

  it("follows empty pages before deciding whether to hide Photos", async () => {
    photoReads.read
      .mockResolvedValueOnce(Response.json({ photos: [], status: "ready", nextCursor: "older-photo" }))
      .mockResolvedValueOnce(Response.json({ photos: [wallPhoto], status: "ready", nextCursor: null }));
    await renderInspector("photos", 0);

    expect(selectedTab()).toBe("venueTab-photos");
    expect(container.querySelectorAll(".venuePhotoTile")).toHaveLength(1);
    const nextPage = new URL(String(photoReads.read.mock.calls[1]?.[0]), "http://localhost");
    expect(nextPage.searchParams.get("cursor")).toBe("older-photo");
  });

  it("returns to Overview after the last photo is removed", async () => {
    photoReads.read.mockResolvedValueOnce(Response.json({ photos: [wallPhoto], status: "ready", nextCursor: null }));
    photoReads.write.mockResolvedValueOnce(Response.json({ ok: true }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderInspector("overview", 0);
    await readerSelects("photos");
    await act(async () => container.querySelector<HTMLButtonElement>(".venuePhotoRemove")!.click());

    expect(container.querySelector("#venueTab-photos")).toBeNull();
    expect(selectedTab()).toBe("venueTab-overview");
    expect(container.querySelector(".venuePhotoWallActions")?.closest("[hidden]")).toBeNull();
  });

  it("does not reuse confirmed emptiness for the next venue", async () => {
    photoReads.read.mockResolvedValueOnce(Response.json({ photos: [], status: "ready", nextCursor: null }));
    await renderInspector("overview", 0);
    expect(container.querySelector("#venueTab-photos")).toBeNull();

    let finish!: (response: Response) => void;
    photoReads.read.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await renderInspector("photos", 0, { ...venue, id: "another-venue" });
    expect(selectedTab()).toBe("venueTab-photos");
    await act(async () => finish(Response.json({ photos: [wallPhoto], status: "ready", nextCursor: null })));
    expect(container.querySelectorAll(".venuePhotoTile")).toHaveLength(1);
  });
});
