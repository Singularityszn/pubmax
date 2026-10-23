// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenueHygiene from "@/components/map/VenueHygiene";
import VenueSpoonsValueRow from "@/components/map/inspector/VenueSpoonsValueRow";
import { READ_PHASE_DELAY_MS } from "@/lib/useStaggeredRead";

// A venue sheet's lower panels wait for their phase before they read, and the
// sheet is not remounted from one pub to the next. The wait must never ask for
// a panel nobody can see, and must never show one pub's answer under another.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;

const asked = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith(path));

async function settle(ms = 0) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  for (let i = 0; i < 5; i += 1) await act(async () => Promise.resolve());
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the spoons value row", () => {
  it("asks nothing while the sheet is showing something else", async () => {
    act(() => root.render(createElement(VenueSpoonsValueRow, { venueId: "venue-a", visible: false })));
    await settle(READ_PHASE_DELAY_MS[2] + 1_000);
    expect(asked("/api/spoons-value")).toEqual([]);
  });

  it("asks for its own pub only once its phase has come", async () => {
    act(() => root.render(createElement(VenueSpoonsValueRow, { venueId: "venue-a", visible: true })));
    await settle(READ_PHASE_DELAY_MS[2] - 1);
    expect(asked("/api/spoons-value")).toEqual([]);
    await settle(1);
    expect(asked("/api/spoons-value").map(([url]) => url)).toEqual([
      "/api/spoons-value?venueId=venue-a",
    ]);
  });
});

describe("the hygiene badge", () => {
  const rating = {
    fhrsid: 1,
    ratingValue: 5,
    ratingDate: null,
    businessName: "The Lamb",
    localAuthority: null,
  };

  it("drops the previous pub's rating the moment another pub opens", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ rating }), { status: 200 }),
    );
    const show = (venueId: string, venueName: string) =>
      act(() =>
        root.render(
          createElement(VenueHygiene, { venueId, venueName, address: "94 Lamb's Conduit St, WC1N 3LZ" }),
        ),
      );

    show("venue-a", "The Lamb");
    await settle(READ_PHASE_DELAY_MS[2]);
    expect(container.querySelector(".venueHygiene")).not.toBeNull();

    show("venue-b", "The Perseverance");
    expect(container.querySelector(".venueHygiene")).toBeNull();
    await settle(READ_PHASE_DELAY_MS[2] - 1);
    expect(container.querySelector(".venueHygiene")).toBeNull();
  });
});
