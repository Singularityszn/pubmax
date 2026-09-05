import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/enrich-city-pubs/route";
import { SEARCH_CRON_WALL_MS } from "@/lib/tavilyPubEnrichment.server";
import { resetCityEnrichmentCheckpointMemory } from "@/lib/cityEnrichmentCheckpointStore.server";

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
  resetCityEnrichmentCheckpointMemory();
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

  it("is a safe no-op without configured search credentials", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: "no-search-provider",
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
      queriesSpent: 10,
      creditsSpent: 10,
    });
    expect(body.nextIndex).toBeGreaterThan(body.startIndex);
    expect(body.matchedPubs).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("keeps the cron result contract when Tavily is selected through the provider seam", async () => {
    vi.stubEnv("SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubGlobal("fetch", vi.fn(tavilyOk));

    const response = await GET(req("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      provider: "tavily",
      queriesSpent: 10,
      creditsSpent: 10,
      gatewayCalls: 0,
    });
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
    // Bounded: a provider refusing every venue is called an outage after three
    // in a row, so the night can never spend its whole cap discovering that.
    expect(errorSpy.mock.calls.some(([message, payload]) =>
      typeof message === "string" &&
      message.includes("[city-enrichment][spend]") &&
      typeof payload === "string" &&
      payload.includes('"tavilyCalls":3'),
    )).toBe(true);
    // A failed run still says where it got to and what it left owed.
    expect(errorSpy.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("[city-enrichment][checkpoint]"),
    )).toBe(true);
  });

  it("aborts a provider request before the cron function deadline", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubGlobal("fetch", vi.fn((_request: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    ));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const responsePromise = GET(req("Bearer test-secret"));
    // Bounded: three request deadlines of 12,000 ms, then the outage is called.
    // That is 36 s, well inside both the 90 s run wall and the 120 s function.
    await vi.advanceTimersByTimeAsync(40_000);
    const response = await responsePromise;

    expect(response.status).toBe(502);
  });

  it("returns at the wall-clock bound when a provider ignores abort", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const responsePromise = GET(req("Bearer test-secret"));
    const settled = responsePromise.then(
      () => true,
      () => true,
    );
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 1_000);
    });

    await vi.advanceTimersByTimeAsync(SEARCH_CRON_WALL_MS + 1_000);

    await expect(Promise.race([settled, timeout])).resolves.toBe(true);
    await expect(responsePromise).resolves.toMatchObject({ status: 502 });
  });

  it("keeps a mid-batch failure to the venue it happened at, and owes it a retry", async () => {
    // The old contract threw the whole batch away here and answered 502. A
    // venue that would not answer is now a fact about that venue: the pubs
    // behind it still get the night's remaining budget, and the one that
    // failed is recorded and owed a bounded retry.
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    let calls = 0;
    const fetchImpl = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      // One venue in three refuses, so the outage limit is never reached.
      if (calls % 3 === 0) return { ok: false, status: 503, json: async () => ({}) };
      return tavilyOk(request, init);
    });
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(req("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.queriesSpent).toBe(10);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    // The failures were kept, not lost: three of ten venues are owed a retry.
    const edinburgh = body.checkpoints.find((entry: { city: string }) => entry.city === "edinburgh");
    expect(edinburgh.deferred).toBe(3);
    expect(edinburgh.terminal).toBe(0);
    // And the cursor still cleared the whole slice, so nothing behind the
    // failed venues was passed over.
    expect(edinburgh.nextIndex - body.startIndex).toBe(10);
    expect(body.published).toBe(0);
  });

  it("isolates Bristol 504 and still enriches spillover cities on Bristol nights", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    const fetchImpl = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.toLowerCase().includes("bristol")) {
        return { ok: false, status: 504, json: async () => ({}) };
      }
      return tavilyOk(request, init);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(req("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      city: "bristol",
      primaryCity: "bristol",
    });
    // Bristol keeps the venues it could read and defers the ones it could not,
    // instead of the whole city being lost to the first 504.
    expect(body.cityRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ city: "bristol", venuesDeferred: expect.any(Number) }),
        expect.objectContaining({ city: "london", ok: true, queriesSpent: expect.any(Number) }),
      ]),
    );
    const bristol = body.cityRuns.find((run: { city: string }) => run.city === "bristol");
    expect(bristol.venuesDeferred).toBeGreaterThan(0);
    expect(bristol.venuesTerminal).toBe(0);
    expect(body.queriesSpent).toBeGreaterThan(0);
    expect(errorSpy.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("[city-enrichment][ALERT]"),
    )).toBe(false);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
  });
});
