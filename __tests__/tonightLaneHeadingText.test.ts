// @vitest-environment jsdom

import { createElement, type ComponentType, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import TonightOnTonightSummary from "@/app/tonight/TonightOnTonightSummary";
import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import MusicTonightLane, { type MusicTonightLaneProps } from "@/components/discovery/MusicTonightLane";
import TonightMapPointer from "@/components/discovery/TonightMapPointer";
import type { WhatsOnRow } from "@/lib/whatsOn";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = Date.parse("2026-09-24T19:00:00+01:00");
const HOUR = 60 * 60 * 1000;

const musicRow: WhatsOnRow = {
  id: "music-1",
  placeName: "The Example",
  kind: "music",
  title: "Acoustic set",
  source: { label: "Example", url: "https://example.com/" },
  observedAt: "2026-09-24T12:00:00.000Z",
  confidence: "listed",
};

const dealRow: WhatsOnRow = {
  id: "deal-1",
  placeName: "The Example",
  kind: "deal",
  title: "Two for one",
  startsAt: new Date(NOW - HOUR).toISOString(),
  endsAt: new Date(NOW + 3 * HOUR).toISOString(),
  source: { label: "Example", url: "https://example.com/" },
  observedAt: new Date(NOW - HOUR).toISOString(),
  confidence: "listed",
};

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function headingText(element: ReactElement, headingId: string): string | null | undefined {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
  return container.querySelector(`h2#${headingId}`)?.textContent;
}

describe("tonight lane headings", () => {
  it("prints Live music tonight without a leading space", () => {
    expect(
      headingText(
        createElement(MusicTonightLane as ComponentType<MusicTonightLaneProps>, { rows: [musicRow], asOf: null }),
        "music-tonight-title",
      ),
    ).toBe("Live music tonight");
  });

  it("prints Deals tonight without a leading space", () => {
    expect(
      headingText(createElement(DealsTonightLane, { rows: [dealRow], now: NOW }), "deals-tonight-title"),
    ).toBe("Deals tonight");
  });

  it("prints the map pointer's On tonight without a leading space", () => {
    expect(headingText(createElement(TonightMapPointer), "tonight-map-pointer-title")).toBe("On tonight");
  });

  it("prints the rail summary's On tonight without a leading space", () => {
    expect(
      headingText(
        createElement(TonightOnTonightSummary, {
          facets: [{ kind: "deal", label: "Deals", count: 1 }],
          rows: [dealRow],
          totalCount: 1,
          now: NOW,
        }),
        "tonight-rail-summary-title",
      ),
    ).toBe("On tonight");
  });
});
