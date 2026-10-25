// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import VenueFeatureFilters from "@/components/map/VenueFeatureFilters";
import { initialFilters } from "@/lib/venues";

describe("the map's shared pub feature controls", () => {
  it("sets outdoor seating without changing the query or garden choice, and names its source", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const onChange = vi.fn();
    const filters = { ...initialFilters, query: "Camden", requireBeerGarden: true };
    act(() => root.render(createElement(VenueFeatureFilters, { filters, onChange, resultCount: 8 })));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Outdoor seating");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    act(() => button?.click());
    expect(onChange).toHaveBeenCalledWith({ ...filters, requireOutdoorSeating: true });
    expect(host.textContent).toContain("OpenStreetMap and Google Places");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("8 matching places loaded on the map.");
    act(() => root.unmount());
  });
  it("clears all feature choices together and leaves other filters alone", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const onChange = vi.fn();
    const filters = { ...initialFilters, query: "Camden", maxPrice: 5, requireBeerGarden: true, requireOutdoorSeating: true, openNow: true };
    act(() => root.render(createElement(VenueFeatureFilters, { filters, onChange, resultCount: 0 })));
    expect(host.textContent).toContain("Pubs without hours stay visible");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("0 matching places loaded on the map.");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Clear features");
    act(() => button?.click());
    expect(onChange).toHaveBeenCalledWith({ ...filters, requireBeerGarden: false, requireOutdoorSeating: false, openNow: false });
    act(() => root.unmount());
  });
});
