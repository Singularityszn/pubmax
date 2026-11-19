/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PintDrop } from "@/lib/pintDropShared";
import { venueBundlePrices } from "@/lib/venuePriceLane";
import type { Venue } from "@/lib/venues";

let root: Root;
let host: HTMLDivElement;
let readVenues: typeof import("@/components/map/pubmap/usePublicPriceVenues").usePublicPriceVenues;
const drops = new Map();
const updates: [] = [];
const community = new Map();
let latestVenues: Venue[];

function MapPrices({ venues, venueDrops = drops }: { venues: Venue[]; venueDrops?: Parameters<typeof readVenues>[1] }) {
  const result = readVenues(venues, venueDrops, updates, "london", community);
  latestVenues = result;
  return createElement("output", null, result.map((venue) => venue.publicPricePresence).join(","));
}

function venues(count: number, offset = 0): Venue[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `venue-${index + offset}`, name: `Pub ${index + offset}`, zone: 1,
    cheapestPrice: null, hasRecordedPrice: false, prices: [],
  } as unknown as Venue));
}

async function show(rows: Venue[], venueDrops?: Parameters<typeof readVenues>[1]) {
  await act(async () => root.render(createElement(MapPrices, { venues: rows, venueDrops })));
}

function halfPint(): PintDrop {
  return {
    id: "half-pint", venueId: "venue-0", drink: "Lager", measure: "half", priceGbp: 3,
    handle: "drinker", passedDownNote: "", era: "", provenance: "contributor",
    status: "visible", visibility: "public", createdAt: "2026-11-19T12:00:00Z",
  };
}

function estimatedVenues(count = 1): Venue[] {
  return venues(count).map((venue) => ({
    ...venue,
    bundlePrices: { estimate: { priceGbp: 6, computedAt: "2026-11-19", basis: "regional_baseline:camden", sampleSize: 8 } },
  }));
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

it("rechecks a pub after its recorded price rolls back and reuses the other pub's answer", async () => {
  const rows = venues(2);
  const fresh = Promise.withResolvers<Response>();
  const requested: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const ids = new URL(String(input), "http://localhost").searchParams.getAll("venueId");
    requested.push(ids);
    if (requested.length > 1) return fresh.promise;
    return Response.json({ presence: { "venue-0": "absent", "venue-1": "absent" } });
  }));

  await show(rows);
  expect(host.textContent).toBe("absent,absent");
  await show([{ ...rows[0]!, cheapestPrice: 4 }, rows[1]!]);
  expect(host.textContent).toBe("unknown,absent");
  await show(rows);
  expect(host.textContent?.split(",")[0]).toBe("unknown");
  expect(requested).toEqual([["venue-0", "venue-1"], ["venue-0"]]);
  await act(async () => fresh.resolve(Response.json({ presence: { "venue-0": "present" } })));
  expect(host.textContent).toBe("present,absent");
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

it.each(["public", "anonymous", undefined] as const)("rechecks a %s half-pint price and its rollback without refetching an unchanged pub", async (visibility) => {
  const rows = estimatedVenues(2);
  const added = Promise.withResolvers<Response>();
  const removed = Promise.withResolvers<Response>();
  const requested: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    requested.push(new URL(String(input), "http://localhost").searchParams.getAll("venueId"));
    if (requested.length === 2) return added.promise;
    if (requested.length === 3) return removed.promise;
    return Response.json({ presence: { "venue-0": "absent", "venue-1": "absent" } });
  }));

  await show(rows);
  expect(venueBundlePrices(latestVenues[0]!).estimate?.priceGbp).toBe(6);
  const drop = { ...halfPint(), visibility };
  await show(rows, new Map([["venue-0", [drop]]]));
  expect(latestVenues[0]!.cheapestPrice).toBeNull();
  expect(latestVenues[0]!.publicPricePresence).toBe("unknown");
  expect(venueBundlePrices(latestVenues[0]!).estimate).toBeNull();

  await act(async () => root.render(null));
  await show(rows, new Map([["venue-0", [{ ...drop }]]]));
  expect(requested).toEqual([["venue-0", "venue-1"], ["venue-0"]]);
  await act(async () => added.resolve(Response.json({ presence: { "venue-0": "present" } })));
  expect(host.textContent).toBe("present,absent");
  expect(venueBundlePrices(latestVenues[0]!).estimate).toBeNull();

  await show(rows);
  expect(latestVenues[0]!.publicPricePresence).toBe("unknown");
  expect(venueBundlePrices(latestVenues[0]!).estimate).toBeNull();
  expect(requested).toEqual([["venue-0", "venue-1"], ["venue-0"], ["venue-0"]]);
  await act(async () => removed.resolve(Response.json({ presence: { "venue-0": "absent" } })));
  expect(host.textContent).toBe("absent,absent");
  expect(venueBundlePrices(latestVenues[0]!).estimate?.priceGbp).toBe(6);
});

it("retires pending absence when a half-pint price arrives and rolls back", async () => {
  const rows = estimatedVenues(2);
  const pending: Array<{ answer: ReturnType<typeof Promise.withResolvers<Response>>; signal: AbortSignal | null | undefined }> = [];
  vi.stubGlobal("fetch", vi.fn((_input, options?: RequestInit) => {
    const answer = Promise.withResolvers<Response>();
    pending.push({ answer, signal: options?.signal });
    return answer.promise;
  }));

  await show(rows);
  await show(rows, new Map([["venue-0", [halfPint()]]]));
  expect(pending[0]!.signal?.aborted).toBe(false);
  expect(latestVenues[0]!.publicPricePresence).toBe("unknown");
  expect(venueBundlePrices(latestVenues[0]!).estimate).toBeNull();
  await show(rows);
  expect(pending[1]!.signal?.aborted).toBe(true);
  await act(async () => {
    pending[0]!.answer.resolve(Response.json({ presence: { "venue-0": "absent", "venue-1": "absent" } }));
    pending[1]!.answer.resolve(Response.json({ presence: { "venue-0": "absent" } }));
  });
  expect(latestVenues[0]!.publicPricePresence).toBe("unknown");
  expect(venueBundlePrices(latestVenues[0]!).estimate).toBeNull();
  await act(async () => pending[2]!.answer.resolve(Response.json({ presence: { "venue-0": "absent" } })));
  expect(host.textContent).toBe("absent,absent");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(venueBundlePrices(latestVenues[0]!).estimate?.priceGbp).toBe(6);
});

it.each([
  { visibility: "friends" }, { visibility: "legacy" }, { status: "hidden" }, { provenance: "demo" }, { priceGbp: null },
] as const)("keeps the server authoritative for excluded drop evidence: %o", async (excluded) => {
  const rows = estimatedVenues();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ presence: { "venue-0": "absent" } })));
  await show(rows);
  await show(rows, new Map([["venue-0", [{ ...halfPint(), ...excluded }]]]));
  expect(latestVenues[0]!.cheapestPrice).toBeNull();
  expect(latestVenues[0]!.publicPricePresence).toBe("absent");
  expect(venueBundlePrices(latestVenues[0]!).estimate?.priceGbp).toBe(6);
});

it("shares a half-pint read during upload progress and rechecks the saved drop", async () => {
  const rows = estimatedVenues();
  const uploading = Promise.withResolvers<Response>();
  const saved = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ presence: { "venue-0": "absent" } }))
    .mockReturnValueOnce(uploading.promise)
    .mockReturnValueOnce(saved.promise));
  const drop = halfPint();
  const optimistic = {
    state: "uploading" as const, message: "Uploading", uploadProgress: 10,
    canRetry: false, clientRequestId: "half-pint-request",
  };

  await show(rows);
  await show(rows, new Map([["venue-0", [{ ...drop, optimistic }]]]));
  await show(rows, new Map([["venue-0", [{ ...drop, optimistic: { ...optimistic, uploadProgress: 50 } }]]]));
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => uploading.resolve(Response.json({ presence: { "venue-0": "absent" } })));
  await show(rows, new Map([["venue-0", [drop]]]));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(latestVenues[0]!.publicPricePresence).toBe("unknown");
  expect(venueBundlePrices(latestVenues[0]!).estimate).toBeNull();
  await act(async () => saved.resolve(Response.json({ presence: { "venue-0": "present" } })));
  expect(venueBundlePrices(latestVenues[0]!).estimate).toBeNull();
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
