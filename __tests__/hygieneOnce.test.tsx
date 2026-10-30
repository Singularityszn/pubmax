// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { READ_PHASE_DELAY_MS } from "@/lib/useStaggeredRead";
import { resetFsaHygieneMatchedForTests } from "@/lib/fsaHygieneMatched";

// HYGIENE IS SAID ONCE, AND THE FSA SAYS IT (launch UX micro-fix 2). The venue
// sheet's Overview printed "Food hygiene 5/5" in the CityMCP strip and the FSA
// badge, with its date and source, lower down. Once the FSA answers for a pub,
// the strip drops its own line; where the FSA has no match, the strip's line
// is the only one, so it stays.

vi.mock("@/lib/cityPlaceSearch", () => ({
  searchCityPlacesByName: vi.fn(async () => [
    { id: "place-lamb", name: "The Lamb", location: { lat: 51.5226, lng: -0.1188 } },
  ]),
}));

const { default: CityPlaceStrip } = await import("@/components/map/CityPlaceStrip");
const { default: VenueHygiene } = await import("@/components/map/VenueHygiene");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VENUE = {
  venueId: "venue-lamb",
  venueName: "The Lamb",
  latitude: 51.5226,
  longitude: -0.1188,
};

const PLACE = {
  id: "place-lamb",
  rating: 4.5,
  hygiene: { value: { businessName: "The Lamb", rating: 5 }, source: "FSA via CityMCP" },
};

const FSA_RATING = {
  fhrsid: 1,
  ratingValue: 5,
  ratingDate: "2025-06-01",
  businessName: "The Lamb",
  localAuthority: "Camden",
};

let root: Root;
let container: HTMLElement;

function stubFetch(hygieneBody: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/citymcp/place")) {
        return new Response(JSON.stringify({ place: PLACE }), { status: 200 });
      }
      if (String(url).startsWith("/api/hygiene")) {
        return new Response(JSON.stringify(hygieneBody), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

async function settle(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  for (let i = 0; i < 8; i += 1) await act(async () => Promise.resolve());
}

function renderSheet() {
  act(() =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(CityPlaceStrip, { ...VENUE, cityId: "london" }),
        createElement(VenueHygiene, {
          venueId: VENUE.venueId,
          venueName: VENUE.venueName,
          address: "94 Lamb's Conduit St, WC1N 3LZ",
        }),
      ),
    ),
  );
}

const lastPhase = Math.max(...Object.values(READ_PHASE_DELAY_MS)) + 1;

beforeEach(() => {
  vi.useFakeTimers();
  resetFsaHygieneMatchedForTests();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hygiene on the venue sheet", () => {
  it("prints the FSA badge alone when the FSA matched the pub", async () => {
    stubFetch({ rating: FSA_RATING });
    renderSheet();
    await settle(lastPhase);

    expect(container.querySelector(".venueHygiene")).not.toBeNull();
    // The strip still renders its other facts, without a hygiene line.
    expect(container.querySelector(".cityPlaceStrip")).not.toBeNull();
    expect(container.querySelector('.cityPlaceStripChip[data-kind="hygiene"]')).toBeNull();
    expect(container.textContent?.match(/Food hygiene/g)).toHaveLength(1);
  });

  it("keeps the strip's line where the FSA has no match", async () => {
    stubFetch({ rating: null });
    renderSheet();
    await settle(lastPhase);

    expect(container.querySelector(".venueHygiene")).toBeNull();
    expect(container.querySelector('.cityPlaceStripChip[data-kind="hygiene"]')?.textContent).toContain(
      "Food hygiene 5/5",
    );
  });
});
