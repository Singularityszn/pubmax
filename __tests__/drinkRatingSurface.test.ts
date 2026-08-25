// @vitest-environment jsdom

import { createRequire } from "node:module";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/priceUpdatesLoader", () => ({
  loadDrinkPriceUpdates: async () => [],
  loadFoodPriceUpdates: async () => [],
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import VenueMenuTab from "@/components/map/inspector/VenueMenuTab";
import { GET } from "@/app/api/ratings/route";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { __resetMemoryRatings } from "@/lib/ratingsStore";

const requireFromTest = createRequire(import.meta.url);
let root: Root | null = null;

function price(): VenuePrice {
  return {
    app_price_id: "price-1",
    pub_name: "Test Pub",
    pint_name: "London Pride",
    price_gbp: 5.5,
    price_text: "£5.50",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "app-dataset",
    source_row_count: 1,
    has_visible_borough_row: true,
    has_raw_embedded_map_row: true,
    has_individual_pub_page_row: true,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
  };
}

afterEach(() => {
  root?.unmount();
  root = null;
  __resetMemoryRatings();
  vi.unstubAllGlobals();
});

describe("drink rating surface fence", () => {
  it("renders the drink rating row through VenueMenuTab -> DrinkMenu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ summaries: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const venue = groupVenuePrices([price()])[0];
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(VenueMenuTab, { venue, tab: "menu" }));
    });

    const drinksButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Drinks"),
    );
    expect(drinksButton).toBeDefined();

    await act(async () => {
      drinksButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".drinkMenu")).not.toBeNull();
    expect(container.querySelector(".drinkRatingRow")).not.toBeNull();
    expect(container.querySelector('[role="slider"]')?.getAttribute("aria-label")).toBe(
      "Rate London Pride",
    );
  });

  it("does not expose the retired top-rated API response", async () => {
    const response = await GET(
      new Request("http://localhost/api/ratings?kind=venue&top=1&limit=10"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summaries: {} });
  });

  it("does not resolve removed venue-rating modules", () => {
    for (const relative of [
      "components/ratings/VenueRatingPanel.tsx",
      "components/ratings/TopRatedPubs.tsx",
      "components/ratings/topRatedPubs.css",
    ]) {
      expect(() => requireFromTest(path.join(process.cwd(), relative))).toThrow();
    }
  });
});
