import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/status/route";
import { resetCityStatusCache } from "@/lib/citymcp/client";

const realFetch = global.fetch;

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetCityStatusCache();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("GET /api/citymcp/status", () => {
  it("fails soft with 200 + empty signals when the upstream errors", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 503 }));
    const res = await GET(new Request("http://localhost/api/citymcp/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals).toEqual([]);
    expect(body.tubeLines).toEqual([]);
    expect(body.weather).toBeNull();
    expect(body.error).toMatch(/HTTP 503|CityMCP/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns trimmed tube lines (dropping 'Good Service') and top-8 signals by severity", async () => {
    const signals = Array.from({ length: 12 }, (_, i) => ({
      headline: `Signal ${i}`,
      severity: i % 3 === 0 ? "major" : i % 3 === 1 ? "notable" : "info",
    }));
    const tubeLines = [
      { line: "Victoria", status: "Good Service" },
      { line: "Circle", status: "Minor Delays", disruption: "Trains cancelled" },
      { line: "Piccadilly", status: "Part Closure" },
    ];
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              asOf: "2026-07-11T00:00:00Z",
              weather: { condition: "clear", tempC: 20 },
              signals,
              tubeLines,
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(new Request("http://localhost/api/citymcp/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asOf).toBe("2026-07-11T00:00:00Z");
    expect(body.signals).toHaveLength(8);
    // All top signals should be `major` first, then `notable` — never `info`.
    expect(body.signals.every((s: { severity: string }) => s.severity !== "info")).toBe(true);
    expect(body.tubeLines).toHaveLength(2);
    expect(body.tubeLines.every((t: { status: string }) => t.status !== "Good Service")).toBe(true);
    expect(res.headers.get("cache-control")).toMatch(/public/);
  });

  it("forwards the borough parameter when short enough", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { asOf: "z", signals: [] } },
        }),
        { status: 200 },
      ),
    );
    const res = await GET(new Request("http://localhost/api/citymcp/status?borough=Hackney"));
    expect(res.status).toBe(200);
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.params.arguments).toEqual({ borough: "Hackney" });
  });
});
