/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Venue } from "@/lib/venues";

let root: Root;
let host: HTMLDivElement;
let readVenues: typeof import("@/components/map/pubmap/usePublicPriceVenues").usePublicPriceVenues;
const drops = new Map();
const updates: [] = [];
const community = new Map();

function MapPrices({ venues }: { venues: Venue[] }) {
  const result = readVenues(venues, drops, updates, "london", community);
  return createElement("output", null, result.map((venue) => venue.publicPricePresence).join(","));
}

function venues(count: number, offset = 0): Venue[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `venue-${index + offset}`, name: `Pub ${index + offset}`, zone: 1,
    cheapestPrice: null, hasRecordedPrice: false, prices: [],
  } as unknown as Venue));
}

async function show(rows: Venue[]) {
  await act(async () => root.render(createElement(MapPrices, { venues: rows })));
}

beforeEach(async () => {
  vi.resetModules();
  readVenues = (await import("@/components/map/pubmap/usePublicPriceVenues")).usePublicPriceVenues;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps returning map visits within the public read budget", async () => {
  // The route permits 60 reads per minute. Returning to the same pubs must
  // not exhaust that budget or turn a completed presence read into unknown.
  let requests = 0;
  const refused: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const ids = new URL(String(input), "http://localhost").searchParams.getAll("venueId");
    if (++requests > 60) {
      refused.push(String(input));
      return Response.json({ code: "RATE_LIMITED" }, { status: 429 });
    }
    return Response.json({ presence: Object.fromEntries(ids.map((id) => [id, "absent"])) });
  }));

  await show(venues(3200));
  expect(host.textContent?.split(",")).toEqual(Array(3200).fill("absent"));
  await act(async () => root.render(null));
  await show(venues(3200).reverse());

  expect(refused).toEqual([]);
  expect(host.textContent?.split(",")).toEqual(Array(3200).fill("absent"));
  expect(requests).toBe(32);
});

it("shares an unfinished read when the map remounts", async () => {
  let answer!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
  await show(venues(2));
  await act(async () => root.render(null));
  await show(venues(2).reverse());
  expect(host.textContent).toBe("unknown,unknown");

  await act(async () => answer(Response.json({ presence: { "venue-0": "absent", "venue-1": "present" } })));

  expect(host.textContent).toBe("present,absent");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("requests only newly added pubs when the map data changes", async () => {
  const requested: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const ids = new URL(String(input), "http://localhost").searchParams.getAll("venueId");
    requested.push(ids);
    return Response.json({ presence: Object.fromEntries(ids.map((id) => [id, "absent"])) });
  }));
  await show(venues(2));
  await show(venues(3).reverse());

  expect(requested).toEqual([["venue-0", "venue-1"], ["venue-2"]]);
  expect(host.textContent).toBe("absent,absent,absent");
});

it("rechecks expired absence before returning an estimate", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ presence: { "venue-0": "absent" } })));
  await show(venues(1));
  expect(host.textContent).toBe("absent");
  now.mockReturnValue(1_060_000);
  let answer!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
  await show(venues(1));
  expect(host.textContent).toBe("unknown");

  await act(async () => answer(Response.json({ presence: { "venue-0": "present" } })));

  expect(host.textContent).toBe("present");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["refused", "offline", "degraded", "unknown", "missing"])("retries a %s map read without treating it as absence", async (failure) => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (failure === "offline") throw new Error("offline");
    if (failure === "refused") return Response.json({}, { status: 429 });
    return Response.json({
      presence: failure === "missing" ? {} : { "venue-0": failure === "unknown" ? "unknown" : "absent" },
      degraded: failure === "degraded",
    });
  }));
  await show(venues(1));
  expect(host.textContent).toBe("unknown");
  vi.mocked(fetch).mockImplementation(async () => Response.json({ presence: { "venue-0": "present" } }));
  await show(venues(1));

  expect(host.textContent).toBe("present");
  expect(fetch).toHaveBeenCalledTimes(2);
});
