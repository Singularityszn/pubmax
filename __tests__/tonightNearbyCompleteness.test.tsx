// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/slimShards", () => ({
  createSlimShardLoader: () => ({ nearPoint: async () => ({
    status: "unavailable", rows: [{ id: "partial", name: "Partial Arms", lat: 51.51, lng: -0.13,
      borough: "Soho", cheapestPrice: 4, priceSource: "Menu", priceObservedAt: "2026-01-01" }],
  }) }),
}));
import { useTonightNearbyVenues } from "@/components/tonight/useTonightAnswerReads";
import { tonightCheapestAnswer, tonightCheapestHeading } from "@/lib/tonightAnswers";

afterEach(() => { vi.unstubAllGlobals(); });

it("uses the city answer when one nearby cell failed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    const nearby = useTonightNearbyVenues({ lat: 51.51, lng: -0.13 });
    const answer = tonightCheapestAnswer({ origin: { lat: 51.51, lng: -0.13 }, patch: null, nearby: nearby.rows,
      cityRows: [{ venueId: "city", name: "City Arms", borough: "London", priceGbp: 5, chain: null }] });
    return createElement("span", null, answer ? `${tonightCheapestHeading(answer.basis)}: ${answer.name}` : "none");
  }
  try {
    await act(async () => { root.render(createElement(Probe)); await new Promise((resolve) => setTimeout(resolve, 30)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.textContent).toBe("Cheapest in London: City Arms");
  } finally {
    await act(async () => root.unmount());
  }
});
