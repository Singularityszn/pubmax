import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/enrich-city-pubs/route";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/enrich-city-pubs", {
    headers: auth ? { authorization: auth } : {},
  });
}

function tavilyOk(request: RequestInfo | URL, init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { include_domains?: string[]; query: string };
  const quoted = [...body.query.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const pubName = quoted[0] ?? "Independent Arms";
  const locality = quoted[1] ?? "EH1";
  const slug = pubName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const domain = body.include_domains?.[0] ?? `${slug}.co.uk`;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      query: "official pub menu",
      results: [{
        title: `${pubName} official drinks menu`,
        url: `https://${domain}/drinks`,
        content: `Official drinks menu. Find us at ${locality}.`,
        raw_content: "Test Bitter - Pint £4.50",
        score: 0.9,
      }],
      response_time: 0.1,
      usage: { credits: 1 },
      request_id: String(request),
    }),
  };
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-26T03:15:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/cron/enrich-city-pubs", () => {
  it("401s without the cron secret", async () => {
    const response = await GET(req("Bearer wrong"));
    expect(response.status).toBe(401);
  });

  it("is a safe no-op without TAVILY_API_KEY", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: "no-tavily-key",
      queriesSpent: 0,
      creditsSpent: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rotates a city batch within the exact cron query cap and reports spend", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    const fetchImpl = vi.fn(tavilyOk);
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(req("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      city: "edinburgh",
      queriesSpent: 25,
      creditsSpent: 25,
    });
    expect(body.nextIndex).toBeGreaterThan(body.startIndex);
    expect(body.matchedPubs).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(25);
  });

  it("502s loudly without claiming spend when Tavily fails", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(502);
    expect(errorSpy.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("[city-enrichment][ALERT]"),
    )).toBe(true);
  });
});
