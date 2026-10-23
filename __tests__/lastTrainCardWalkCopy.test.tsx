// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LastRidePayload } from "@/lib/lastRideClient";

const live = vi.hoisted(() => ({ payload: null as LastRidePayload | null }));

vi.mock("@/lib/lastRideClient", () => ({
  loadLastRide: () => Promise.resolve(live.payload),
  loadStableLastRide: () => null,
}));

import LastTrainCard from "@/components/map/LastTrainCard";

function payload(walkBasis: "street" | "straight"): LastRidePayload {
  return {
    station: { id: "940GZZLUCHX", name: "Charing Cross", distanceM: 270 },
    trains: [{ lineId: "northern", lineName: "Northern", colour: "#000000", clock: "00:30", pastMidnight: true }],
    departures: [],
    decision: {
      decision: "order_one_more",
      leaveByIso: "2026-10-24T23:19:00.000Z",
      stationName: "Charing Cross",
      lineNames: ["Northern"],
      disruptionSummary: null,
      walkMinutesEstimate: 6,
      bufferMinutes: 5,
      destinationLabel: null,
      live: true,
    },
    nearestPubs: [],
    generatedAt: "2026-10-24T20:00:00.000Z",
    walkBasis,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  live.payload = null;
});

async function renderCard(): Promise<string> {
  await act(async () => {
    root.render(createElement(LastTrainCard, { lat: 51.509, lng: -0.129, venueName: "The Chandos" }));
  });
  return container.querySelector("section")?.textContent ?? "";
}

describe("LastTrainCard station line", () => {
  it("prints the street walk the leave-by clock was built from", async () => {
    live.payload = payload("street");
    const text = await renderCard();
    expect(text).toContain("Charing Cross · 6 min walk");
    expect(text).not.toContain("m away");
  });

  it("keeps the approximate straight-line distance when the walk is not a street walk", async () => {
    live.payload = payload("straight");
    const text = await renderCard();
    expect(text).toContain("Charing Cross · ~270 m away");
    expect(text).not.toContain("min walk");
  });
});
