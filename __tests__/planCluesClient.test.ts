import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPlanClueLegs } from "@/lib/planCluesClient";

const stops = [
  { venueId: "first-pub", venueName: "First", position: 0 },
  { venueId: "second-pub", venueName: "Second", position: 1 },
];

afterEach(() => vi.useRealTimers());

function publicRead(source: string) {
  return vi.fn<typeof fetch>(async (input) => {
    if (String(input).startsWith("/api/venue/")) return Response.json({ venue: { longitude: -0.1246, latitude: 51.5007 } });
    return Response.json({ source, line: { type: "FeatureCollection", features: [{ type: "Feature", geometry: {
      type: "LineString", coordinates: [[-0.125, 51.5007], [-0.1246, 51.5007], [-0.124, 51.5007]],
    } }] } });
  });
}

describe("clue reads use the public route boundary", () => {
  it("requests each actual pair and retains its routed geometry", async () => {
    const request = publicRead("ors");
    const result = await loadPlanClueLegs(stops, new AbortController().signal, request);
    expect(result).toEqual([{ fromIndex: 0, toIndex: 1, source: "ors", coordinates: [
      [-0.125, 51.5007], [-0.1246, 51.5007], [-0.124, 51.5007],
    ] }]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(String(request.mock.calls[2]?.[0])).toMatch(/^\/api\/walk-route\?stops=/);
    for (const [, options] of request.mock.calls) expect(options?.method).toBeUndefined();
  });

  it("offers no geometry from straight fallback, failed reads or missing venue coordinates", async () => {
    expect(await loadPlanClueLegs(stops, new AbortController().signal, publicRead("straight"))).toEqual([]);
    const failed = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    expect(await loadPlanClueLegs(stops, new AbortController().signal, failed)).toEqual([]);
    const missing = vi.fn<typeof fetch>(async () => Response.json({ venue: {} }));
    expect(await loadPlanClueLegs(stops, new AbortController().signal, missing)).toEqual([]);
    expect(missing).toHaveBeenCalledTimes(2);
  });

  it("discards results after cancellation and bounds the number of route requests", async () => {
    const controller = new AbortController();
    const request = publicRead("ors");
    controller.abort();
    expect(await loadPlanClueLegs(stops, controller.signal, request)).toEqual([]);
    expect(await loadPlanClueLegs(Array.from({ length: 9 }, () => stops[0]!), new AbortController().signal, request)).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["venue", "fetch"], ["venue", "body"], ["walk", "fetch"], ["walk", "body"],
  ])("finishes after eight seconds when the %s %s stalls", async (endpoint, stage) => {
    vi.useFakeTimers();
    const request = publicRead("ors");
    const workingRead = request.getMockImplementation()!;
    request.mockImplementation(async (input, options) => {
      const matches = endpoint === "venue" ? String(input).startsWith("/api/venue/") : String(input).startsWith("/api/walk-route?");
      if (!matches) return workingRead(input, options);
      if (stage === "fetch") return new Promise<Response>(() => {});
      const response = new Response();
      vi.spyOn(response, "json").mockReturnValue(new Promise<unknown>(() => {}));
      return response;
    });
    let finished = false;
    const result = loadPlanClueLegs(stops, new AbortController().signal, request).then((legs) => { finished = true; return legs; });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
    expect(await result).toEqual([]);
    const stalledCalls = request.mock.calls.filter(([input]) => endpoint === "venue" ? String(input).startsWith("/api/venue/") : String(input).startsWith("/api/walk-route?"));
    expect(stalledCalls.every(([, options]) => options?.signal?.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates parent cancellation while a response body ignores abort", async () => {
    vi.useFakeTimers();
    const response = new Response();
    vi.spyOn(response, "json").mockReturnValue(new Promise<unknown>(() => {}));
    const request = vi.fn<typeof fetch>(async () => response);
    const controller = new AbortController();
    const result = loadPlanClueLegs(stops, controller.signal, request);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toEqual([]);
    expect(request.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
