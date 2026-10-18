// @vitest-environment jsdom

import { createElement, type ComponentType, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TonightOnTonightSummary from "@/app/tonight/TonightOnTonightSummary";
import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import MusicTonightLane, { type MusicTonightLaneProps } from "@/components/discovery/MusicTonightLane";
import TonightMapPointer from "@/components/discovery/TonightMapPointer";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

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
  clearSurfaceCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  it("renders every valid self-fetched music card, dated by the music feed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const rows = Array.from({ length: 4 }, (_, index) => ({
      ...musicRow,
      id: `music-${index}`,
      title: `Acoustic set ${index}`,
      startsAt: new Date(NOW).toISOString(),
      observedAt: index === 1 ? "2026-09-23T12:00:00Z" : musicRow.observedAt,
    }));
    // The page-level asOf can be a bundled file's build day, so the lane
    // reads only the music feed's own check.
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      rows: [...rows, { ...musicRow, id: "invalid", title: "Invalid listing", source: null }],
      asOf: "2026-09-24T17:00:00Z",
      kindObservedAt: { music: "2026-09-21T12:00:00Z" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      headingText(createElement(MusicTonightLane), "music-tonight-title");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/whats-on?kind=music&window=tonight&limit=8",
      expect.any(Object),
    );
    expect(Array.from(container!.querySelectorAll(".dealsTonightCard strong"), (card) => card.textContent))
      .toEqual(["Acoustic set 0", "Acoustic set 1", "Acoustic set 2", "Acoustic set 3"]);
    expect(container?.querySelector(".dealsTonightChecked")?.textContent).toBe("Checked 21 Sept");
  });

  it("is undated on self-fetch when the music feed holds no check", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      rows: [{ ...musicRow, startsAt: new Date(NOW).toISOString() }],
      asOf: "2026-09-24T17:00:00Z",
      kindObservedAt: {},
    })));

    await act(async () => {
      headingText(createElement(MusicTonightLane), "music-tonight-title");
    });

    expect(container?.querySelector(".dealsTonightChecked")?.textContent).toBe("No date on this yet");
  });

  it("prints the date the host covered the cards with, never a card's own observedAt", () => {
    // A live card's observedAt can be the request instant (lib/whatsOnCitymcp.ts).
    headingText(createElement(MusicTonightLane as ComponentType<MusicTonightLaneProps>, {
      rows: [{ ...musicRow, title: "ABBA Voyage", observedAt: "2026-10-18T10:00:00Z" }],
      asOf: "2026-10-07T18:00:00Z",
    }), "music-tonight-title");
    expect(container?.querySelector(".dealsTonightChecked")?.textContent).toBe("Checked 7 Oct");
  });

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
