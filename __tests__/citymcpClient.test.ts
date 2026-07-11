import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callCityMcpTool,
  CityMcpError,
  fetchCityStatus,
  parseSseJsonRpcBody,
  resetCityStatusCache,
  searchCityPlaces,
  trimSignals,
} from "@/lib/citymcp/client";

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

beforeEach(() => {
  resetCityStatusCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseSseJsonRpcBody", () => {
  it("parses a single event: message frame", () => {
    const body = sseFrame({
      jsonrpc: "2.0",
      id: 1,
      result: { structuredContent: { asOf: "2026-07-11T00:00:00Z", signals: [] } },
    });
    const parsed = parseSseJsonRpcBody(body);
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(1);
    expect((parsed.result as { structuredContent: { asOf: string } }).structuredContent.asOf).toBe(
      "2026-07-11T00:00:00Z",
    );
  });

  it("joins multi-line data fields within one event", () => {
    const body = `event: message\ndata: {"jsonrpc":"2.0","id":2,\ndata: "result":{"structuredContent":{"ok":true}}}\n\n`;
    const parsed = parseSseJsonRpcBody(body);
    expect((parsed.result as { structuredContent: { ok: boolean } }).structuredContent.ok).toBe(true);
  });

  it("skips heartbeat comments and unknown events", () => {
    const body = `: keep-alive\n\nevent: notice\ndata: {"nope":true}\n\n${sseFrame({
      jsonrpc: "2.0",
      id: 3,
      result: { structuredContent: { asOf: "z", signals: [] } },
    })}`;
    const parsed = parseSseJsonRpcBody(body);
    expect(parsed.id).toBe(3);
  });

  it("falls back to parsing a plain JSON body", () => {
    const parsed = parseSseJsonRpcBody(
      '{"jsonrpc":"2.0","id":4,"result":{"structuredContent":{"asOf":"z","signals":[]}}}',
    );
    expect(parsed.id).toBe(4);
  });

  it("throws CityMcpError on invalid JSON", () => {
    expect(() => parseSseJsonRpcBody(`event: message\ndata: {not json}\n\n`)).toThrow(
      CityMcpError,
    );
  });

  it("throws CityMcpError when no message frame is present", () => {
    expect(() => parseSseJsonRpcBody(`event: ping\ndata: {}\n\n`)).toThrow(CityMcpError);
  });
});

describe("trimSignals", () => {
  const s = (severity: string, headline: string) => ({ headline, severity });

  it("returns [] when signals is undefined or empty", () => {
    expect(trimSignals(undefined, 5)).toEqual([]);
    expect(trimSignals([], 5)).toEqual([]);
  });

  it("caps to the requested limit", () => {
    const signals = [s("info", "a"), s("info", "b"), s("info", "c")];
    expect(trimSignals(signals, 2)).toHaveLength(2);
  });

  it("returns [] when limit is 0 or negative", () => {
    expect(trimSignals([s("major", "a")], 0)).toEqual([]);
    expect(trimSignals([s("major", "a")], -1)).toEqual([]);
  });

  it("orders by severity major > notable > info and preserves upstream order for ties", () => {
    const signals = [
      s("info", "info-1"),
      s("major", "major-1"),
      s("notable", "notable-1"),
      s("major", "major-2"),
    ];
    const out = trimSignals(signals, 4).map((x) => x.headline);
    expect(out).toEqual(["major-1", "major-2", "notable-1", "info-1"]);
  });

  it("treats unknown severities as lowest priority", () => {
    const signals = [
      s("mystery", "unknown"),
      s("info", "info"),
      s("major", "major"),
    ];
    const out = trimSignals(signals, 3).map((x) => x.headline);
    expect(out).toEqual(["major", "info", "unknown"]);
  });
});

describe("callCityMcpTool", () => {
  it("POSTs a JSON-RPC tools/call with the correct headers and body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { ok: true } },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    const result = await callCityMcpTool<{ ok: boolean }>(
      "city_status",
      { borough: "Hackney" },
      { fetchImpl, endpoint: "https://example.test/mcp" },
    );
    expect(result.structuredContent?.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://example.test/mcp");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.accept).toBe("application/json, text/event-stream");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("city_status");
    expect(body.params.arguments).toEqual({ borough: "Hackney" });
    expect(body.jsonrpc).toBe("2.0");
  });

  it("throws CityMcpError with kind http on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));
    await expect(
      callCityMcpTool("city_status", {}, { fetchImpl }),
    ).rejects.toMatchObject({ kind: "http", httpStatus: 503 });
  });

  it("throws CityMcpError with kind rpc when the envelope carries an error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no such tool" } }),
        { status: 200 },
      ),
    );
    await expect(
      callCityMcpTool("city_status", {}, { fetchImpl }),
    ).rejects.toMatchObject({ kind: "rpc", rpcCode: -32601 });
  });

  it("throws CityMcpError with kind rpc when the tool reports isError:true", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({ jsonrpc: "2.0", id: 1, result: { isError: true, structuredContent: {} } }),
        { status: 200 },
      ),
    );
    await expect(
      callCityMcpTool("city_status", {}, { fetchImpl }),
    ).rejects.toMatchObject({ kind: "rpc" });
  });
});

describe("fetchCityStatus", () => {
  it("caches results per borough key within the TTL", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              asOf: "2026-07-11T00:00:00Z",
              weather: { condition: "clear", tempC: 20 },
              signals: [{ headline: "Test", severity: "info" }],
              tubeLines: [{ line: "Victoria", status: "Good Service" }],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const first = await fetchCityStatus({}, { fetchImpl });
    const second = await fetchCityStatus({}, { fetchImpl });
    expect(first.asOf).toBe("2026-07-11T00:00:00Z");
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Different borough key → new fetch.
    await fetchCityStatus({ borough: "Hackney" }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    resetCityStatusCache();
    await fetchCityStatus({}, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("normalises missing signals/tubeLines to safe shapes", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { asOf: "2026-07-11T00:00:00Z" } },
        }),
        { status: 200 },
      ),
    );
    const status = await fetchCityStatus({}, { fetchImpl });
    expect(status.signals).toEqual([]);
    expect(status.tubeLines).toBeUndefined();
  });
});

describe("searchCityPlaces", () => {
  it("passes optional filters and returns thin place rows", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              places: [
                { id: "abc", name: "George", area: "SE1", rating: 4.3 },
                { name: "no id — should be filtered" },
                null,
                "not an object",
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );
    const places = await searchCityPlaces("The George", {
      limit: 3,
      near: "Southwark",
      openNow: true,
      minRating: 4,
      maxPrice: "££",
      sort: "rating",
      fetchImpl,
    });
    expect(places).toHaveLength(1);
    expect(places[0]?.id).toBe("abc");

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.params.arguments).toEqual({
      query: "The George",
      limit: 3,
      near: "Southwark",
      openNow: true,
      minRating: 4,
      maxPrice: "££",
      sort: "rating",
    });
  });

  it("returns [] when structuredContent.places is missing", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({ jsonrpc: "2.0", id: 1, result: { structuredContent: {} } }),
        { status: 200 },
      ),
    );
    expect(await searchCityPlaces("anything", { fetchImpl })).toEqual([]);
  });
});
