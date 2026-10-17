// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LastTrainResult } from "@/lib/tfl";

// Two lines whose last trains are both after midnight, in the order the route
// used to send them (a string sort, earliest first). The leave-by time is
// computed from the LATEST, 00:40: a 5 minute walk plus a 5 minute buffer.
const result: LastTrainResult = {
  station: { id: "940GZZLUOXC", name: "Oxford Circus", distanceM: 0 },
  trains: [
    { lineId: "central", lineName: "Central", colour: "#e32017", clock: "00:15", pastMidnight: true, serviceHour: 24 },
    { lineId: "victoria", lineName: "Victoria", colour: "#0098d4", clock: "00:40", pastMidnight: true, serviceHour: 24 },
  ],
  departures: [],
  decision: {
    decision: "order_one_more",
    leaveByIso: "2026-07-10T23:30:00.000Z",
    stationName: "Oxford Circus",
    lineNames: ["Central", "Victoria"],
    disruptionSummary: null,
    walkMinutesEstimate: 5,
    bufferMinutes: 5,
    destinationLabel: null,
    live: true,
  },
  nearestPubs: [],
  generatedAt: "2026-07-10T22:00:00.000Z",
};

vi.mock("@/lib/lastRideClient", () => ({
  loadLastRide: () => Promise.resolve(result),
  loadStableLastRide: () => null,
}));

import LastTrainCard from "@/components/map/LastTrainCard";

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
  vi.restoreAllMocks();
  delete (navigator as { share?: unknown }).share;
});

describe("LastTrainCard crew share", () => {
  it("names the train the leave-by time was computed from", async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    await act(async () => {
      root.render(
        createElement(LastTrainCard, { lat: 51.515, lng: -0.142, venueName: "The Lamb" }),
      );
    });

    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Send to crew",
    );
    expect(button).toBeDefined();
    await act(async () => {
      button!.click();
    });

    expect(share).toHaveBeenCalledTimes(1);
    const text = share.mock.calls[0]![0].text ?? "";
    expect(text).toContain("Last train home: 00:40 from Oxford Circus.");
    expect(text).toContain("Leave by 00:30.");
    expect(text).not.toContain("00:15");
  });
});
