// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  useAccount.mockReturnValue({ profile: null, status: "signed-out" });
  baseProps.onSelectVenue.mockReset();
});

describe("map nearby discovery", () => {
  it("shows one merged card and opens the same branch", () => {
    render(<MapNearbyDiscovery {...baseProps} />);
    expect(screen.getByText("Cheapest and best match")).toBeTruthy();
    expect(screen.getByText("Guinness · pint")).toBeTruthy();
    expect(screen.getByText(/Camden/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pint Prices" }).getAttribute("href")).toBe("https://www.pint-prices.com/pub/crown");
    expect(screen.getByText(/Read 20 Oct 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open The Crown" }));
    expect(baseProps.onSelectVenue).toHaveBeenCalledWith("venue-crown");
  });

  it("keeps current results during a saved preference read", () => {
    useAccount.mockReturnValue({ profile: null, status: "loading" });
    render(<MapNearbyDiscovery {...baseProps} />);
    expect(screen.getByRole("status").textContent).toContain("Checking saved preferences");
    expect(screen.getByRole("button", { name: "Open The Crown" })).toBeTruthy();
  });

  it("applies a saved different drink only through the explicit action", () => {
    const onApplyFilters = vi.fn();
    useAccount.mockReturnValue({ profile: { ...DEFAULT_NIGHT_PROFILE_INPUT, context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, drinkCategory: "gin" } }, status: "ready" });
    render(<MapNearbyDiscovery {...baseProps} onApplyFilters={onApplyFilters} />);
    expect(screen.getByText("Guinness · pint")).toBeTruthy();
    expect(onApplyFilters).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use saved preferences" }));
    expect(onApplyFilters).toHaveBeenCalledWith(expect.objectContaining({ drinkCategory: "gin" }));
  });

  it("labels an unknown community serving and never gives it pint units", () => {
    const lensPrices = new Map([["venue-crown", { venueId: "venue-crown", category: "gin" as const, categoryLabel: "Gin", priceGbp: 3.5, source: "community" as const }]]);
    render(<MapNearbyDiscovery {...baseProps} filters={{ ...initialFilters, drinkCategory: "gin" }} lensPrices={lensPrices} />);
    expect(screen.getByText("Gin · Serving size not recorded")).toBeTruthy();
    expect(screen.queryByText("Guinness · pint")).toBeNull();
  });

  it("gives an empty result a clear filter action and an area route", () => {
    const onApplyFilters = vi.fn();
    render(<MapNearbyDiscovery {...baseProps} venues={[]} onApplyFilters={onApplyFilters} />);
    expect(screen.getByText("No priced pub matches these choices within 2.5 km.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear map filters" }));
    expect(onApplyFilters).toHaveBeenCalledWith(initialFilters);
    expect(screen.getByRole("link", { name: "Choose another area" }).getAttribute("href")).toBe("/near");
  });
});

it("lets the map sheet own the only heading", () => {
  render(<MapNearbyDiscovery {...baseProps} titledByHost />);
  expect(screen.queryByRole("heading", { name: "Near you" })).toBeNull();
  expect(screen.getByText("Near you")).toBeTruthy();
});


it("keeps the current favourite pint ahead of a saved different drink", () => {
  useAccount.mockReturnValue({ profile: { ...DEFAULT_NIGHT_PROFILE_INPUT, context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, drinkCategory: "gin" } }, status: "ready" });
  const venue = nearbyVenue({ prices: [nearbyPriceRow({ pint_name: "Amstel", price_gbp: 3 }), nearbyPriceRow()], cheapestPrice: 3, cheapestPint: "Amstel" });
  render(<MapNearbyDiscovery {...baseProps} venues={[venue]} favoritePint="guinness" />);
  expect(screen.getByText("Guinness · pint")).toBeTruthy();
  expect(screen.queryByText("Amstel · pint")).toBeNull();
  expect(screen.queryByRole("button", { name: "Use saved preferences" })).toBeNull();
});
