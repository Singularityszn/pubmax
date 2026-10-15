import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F10: one Crawl Route pays one function invocation and one CDN key, not one
// per leg, while every leg still spends its own rate-limit token. The limiter
// is spied so the test counts the checks; its verdict is "not limited" unless a
// test says otherwise.
const limiter = vi.hoisted(() => ({ isCityMcpLimited: vi.fn(async () => false) }));
vi.mock("@/lib/citymcpRateLimit", () => limiter);

import { GET } from "@/app/api/citymcp/journey/route";
import {
  crawlJourneyChunks,
  crawlJourneysUrl,
  crawlLegsFromResponse,
} from "@/components/map/useCrawlJourneys";
import { resetJourneyCache } from "@/lib/citymcp/client";
import type { Venue } from "@/lib/venues";

const realFetch = global.fetch;

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function journeyFrame(minutes: number): Response {
  return new Response(
    sseFrame({
      jsonrpc: "2.0",
      id: 1,
      result: {
        structuredContent: {
          journeys: [
            { durationMinutes: minutes, legs: [{ mode: "walking" }] },
            { durationMinutes: minutes + 5, legs: [{ mode: "bus" }] },
          ],
        },
      },
    }),
    { status: 200 },
  );
}

function venue(id: string, latitude: number, longitude: number): Venue {
  return { id, latitude, longitude } as Venue;
}

function upstreamArgs(): Array<{ from: string; to: string }> {
  const calls = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  return calls.map(([, init]) => JSON.parse(String(init.body)).params.arguments);
}

beforeEach(() => {
  resetJourneyCache();
  limiter.isCityMcpLimited.mockReset();
  limiter.isCityMcpLimited.mockResolvedValue(false);
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("GET /api/citymcp/journey?stops= (one crawl, every leg)", () => {
  it("answers every consecutive leg in order, one rate-limit token per leg", async () => {
    let minutes = 10;
    global.fetch = vi.fn(async () => journeyFrame(minutes++));

    const res = await GET(
      new Request(
        "http://localhost/api/citymcp/journey?stops=51.5120,-0.1040;51.5100,-0.1210;51.5150,-0.1300",
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=120, stale-while-revalidate=600",
    );
    expect(limiter.isCityMcpLimited).toHaveBeenCalledTimes(2);
    expect(upstreamArgs()).toEqual([
      { from: "51.51200,-0.10400", to: "51.51000,-0.12100" },
      { from: "51.51000,-0.12100", to: "51.51500,-0.13000" },
    ]);
    const body = await res.json();
    expect(body.legs).toHaveLength(2);
    // limit defaults to 1: the best journey per leg only.
    expect(body.legs[0].journeys).toHaveLength(1);
    expect(body.legs.map((leg: { journeys: Array<{ durationMinutes: number }> }) =>
      leg.journeys[0]!.durationMinutes,
    )).toEqual([10, 11]);
  });

  it("refuses the whole crawl when the budget cannot cover every leg", async () => {
    global.fetch = vi.fn(async () => journeyFrame(5));
    limiter.isCityMcpLimited
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const res = await GET(
      new Request("http://localhost/api/citymcp/journey?stops=51.512,-0.104;51.51,-0.121;51.515,-0.13"),
    );

    expect(res.status).toBe(429);
    expect((await res.json()).legs).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps a route with a failed leg off the edge and says which leg failed", async () => {
    let call = 0;
    global.fetch = vi.fn(async () =>
      call++ === 0 ? journeyFrame(7) : new Response("down", { status: 503 }),
    );

    const res = await GET(
      new Request("http://localhost/api/citymcp/journey?stops=51.512,-0.104;51.51,-0.121;51.515,-0.13"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.legs[0].journeys[0].durationMinutes).toBe(7);
    expect(body.legs[0].error).toBeUndefined();
    expect(body.legs[1].journeys).toEqual([]);
    expect(body.legs[1].error).toBeTruthy();
  });

  it.each([
    ["one stop", "51.512,-0.104"],
    ["a stop outside the UK", "51.512,-0.104;40,-74"],
    ["a malformed stop", "51.512,-0.104;51.51"],
    ["more than 12 stops", Array.from({ length: 13 }, () => "51.512,-0.104").join(";")],
  ])("400s on %s without calling upstream", async (_label, stops) => {
    global.fetch = vi.fn(async () => journeyFrame(5));
    const res = await GET(
      new Request(`http://localhost/api/citymcp/journey?stops=${encodeURIComponent(stops)}`),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).legs).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("useCrawlJourneys request shape", () => {
  const route = [
    venue("a", 51.512031, -0.104012),
    venue("b", 51.509988, -0.121012),
    venue("c", 51.515, -0.13),
  ];

  it("asks for the whole crawl in one URL with coordinates rounded to 4 decimals", () => {
    const url = new URL(crawlJourneysUrl(route), "http://localhost");
    expect(url.pathname).toBe("/api/citymcp/journey");
    expect(url.searchParams.get("stops")).toBe(
      "51.5120,-0.1040;51.5100,-0.1210;51.5150,-0.1300",
    );
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("gives two readers of the same pubs one CDN key despite float noise", () => {
    const jittered = route.map((v) => venue(v.id, v.latitude + 0.000004, v.longitude - 0.000004));
    expect(crawlJourneysUrl(jittered)).toBe(crawlJourneysUrl(route));
  });

  it("maps a mapped route to one request, and a longer one to overlapping runs", () => {
    const stops = Array.from({ length: 14 }, (_, i) => venue(`v${i}`, 51.5 + i / 1000, -0.1));
    expect(crawlJourneyChunks(stops.slice(0, 12))).toHaveLength(1);
    const chunks = crawlJourneyChunks(stops);
    expect(chunks.map((chunk) => chunk.length)).toEqual([12, 3]);
    // The run boundary stop appears in both, so leg 11 -> 12 is still asked.
    expect(chunks[1]![0]!.id).toBe("v11");
    expect(crawlJourneyChunks(stops.slice(0, 1))).toEqual([]);
  });

  it("pairs each answered leg with the stops it joins and skips an empty one", () => {
    const legs = crawlLegsFromResponse(route, {
      legs: [
        { journeys: [{ durationMinutes: 6, legs: [{ mode: "walking" }] }] },
        { journeys: [], error: "CityMCP request failed" },
      ],
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ fromId: "a", toId: "b", durationMinutes: 6, modes: ["walking"] });
  });
});
