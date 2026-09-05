// Fault injection for the nightly city enrichment cron (finding F03).
//
// Every provider here is a stub. No test in this file may reach Exa, the AI
// Gateway, Tavily or the production cron: the fetch global is replaced in each
// case, and the enrichment core is the only thing under test.
//
// The five faults the captain's audit asked for: a search timeout, a gateway
// 5xx, a crash mid-batch, a lease already held, and a repeated run after a
// successful one. Each asserts the same three things - no venue is skipped in
// silence, nothing is published twice, and spend stays inside its stated bound.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/enrich-city-pubs/route";
import {
  CONSECUTIVE_VENUE_FAILURE_LIMIT,
  MAX_VENUE_ATTEMPTS,
  RETRY_QUERY_BUDGET,
  SEARCH_CRON_QUERY_CAP,
} from "@/lib/tavilyPubEnrichment.server";
import {
  cityEnrichmentCheckpointStore,
  resetCityEnrichmentCheckpointMemory,
} from "@/lib/cityEnrichmentCheckpointStore.server";
import {
  CITY_ENRICHMENT_LEASE_MS,
  claimEnrichmentLease,
  emptyCityEnrichmentCheckpoint,
} from "@/lib/cityEnrichmentCheckpoint";

/** 2026-07-26 is an Edinburgh night in the rotation. */
const EDINBURGH_NIGHT = new Date("2026-07-26T03:15:00.000Z");

function req(): Request {
  return new Request("https://pubmaxxing.com/api/cron/enrich-city-pubs", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function okPayload(request: RequestInfo | URL, init?: RequestInit) {
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
      usage: { credits: 1 },
      request_id: String(request),
    }),
  };
}

function gatewayFailure(status: number) {
  return async () => ({ ok: false, status, json: async () => ({}) });
}

/** A request that never answers, and ignores the abort it is handed. */
function neverAnswers() {
  return () => new Promise(() => {});
}

type CronBody = {
  ok: boolean;
  queriesSpent: number;
  startIndex: number;
  nextIndex: number;
  published: number;
  checkpoints: {
    city: string;
    nextIndex: number;
    deferred: number;
    terminal: number;
    passes: number;
  }[];
  cityRuns: { city: string; skipped?: string; queriesSpent: number }[];
};

async function readBody(response: Response): Promise<CronBody> {
  return (await response.json()) as CronBody;
}

function queriesOf(calls: [unknown, RequestInit | undefined][]): string[] {
  return calls.map(([, init]) => JSON.parse(String(init?.body)).query as string);
}

beforeEach(() => {
  resetCityEnrichmentCheckpointMemory();
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
  vi.useFakeTimers();
  vi.setSystemTime(EDINBURGH_NIGHT);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("city enrichment fault injection", () => {
  it("defers a timed-out venue instead of skipping it, and bounds what the timeout costs", async () => {
    // The production fault: one search that never answers. The 12,000 ms
    // request deadline fires, and the outage limit stops the run after three.
    vi.stubGlobal("fetch", vi.fn(neverAnswers()));

    const responsePromise = GET(req());
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await responsePromise;

    // Nothing was read, so this is still an alerting night.
    expect(response.status).toBe(502);

    const checkpoint = await cityEnrichmentCheckpointStore().read("edinburgh", 500, Date.now());
    expect(checkpoint).not.toBeNull();
    // Every venue that was asked about is owed a retry. None was skipped.
    expect(checkpoint!.deferred).toHaveLength(CONSECUTIVE_VENUE_FAILURE_LIMIT);
    expect(checkpoint!.terminal).toHaveLength(0);
    for (const entry of checkpoint!.deferred) {
      expect(entry.attempts).toBe(1);
      // Bounded backoff, not an immediate re-ask.
      expect(Date.parse(entry.retryAfter)).toBeGreaterThan(Date.now());
    }
    // The lease is released even though the run failed, so the next run is
    // not blocked by a corpse.
    expect(checkpoint!.leaseOwner).toBeNull();
    expect(checkpoint!.lastRun?.outcome).toBe("failed");
  });

  it("retries a deferred venue first on the next run, inside the retry budget", async () => {
    // Night one: every venue refuses with a gateway 502.
    vi.stubGlobal("fetch", vi.fn(gatewayFailure(502)));
    await GET(req());

    const store = cityEnrichmentCheckpointStore();
    const afterFailure = await store.read("edinburgh", 500, Date.now());
    const owed = afterFailure!.deferred.map((entry) => entry.osmId);
    expect(owed).toHaveLength(CONSECUTIVE_VENUE_FAILURE_LIMIT);
    expect(owed.length).toBeLessThanOrEqual(RETRY_QUERY_BUDGET);

    // Night two, past the first backoff step, with the provider healthy again.
    vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + 7 * 24 * 60 * 60_000));
    vi.stubGlobal("fetch", vi.fn(okPayload));
    const body = await readBody(await GET(req()));

    expect(body.ok).toBe(true);
    // The whole night still stayed inside one query cap, retries included.
    expect(body.queriesSpent).toBeLessThanOrEqual(SEARCH_CRON_QUERY_CAP);
    const after = await store.read("edinburgh", 500, Date.now());
    // Answered, so they are owed nothing more.
    for (const osmId of owed) {
      expect(after!.deferred.map((entry) => entry.osmId)).not.toContain(osmId);
      expect(after!.terminal.map((entry) => entry.osmId)).not.toContain(osmId);
    }
  });

  it("refuses a venue only after the attempt cap, and records it by name", async () => {
    const store = cityEnrichmentCheckpointStore();
    const week = 7 * 24 * 60 * 60_000;
    vi.stubGlobal("fetch", vi.fn(gatewayFailure(500)));

    for (let attempt = 0; attempt < MAX_VENUE_ATTEMPTS; attempt += 1) {
      vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + attempt * week));
      await GET(req());
    }

    const final = await store.read("edinburgh", 500, Date.now());
    // A venue asked MAX_VENUE_ATTEMPTS times and never read is refused, by
    // name, and no further query is ever spent on it.
    expect(final!.terminal.length).toBeGreaterThan(0);
    for (const entry of final!.terminal) {
      expect(entry.attempts).toBe(MAX_VENUE_ATTEMPTS);
      expect(entry.osmId).toEqual(expect.any(String));
      expect(entry.lastError).toEqual(expect.any(String));
    }
  });

  it("spends nothing when another run already holds the lease", async () => {
    const store = cityEnrichmentCheckpointStore();
    const now = Date.now();
    const held = claimEnrichmentLease(emptyCityEnrichmentCheckpoint("edinburgh", 500, now), {
      owner: "another-run",
      now,
    });
    expect(held.ok).toBe(true);
    if (held.ok) await store.save(held.checkpoint);

    const fetchImpl = vi.fn(okPayload);
    vi.stubGlobal("fetch", fetchImpl);
    const body = await readBody(await GET(req()));

    // Not a failure: a night that correctly declined to spend.
    expect(body.ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(body.queriesSpent).toBe(0);
    expect(body.cityRuns.find((run) => run.city === "edinburgh")?.skipped).toBe("lease-held");
  });

  it("takes over from a crashed run once its lease expires", async () => {
    const store = cityEnrichmentCheckpointStore();
    const crashedAt = Date.now();
    const crashed = claimEnrichmentLease(
      emptyCityEnrichmentCheckpoint("edinburgh", 500, crashedAt),
      { owner: "crashed-run", now: crashedAt },
    );
    if (crashed.ok) await store.save(crashed.checkpoint);

    // The crashed run never released anything. Past the lease, the next run
    // takes the city rather than the city being blocked for good.
    vi.setSystemTime(new Date(crashedAt + CITY_ENRICHMENT_LEASE_MS + 1_000));
    vi.stubGlobal("fetch", vi.fn(okPayload));
    const body = await readBody(await GET(req()));

    expect(body.ok).toBe(true);
    expect(body.queriesSpent).toBe(SEARCH_CRON_QUERY_CAP);
    expect(body.cityRuns.find((run) => run.city === "edinburgh")?.skipped).toBeUndefined();
  });

  it("never re-reads the same venues on a repeated run, and publishes nothing either time", async () => {
    const fetchImpl = vi.fn(okPayload);
    vi.stubGlobal("fetch", fetchImpl);

    const first = await readBody(await GET(req()));
    expect(first.queriesSpent).toBe(SEARCH_CRON_QUERY_CAP);
    expect(first.published).toBe(0);

    const firstCursor = first.checkpoints.find((entry) => entry.city === "edinburgh")!.nextIndex;
    const queriedFirst = queriesOf(
      fetchImpl.mock.calls as unknown as [unknown, RequestInit | undefined][],
    );

    // Same night, run again. The old day-derived cursor would have re-searched
    // exactly the same ten pubs and spent the budget twice.
    const second = await readBody(await GET(req()));
    expect(second.published).toBe(0);
    const secondCursor = second.checkpoints.find((entry) => entry.city === "edinburgh")!.nextIndex;
    expect(secondCursor).toBe(firstCursor + SEARCH_CRON_QUERY_CAP);

    const queriedSecond = queriesOf(
      fetchImpl.mock.calls.slice(queriedFirst.length) as unknown as [
        unknown,
        RequestInit | undefined,
      ][],
    );
    expect(queriedSecond).toHaveLength(SEARCH_CRON_QUERY_CAP);
    for (const query of queriedSecond) {
      expect(queriedFirst).not.toContain(query);
    }
  });

  it("keeps a previous run's progress when a later run fails", async () => {
    vi.stubGlobal("fetch", vi.fn(okPayload));
    const good = await readBody(await GET(req()));
    const goodCursor = good.checkpoints.find((entry) => entry.city === "edinburgh")!.nextIndex;
    expect(goodCursor).toBeGreaterThan(0);

    vi.stubGlobal("fetch", vi.fn(gatewayFailure(503)));
    await GET(req());

    const after = await cityEnrichmentCheckpointStore().read("edinburgh", 500, Date.now());
    // The failed run could only ever leave the city further along, never back
    // at a venue the earlier run had already read.
    expect(after!.nextIndex).toBeGreaterThanOrEqual(goodCursor);
    expect(after!.lastRun?.error).toBeDefined();
  });
});
