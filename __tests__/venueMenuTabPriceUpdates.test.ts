// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import VenueMenuTab from "@/components/map/inspector/VenueMenuTab";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import type { TabKey } from "@/lib/venueInspectorTabs";
import type { VenuePriceUpdates, VenueWithPriceUpdates } from "@/lib/venuePriceUpdates";

/**
 * THE DRINKS TAB DRAWS THE ROWS ITS VENUE DETAIL CARRIES, AND FETCHES NO PACK.
 *
 * GET /api/venue/[id] scopes both observed price-update packs to one pub
 * (__tests__/venuePriceUpdatesPerVenue.test.ts). The tab reads that answer off
 * the venue it is given. Every venue tab is mounted and hidden on every sheet
 * open, so a read of its own would be a read for a tab nobody opened.
 */

const SOURCED: DrinkPriceUpdate = {
  venueKey: "venue-test",
  drinkName: "Hazy Test IPA",
  category: "beer",
  priceGbp: 6.75,
  source: {
    label: "Test Arms menu",
    url: "https://example.com/test-arms/menu",
    licence: "publisher page",
  },
  observedAt: "2026-09-01T12:00:00.000Z",
  lane: "publisher",
};

function venue(priceUpdates: VenuePriceUpdates | null): VenueWithPriceUpdates {
  return {
    id: "venue-test",
    name: "The Test Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    priceUpdates,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchSpy = vi.fn(async () =>
    new Response(JSON.stringify({ summaries: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

async function render(props: {
  venue: VenueWithPriceUpdates;
  tab: TabKey;
}): Promise<HTMLDivElement> {
  const element = document.createElement("div");
  document.body.appendChild(element);
  host = element;
  await act(async () => {
    root = createRoot(element);
    root.render(createElement(VenueMenuTab, props));
  });
  return element;
}

async function openDrinks(element: HTMLDivElement): Promise<void> {
  const button = Array.from(element.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes("Drinks"),
  );
  expect(button, "the hub's Drinks tile").toBeDefined();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function packReads(): string[] {
  return fetchSpy.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes("price_updates"));
}

describe("VenueMenuTab draws its venue's own price updates", () => {
  it("draws a sourced row and its source off the venue detail, reading no pack", async () => {
    const element = await render({
      venue: venue({ drink: [SOURCED], food: [] }),
      tab: "menu",
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await openDrinks(element);

    const row = Array.from(element.querySelectorAll(".drinkRow")).find((candidate) =>
      candidate.textContent?.includes("Hazy Test IPA"),
    );
    expect(row, "the sourced drink row").toBeDefined();
    expect(row?.textContent).toContain("£6.75");
    const chip = row?.querySelector<HTMLAnchorElement>("a.drinkProvChip");
    expect(chip?.textContent).toBe("Test Arms menu");
    expect(chip?.getAttribute("href")).toBe("https://example.com/test-arms/menu");
    expect(packReads()).toEqual([]);
  });

  it.each([
    ["an unread pack", null],
    ["a pub with no row", { drink: [], food: [] }],
  ])("draws no sourced row for %s and reads no pack", async (_label, priceUpdates) => {
    const element = await render({ venue: venue(priceUpdates), tab: "menu" });

    expect(element.textContent).not.toContain("Hazy Test IPA");
    expect(element.textContent).not.toContain("£6.75");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays hidden and reads nothing while another tab is open", async () => {
    const element = await render({
      venue: venue({ drink: [SOURCED], food: [] }),
      tab: "overview",
    });

    const panel = element.querySelector('[role="tabpanel"]');
    expect(panel?.hasAttribute("hidden")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
