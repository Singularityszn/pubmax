// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  __resetMemoryRatings();
  vi.unstubAllGlobals();
});

async function openDrinksMenu(summaries: Record<string, unknown>): Promise<HTMLDivElement> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ summaries }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  const venue = groupVenuePrices([price()])[0];
  const host = document.createElement("div");
  document.body.appendChild(host);
  container = host;

  await act(async () => {
    root = createRoot(host);
    root.render(createElement(VenueMenuTab, { venue, tab: "menu" }));
  });

  const drinksButton = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("Drinks"),
  );
  expect(drinksButton).toBeDefined();

  await act(async () => {
    drinksButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  expect(host.querySelector(".drinkMenu")).not.toBeNull();
  return host;
}

describe("drink rating surface fence", () => {
  // Captain, 4 Sept 2026: five empty stars beside a price read as a rating the
  // drink does not have. The Menu is a trust surface - the figure, the source
  // chip and the observation date are all claims somebody stands behind - so an
  // unrated drink says nothing rather than painting a widget with no rating in
  // it. The accessibility tree used to read "★★★★★ ★★★★★" under every drink.
  it("draws no star row under a drink nobody has rated", async () => {
    const host = await openDrinksMenu({});

    expect(host.querySelector(".drinkRatingRow")).toBeNull();
    expect(host.querySelector('[role="slider"]')).toBeNull();
    expect(host.querySelector(".starRatingGlyphs")).toBeNull();
    expect(host.textContent).not.toContain("★");
    // The price and its provenance are untouched: this hides a rating, never a
    // figure.
    expect(host.textContent).toContain("£5.50");
  });

  it("renders the drink rating row through VenueMenuTab -> DrinkMenu once a rating exists", async () => {
    const host = await openDrinksMenu({
      // The stable drink id the menu batches its one GET on.
      "beer-price-1": { shown: true, average: 4.5, count: 12, bayesian: 4.1 },
    });

    const ratingRow = host.querySelector(".drinkRatingRow");
    expect(ratingRow).not.toBeNull();
    expect(host.querySelector('[role="slider"]')?.getAttribute("aria-label")).toBe(
      "Rate London Pride",
    );
    expect(ratingRow?.textContent).toContain("4.5");
    expect(ratingRow?.textContent).toContain("12");
    expect(host.querySelector(".venueRatingPanel")).toBeNull();
    expect(host.querySelector(".topRatedList")).toBeNull();
  });

  it("does not expose the retired top-rated API response", async () => {
    const response = await GET(
      new Request("http://localhost/api/ratings?kind=venue&top=1&limit=10"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summaries: {} });
  });
});
