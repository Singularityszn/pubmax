// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapNearbyDiscovery from "@/components/map/MapNearbyDiscovery";
import { DEFAULT_NIGHT_PROFILE_INPUT } from "@/lib/nightProfile";
import { initialFilters } from "@/lib/venues";
import { nearbyPriceRow, nearbyVenue } from "./helpers/mapNearbyFixtures";

const { useAccount } = vi.hoisted(() => ({ useAccount: vi.fn() }));
vi.mock("@/lib/useMapNearbyProfile", () => ({ useMapNearbyProfile: useAccount }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => ({ user: null, session: null, identityResolved: true, accountRevision: 0, providerAuthState: "signed-out", loading: false }) }));

const baseProps = {
  cityId: "london", venues: [nearbyVenue()], filters: initialFilters,
  location: { lat: 51.5, lng: -0.1 }, lensPrices: null, onSelectVenue: vi.fn(),
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  useAccount.mockReturnValue({ profile: null, status: "signed-out" });
  baseProps.onSelectVenue.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(element: ReactNode) {
  await act(async () => root.render(element));
}

function button(name: string): HTMLButtonElement {
  const matches = [...host.querySelectorAll("button")].filter((element) =>
    (element.getAttribute("aria-label") ?? element.textContent?.trim()) === name);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe("map nearby discovery", () => {
  it("shows one merged card and opens the same branch", async () => {
    await render(<MapNearbyDiscovery {...baseProps} />);
    expect(host.querySelectorAll("article")).toHaveLength(1);
    expect(host.textContent).toContain("Cheapest and best match");
    expect(host.textContent).toContain("Guinness · pint");
    expect(host.textContent).toContain("Camden");
    const source = [...host.querySelectorAll("a")].filter((link) => link.textContent === "Pint Prices");
    expect(source).toHaveLength(1);
    expect(source[0]?.getAttribute("href")).toBe("https://www.pint-prices.com/pub/crown");
    expect(host.textContent).toContain("Read 20 Oct 2026");
    await act(async () => button("Open The Crown").click());
    expect(baseProps.onSelectVenue).toHaveBeenCalledWith("venue-crown");
  });

  it("keeps current results during a saved preference read", async () => {
    useAccount.mockReturnValue({ profile: null, status: "loading" });
    await render(<MapNearbyDiscovery {...baseProps} />);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Checking saved preferences");
    expect(button("Open The Crown")).toBeTruthy();
  });

  it("applies a saved different drink only through the explicit action", async () => {
    const onApplyFilters = vi.fn();
    useAccount.mockReturnValue({ profile: { ...DEFAULT_NIGHT_PROFILE_INPUT, context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, drinkCategory: "gin" } }, status: "ready" });
    await render(<MapNearbyDiscovery {...baseProps} onApplyFilters={onApplyFilters} />);
    expect(host.textContent).toContain("Guinness · pint");
    expect(onApplyFilters).not.toHaveBeenCalled();
    await act(async () => button("Use saved preferences").click());
    expect(onApplyFilters).toHaveBeenCalledWith(expect.objectContaining({ drinkCategory: "gin" }));
  });

  it("labels an unknown community serving and never gives it pint units", async () => {
    const lensPrices = new Map([["venue-crown", { venueId: "venue-crown", category: "gin" as const, categoryLabel: "Gin", priceGbp: 3.5, source: "community" as const }]]);
    await render(<MapNearbyDiscovery {...baseProps} filters={{ ...initialFilters, drinkCategory: "gin" }} lensPrices={lensPrices} />);
    expect(host.textContent).toContain("Gin · Serving size not recorded");
    expect(host.textContent).not.toContain("Guinness · pint");
  });

  it("gives an empty result a clear filter action and an area route", async () => {
    const onApplyFilters = vi.fn();
    await render(<MapNearbyDiscovery {...baseProps} venues={[]} onApplyFilters={onApplyFilters} />);
    expect(host.textContent).toContain("No priced pub matches these choices within 2.5 km.");
    await act(async () => button("Clear map filters").click());
    expect(onApplyFilters).toHaveBeenCalledWith(initialFilters);
    const area = [...host.querySelectorAll("a")].filter((link) => link.textContent === "Choose another area");
    expect(area).toHaveLength(1);
    expect(area[0]?.getAttribute("href")).toBe("/near");
  });
});

it("lets the map sheet own the only heading", async () => {
  await render(<MapNearbyDiscovery {...baseProps} titledByHost />);
  expect([...host.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter((heading) => heading.textContent === "Near you")).toHaveLength(0);
  expect(host.textContent).toContain("Near you");
});


it("keeps the current favourite pint ahead of a saved different drink", async () => {
  useAccount.mockReturnValue({ profile: { ...DEFAULT_NIGHT_PROFILE_INPUT, context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, drinkCategory: "gin" } }, status: "ready" });
  const venue = nearbyVenue({ prices: [nearbyPriceRow({ pint_name: "Amstel", price_gbp: 3 }), nearbyPriceRow()], cheapestPrice: 3, cheapestPint: "Amstel" });
  await render(<MapNearbyDiscovery {...baseProps} venues={[venue]} favoritePint="guinness" />);
  expect(host.textContent).toContain("Guinness · pint");
  expect(host.textContent).not.toContain("Amstel · pint");
  expect([...host.querySelectorAll("button")].filter((element) => element.textContent === "Use saved preferences")).toHaveLength(0);
});
