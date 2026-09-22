// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import type { WhatsOnRow } from "@/lib/whatsOn";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loadSurfaceJson = vi.hoisted(() => vi.fn());

vi.mock("@/lib/surfaceDataCache", () => ({
  loadSurfaceJson,
}));

const NOW = Date.parse("2026-09-21T18:00:00Z");

function dealEndingAt(endsAt: number): WhatsOnRow {
  return {
    id: "expiring-deal",
    kind: "deal",
    venueId: "fixture",
    placeName: "Fixture pub",
    title: "Expiring deal",
    startsAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    observedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    confidence: "listed",
    source: {
      label: "Official fixture",
      url: "https://example.com/listing",
    },
  };
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  root = createRoot(host);
  loadSurfaceJson.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("DealsTonightLane lifecycle", () => {
  it("removes a self-fetched deal at its end boundary while Discover is idle", async () => {
    loadSurfaceJson.mockImplementation(
      async (
        _url: string,
        _options: unknown,
        receive: (body: unknown) => void,
      ) => {
        receive({ rows: [dealEndingAt(NOW + 30_000)] });
        return "network";
      },
    );

    await act(async () => {
      root.render(createElement(DealsTonightLane));
    });

    expect(loadSurfaceJson).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Expiring deal");

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(host.textContent).not.toContain("Expiring deal");
  });

  it.each(["visibilitychange", "pageshow"] as const)(
    "refreshes expired deals after %s",
    async (eventName) => {
      await act(async () => {
        root.render(
          createElement(DealsTonightLane, {
            rows: [dealEndingAt(NOW + 60_000)],
          }),
        );
      });

      vi.setSystemTime(NOW + 60_001);
      await act(async () => {
        const target = eventName === "visibilitychange" ? document : window;
        target.dispatchEvent(new Event(eventName));
      });

      expect(host.textContent).not.toContain("Expiring deal");
    },
  );
});
