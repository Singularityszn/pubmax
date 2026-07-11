import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/buzz/route";
import { resetCityBuzzCache } from "@/lib/citymcp/buzz";

const realFetch = global.fetch;

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function buzzEnvelope(structuredContent: unknown): string {
  return sseFrame({
    jsonrpc: "2.0",
    id: 1,
    result: { structuredContent },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetCityBuzzCache();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("GET /api/citymcp/buzz", () => {
  it("400s when id is missing", async () => {
    const res = await GET(new Request("http://localhost/api/citymcp/buzz"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/id is required/i);
    expect(body.buzz).toBeNull();
  });

  it("400s when id is absurdly long", async () => {
    const long = "x".repeat(300);
    const res = await GET(
      new Request(`http://localhost/api/citymcp/buzz?id=${encodeURIComponent(long)}`),
    );
    expect(res.status).toBe(400);
  });

  it("returns trimmed buzz and calls get_place with deep:true", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        buzzEnvelope({
          name: "The George",
          buzz: {
            value: {
              summary: "Loved for the galleried yard; gets rammed on Fridays.",
              mentions: [
                { label: "The Infatuation", url: "https://www.theinfatuation.com/x" },
                { label: "Insecure", url: "http://plain.example.com" },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await GET(
      new Request("http://localhost/api/citymcp/buzz?id=ChIJoTest"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buzz.summary).toMatch(/galleried yard/);
    expect(body.buzz.mentions).toEqual([
      { label: "The Infatuation", url: "https://www.theinfatuation.com/x" },
    ]);

    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, { body?: string }];
    const payload = JSON.parse(init.body ?? "{}");
    expect(payload.params.name).toBe("get_place");
    expect(payload.params.arguments).toMatchObject({ id: "ChIJoTest", deep: true });
  });

  it("returns buzz:null (no error) when the upstream has no buzz", async () => {
    global.fetch = vi.fn(async () =>
      new Response(buzzEnvelope({ name: "The George" }), { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await GET(
      new Request("http://localhost/api/citymcp/buzz?id=ChIJoNoBuzz"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buzz).toBeNull();
    expect(body.error).toBeUndefined();
  });

  it("fails soft (200 + error + buzz:null) on upstream failure", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const res = await GET(
      new Request("http://localhost/api/citymcp/buzz?id=ChIJoDown"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buzz).toBeNull();
    expect(typeof body.error).toBe("string");
  });

  it("serves the second request for the same id from cache", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        buzzEnvelope({
          buzz: { value: { summary: "Cached summary." } },
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = "http://localhost/api/citymcp/buzz?id=ChIJoCache";
    const first = await GET(new Request(url));
    expect((await first.json()).buzz.summary).toBe("Cached summary.");
    const second = await GET(new Request(url));
    expect((await second.json()).buzz.summary).toBe("Cached summary.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
