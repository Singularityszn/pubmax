import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/places/route";

const realFetch = global.fetch;

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("GET /api/citymcp/places", () => {
  it("400s when q is missing or empty", async () => {
    const res = await GET(new Request("http://localhost/api/citymcp/places"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/q is required/i);
  });

  it("400s when q is absurdly long", async () => {
    const long = "x".repeat(300);
    const res = await GET(
      new Request(`http://localhost/api/citymcp/places?q=${encodeURIComponent(long)}`),
    );
    expect(res.status).toBe(400);
  });

  it("returns thin rows from search_places on success", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              places: [
                {
                  id: "abc123",
                  name: "The George",
                  area: "75 Borough High St, London",
                  location: { lat: 51.5, lng: -0.09 },
                  types: ["pub", "bar", "restaurant"],
                  rating: 4.3,
                  userRatingCount: 7373,
                  priceBand: "££",
                  openNow: true,
                  // A field we don't proxy through the thin row — should be dropped.
                  hygiene: { rating: 5 },
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      new Request("http://localhost/api/citymcp/places?q=George%20Southwark&limit=3"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.places).toHaveLength(1);
    expect(body.places[0]).toEqual({
      id: "abc123",
      name: "The George",
      area: "75 Borough High St, London",
      location: { lat: 51.5, lng: -0.09 },
      types: ["pub", "bar", "restaurant"],
      rating: 4.3,
      userRatingCount: 7373,
      priceBand: "££",
      openNow: true,
    });
    // Verify the upstream call actually happened with the right args.
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.name).toBe("search_places");
    expect(upstream.params.arguments).toEqual({ query: "George Southwark", limit: 3 });
  });

  it("fails soft with 200 + empty places on upstream error", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const res = await GET(new Request("http://localhost/api/citymcp/places?q=anything"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.places).toEqual([]);
    expect(body.error).toBeTruthy();
  });
});
