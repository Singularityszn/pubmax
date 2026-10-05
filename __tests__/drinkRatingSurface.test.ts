// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

// The rating write goes through authedActionFetch, which retries a token read
// on real timers before it will send. A resolved token keeps the write on the
// first attempt, so the assertion below measures the surface and not that
// retry ladder.
vi.mock("@/lib/authClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authClient")>();
  return { ...actual, getAccessToken: async () => "test-access-token" };
});

import VenueMenuTab from "@/components/map/inspector/VenueMenuTab";
import { GET } from "@/app/api/ratings/route";
import { publishAuthActionState } from "@/lib/authedFetch";
import { MIN_VOTES_TO_SHOW } from "@/lib/ratings";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { __resetMemoryRatings } from "@/lib/ratingsStore";
import { defined } from "@/__tests__/helpers/defined";

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
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

/** Let the batched summary read and any queued write settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function openDrinksMenu(
  summaries: Record<string, unknown>,
  postSummary?: Record<string, unknown>,
): Promise<HTMLDivElement> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.method === "POST" ? { summary: postSummary } : { summaries };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );

  const venue = groupVenuePrices([price()])[0];
  const host = document.createElement("div");
  document.body.appendChild(host);
  container = host;

  await act(async () => {
    root = createRoot(host);
    root.render(createElement(VenueMenuTab, { venue: defined(venue), tab: "menu" }));
  });

  const drinksButton = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("Drinks"),
  );
  expect(drinksButton).toBeDefined();

  await act(async () => {
    drinksButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();

  expect(host.querySelector(".drinkMenu")).not.toBeNull();
  return host;
}

async function press(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function key(element: Element | null | undefined, name: string): Promise<void> {
  expect(element).toBeTruthy();
  await act(async () => {
    element?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
  await settle();
}

/** The drink's own disclosure: the control a drinker taps to open its detail. */
function disclosure(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(".drinkDisclosure");
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

/** The detail region for the one drink this fixture renders. */
function detail(host: HTMLElement): HTMLElement {
  const region = host.querySelector<HTMLElement>(".drinkRowDetail");
  expect(region).not.toBeNull();
  return region as HTMLElement;
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

  // The consequence of that hiding, and this change's whole reason: the star
  // row was the only door on to a first vote, and the floor is
  // MIN_VOTES_TO_SHOW, so with the row gone the Menu could never gain one.
  it("keeps a first vote reachable while the floor is above one vote", () => {
    expect(MIN_VOTES_TO_SHOW).toBeGreaterThan(1);
  });

  it("puts no rate action on the price line and exactly one inside the detail", async () => {
    const host = await openDrinksMenu({});

    // Closed: the drink offers its own words and nothing else.
    const trigger = disclosure(host);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(detail(host).hasAttribute("hidden")).toBe(true);
    expect(host.querySelectorAll(".drinkRateAction")).toHaveLength(0);

    await press(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(detail(host).id);
    const open = detail(host);
    expect(open.hasAttribute("hidden")).toBe(false);
    // ONE action, and it lives in the detail, never on the price line.
    const actions = host.querySelectorAll(".drinkRateAction");
    expect(actions).toHaveLength(1);
    expect(open.contains(actions[0] as Node)).toBe(true);
    expect(actions[0]?.textContent).toBe("Rate this drink");
    // No stars are announced until the drinker asks for the picker.
    expect(host.querySelector('[role="slider"]')).toBeNull();
    expect(host.textContent).not.toContain("★");
  });

  it("opens the existing picker from that one action", async () => {
    const host = await openDrinksMenu({});
    await press(disclosure(host));
    await press(host.querySelector(".drinkRateAction"));

    const picker = detail(host).querySelector('[role="slider"]');
    expect(picker).not.toBeNull();
    expect(picker?.getAttribute("aria-label")).toBe("Rate London Pride");
    // The action is spent: the detail still carries exactly one way to rate.
    expect(host.querySelectorAll(".drinkRateAction")).toHaveLength(0);
    // Nothing about a picker reaches the price line.
    expect(host.querySelector(".drinkRatingRow")).toBeNull();
  });

  it("shows a cast vote in the detail, and the crowd's score on the price line", async () => {
    window.localStorage.setItem("pubmax_handle", "thirsty");
    publishAuthActionState({ status: "signed-in", identityResolved: true });

    const host = await openDrinksMenu(
      {},
      { shown: true, average: 4.5, count: MIN_VOTES_TO_SHOW, bayesian: 4.1 },
    );
    await press(disclosure(host));
    await press(host.querySelector(".drinkRateAction"));

    const picker = detail(host).querySelector('[role="slider"]');
    // Keyboard commit: the row starts unrated, so ArrowRight lands on 3.5.
    await key(picker, "ArrowRight");
    await key(picker, "Enter");

    // The drinker's own vote is in the detail, and only there.
    expect(detail(host).textContent).toContain("Your rating: 3.5");
    expect(
      detail(host).querySelector('[role="slider"]')?.getAttribute("aria-valuenow"),
    ).toBe("3.5");

    // That write crossed the floor, so the crowd's score now appears on the
    // price line - read-only, and never the drinker's own figure.
    const summaryLine = host.querySelector(".drinkRatingRow");
    expect(summaryLine).not.toBeNull();
    expect(summaryLine?.textContent).toContain("4.5");
    expect(summaryLine?.textContent).toContain(String(MIN_VOTES_TO_SHOW));
    expect(summaryLine?.textContent).not.toContain("3.5");
    expect(summaryLine?.querySelector('[role="slider"]')).toBeNull();
  });

  it("renders the price-line summary through VenueMenuTab -> DrinkMenu once past the floor", async () => {
    const host = await openDrinksMenu({
      // The stable drink id the menu batches its one GET on.
      "beer-price-1": { shown: true, average: 4.5, count: 12, bayesian: 4.1 },
    });

    const ratingRow = host.querySelector(".drinkRatingRow");
    expect(ratingRow).not.toBeNull();
    expect(ratingRow?.textContent).toContain("4.5");
    expect(ratingRow?.textContent).toContain("12");
    // The price line states a finished claim. It announces an image, never a
    // widget asking to be filled in.
    const stars = ratingRow?.querySelector('[role="img"]');
    expect(stars?.getAttribute("aria-label")).toBe(
      "London Pride rating: 4.5 out of 5 stars",
    );
    expect(ratingRow?.querySelector('[role="slider"]')).toBeNull();
    expect(host.querySelector(".venueRatingPanel")).toBeNull();
    expect(host.querySelector(".topRatedList")).toBeNull();
  });

  it("holds a below-floor score off the price line and still offers the action", async () => {
    const host = await openDrinksMenu({
      "beer-price-1": { shown: false, average: 4.5, count: 3, bayesian: 3.7 },
    });

    expect(host.querySelector(".drinkRatingRow")).toBeNull();
    expect(host.textContent).not.toContain("4.5");

    await press(disclosure(host));
    expect(host.querySelectorAll(".drinkRateAction")).toHaveLength(1);
  });

  it("does not expose the retired top-rated API response", async () => {
    const response = await GET(
      new Request("http://localhost/api/ratings?kind=venue&top=1&limit=10"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summaries: {} });
  });
});
