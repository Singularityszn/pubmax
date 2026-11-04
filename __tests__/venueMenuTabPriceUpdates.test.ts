// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import VenueMenuTab from "@/components/map/inspector/VenueMenuTab";
import { GET as getVenue } from "@/app/api/venue/[id]/route";
import { stableVenueIdFromKey, venueFromDetailPayload } from "@/lib/venues";
import { useInspectorTabs } from "@/components/map/inspector/useInspectorTabs";
import { BASE_TABS } from "@/lib/venueInspectorTabs";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import type { FoodPriceUpdate } from "@/lib/foodPriceUpdates";
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

const SOURCED_FOOD: FoodPriceUpdate = {
  venueKey: "venue-test",
  itemName: "Vegetable curry",
  category: "mains",
  priceGbp: 12.5,
  dietary: ["vegan"],
  source: SOURCED.source,
  observedAt: SOURCED.observedAt,
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
  it("keeps Sherlock Holmes published wine available through the venue API and rendered Menu", async () => {
    const id = stableVenueIdFromKey("sherlock holmes|10 northumberland street, wc2n 5db|51.50730|-0.12534");
    const response = await getVenue(new Request(`http://localhost/api/venue/${id}`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    const detail = await response.json();
    const element = await render({ venue: venueFromDetailPayload(detail.venue), tab: "menu" });
    await openDrinks(element);
    const rows = Array.from(element.querySelectorAll(".drinkRow")).filter((row) =>
      row.querySelector(".drinkName")?.textContent === "Organic Pinot Grigio, Riff, Italy",
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.querySelector(".drinkPrice")?.textContent).toBe("£7.20");
    expect(row.querySelector(".drinkServing")).toBeNull();
    expect(row.querySelector("a.drinkProvChip")?.getAttribute("href")).toBe("https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu");
    expect(row.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-21T18:41:07.759Z");
    expect(packReads()).toEqual([]);
  });

  it.each(["food", "all", "beer"])("keeps arrow-key tab focus after revisiting a %s drill-in", async (door) => {
    const pub = venue({
      drink: [SOURCED, { ...SOURCED, drinkName: "House red", category: "wine" }],
      food: [SOURCED_FOOD],
    });
    function Inspector() {
      const { tab, selectTab, onTabKeyDown, tabRefs } = useInspectorTabs("menu", pub.id, BASE_TABS);
      return createElement("div", null,
        createElement("div", { role: "tablist" },
          BASE_TABS.map(({ key, label }) => createElement("button", {
            key,
            role: "tab",
            "aria-selected": tab === key,
            ref: (element: HTMLButtonElement | null) => { tabRefs.current[key] = element; },
            onClick: () => selectTab(key),
            onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => onTabKeyDown(event, key),
          }, label)),
        ),
        createElement(VenueMenuTab, { venue: pub, tab }),
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(createElement(Inspector));
    });
    const tab = (label: string) => Array.from(host!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((element) => element.textContent === label)!;
    for (let round = 0; round < 2; round += 1) {
      await act(async () => { host!.querySelector<HTMLButtonElement>(`[data-menu-door="${door}"]`)!.click(); });
      const back = host.querySelector<HTMLButtonElement>(".drinkMenuBack")!;
      expect(document.activeElement).toBe(back);
      await act(async () => { tab("Photos").click(); });
      await act(async () => { tab("Photos").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
      expect(document.activeElement).toBe(tab("Menu"));
      for (const [key, labels] of [
        ["ArrowRight", ["Prices", "Lore", "Overview", "Photos", "Menu"]],
        ["ArrowLeft", ["Photos", "Overview", "Lore", "Prices", "Menu"]],
      ] as const) {
        for (const label of labels) {
          await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
          expect(document.activeElement).toBe(tab(label));
        }
      }
      await act(async () => { back.click(); });
      expect(document.activeElement).toBe(host.querySelector(`[data-menu-door="${door}"]`));
    }
  });

  it("offers recorded food through a named door and returns to the menu hub", async () => {
    const element = await render({
      venue: venue({ drink: [SOURCED], food: [SOURCED_FOOD] }),
      tab: "menu",
    });
    const food = element.querySelector<HTMLButtonElement>('[data-menu-door="food"]');
    expect(food, "a visible Food door for recorded dishes").not.toBeNull();
    expect(food?.textContent).toContain("1 dish on record");
    expect(element.querySelector('[aria-label="Food at The Test Arms"]')).toBeNull();
    await act(async () => { food?.click(); });
    expect(element.querySelector(".menuHub")).toBeNull();
    expect(element.textContent).toContain("Vegetable curry");
    expect(element.textContent).toContain("£12.50");
    expect(element.textContent).toContain("vegan");
    const back = element.querySelector<HTMLButtonElement>('[aria-label="Back to menus"]');
    expect(back).not.toBeNull();
    expect(document.activeElement).toBe(back);
    await act(async () => { back?.click(); });
    expect(element.querySelector('[data-menu-door="food"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Food at The Test Arms"]')).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('[data-menu-door="food"]'));
    expect(packReads()).toEqual([]);
  });

  it("does not offer an empty food door when the venue has no recorded dishes", async () => {
    const element = await render({ venue: venue({ drink: [SOURCED], food: [] }), tab: "menu" });
    expect(element.querySelector('[data-menu-door="food"]')).toBeNull();
    expect(element.textContent).not.toContain("Food opens");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears a food drill-in when another venue replaces the current venue", async () => {
    const current = venue({ drink: [], food: [SOURCED_FOOD] });
    const element = await render({ venue: current, tab: "menu" });
    const food = element.querySelector<HTMLButtonElement>('[data-menu-door="food"]');
    expect(food).not.toBeNull();
    await act(async () => { food?.click(); });
    expect(element.textContent).toContain("Vegetable curry");
    await act(async () => {
      root?.render(createElement(VenueMenuTab, { venue: { ...venue({ drink: [{ ...SOURCED, venueKey: "venue-next" }], food: [] }), id: "venue-next" }, tab: "menu" }));
    });
    expect(element.textContent).not.toContain("Vegetable curry");
    expect(element.querySelector(".menuHub")).not.toBeNull();
    expect(packReads()).toEqual([]);
  });

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
