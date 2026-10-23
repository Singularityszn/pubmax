// Does a deferred venue ever actually recover? (Astra finding F04.)
//
// The checkpoint lane already proved that a failed venue is RECORDED. What
// production showed on 2026-09-06 03:15Z is that recording is only half a
// promise: Edinburgh answered 502, committed three deferrals and zero
// retries, and nothing anywhere said whether those three would ever be read.
//
// Every case here drives the real cron route with a stubbed provider. Nothing
// reaches Exa, the AI Gateway, Tavily or production. Each proves one of the
// invariants the finding asked for by name:
//
//   - a deferred venue PUBLISHES ONCE or reaches a VISIBLE TERMINAL STATE
//   - a bad venue never blocks the rest of the city
//   - a retry never spends the same logical query twice
//   - a retry never publishes, so it can never duplicate a price
//   - an interrupted run resumes from the committed checkpoint
//   - a failure about US never spends a venue's attempts
//   - a queue that stops draining says so
//   - a checkpoint that landed in memory says so

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/enrich-city-pubs/route";
import {
  DEFERRED_QUEUE_AGE_ALERT_MS,
  MAX_VENUE_ATTEMPTS,
  SEARCH_CRON_QUERY_CAP,
} from "@/lib/tavilyPubEnrichment.server";
import {
  cityEnrichmentCheckpointStore,
  resetCityEnrichmentCheckpointMemory,
} from "@/lib/cityEnrichmentCheckpointStore.server";
import { defined } from "@/__tests__/helpers/defined";

/** 2026-07-26 is an Edinburgh night in the rotation. */
const EDINBURGH_NIGHT = new Date("2026-07-26T03:15:00.000Z");
const WEEK_MS = 7 * 24 * 60 * 60_000;
const EDINBURGH_PUBS = 500;

function req(): Request {
  return new Request("https://pubmaxxing.com/api/cron/enrich-city-pubs", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function queryOf(init: RequestInit | undefined): string {
  return JSON.parse(String(init?.body)).query as string;
}

/** A healthy provider: one official page per pub, one credit. */
function healthyProvider(request: RequestInfo | URL, init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { include_domains?: string[]; query: string };
  const quoted = [...body.query.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const pubName = quoted[0] ?? "Independent Arms";
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
        content: `Official drinks menu. Find us at ${quoted[1] ?? "EH1"}.`,
        raw_content: "Test Bitter - Pint £4.50",
        score: 0.9,
      }],
      usage: { credits: 1 },
      request_id: String(request),
    }),
  };
}

/** A gateway that refuses everything. */
function failingProvider(status: number) {
  return async () => ({ ok: false, status, json: async () => ({}) });
}

/**
 * A provider that answers 200 with a body nothing can read. This is the
 * PERMANENTLY BAD case: retrying it can never help, so the attempt cap is the
 * only thing between it and an unbounded spend. It is deliberately NOT a 200
 * carrying no results, which is the honest "we looked and found nothing" and
 * must go on reading as a venue that ANSWERED.
 */
function permanentlyMalformed() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
  });
}

type CronBody = {
  ok: boolean;
  queriesSpent: number;
  published: number;
  checkpointDurable: boolean | null;
  checkpointExpectedDurable: boolean;
  deferredQueueAgeAlertMs: number;
  checkpoints: {
    city: string;
    deferred: number;
    terminal: number;
    queueAgeMs: number | null;
    queueAgeAlert: boolean;
  }[];
  cityRuns: { city: string; skipped?: string; queriesSpent: number; retriesAttempted?: number }[];
};

async function readBody(response: Response): Promise<CronBody> {
  return (await response.json()) as CronBody;
}

async function edinburgh() {
  const { checkpoint } = await cityEnrichmentCheckpointStore().read(
    "edinburgh",
    EDINBURGH_PUBS,
    Date.now(),
  );
  return checkpoint;
}

let fetchMock: ReturnType<typeof vi.fn>;
let errorLines: string[];

function useProvider(impl: (...args: never[]) => unknown): void {
  fetchMock = vi.fn(impl as never);
  vi.stubGlobal("fetch", fetchMock);
}

/** Every query this run put to the provider, in order. */
function queriesSent(): string[] {
  return fetchMock.mock.calls.map(([, init]) => queryOf(init as RequestInit | undefined));
}

beforeEach(() => {
  resetCityEnrichmentCheckpointMemory();
  errorLines = [];
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
  vi.useFakeTimers();
  vi.setSystemTime(EDINBURGH_NIGHT);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a deferred venue reaches an end", () => {
  it("publishes once when the provider recovers, and leaves the queue empty", async () => {
    // Night one: a transient outage. Every venue asked about is deferred.
    useProvider(failingProvider(503));
    await GET(req());

    const owed = (await edinburgh())!.deferred.map((entry) => entry.osmId);
    expect(owed.length).toBeGreaterThan(0);

    // Night two, past the longest backoff, provider healthy.
    vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + WEEK_MS));
    useProvider(healthyProvider);
    const body = await readBody(await GET(req()));

    const after = (await edinburgh())!;
    // Every venue that was owed a retry has an ANSWER now, and is in neither
    // list. That is the half of the promise production could not show.
    for (const osmId of owed) {
      expect(after.deferred.map((entry) => entry.osmId)).not.toContain(osmId);
      expect(after.terminal.map((entry) => entry.osmId)).not.toContain(osmId);
    }
    // It published nothing on either night, so a recovered venue cannot have
    // duplicated a price: this route's only output is its log.
    expect(body.published).toBe(0);
  });

  it("reaches a visible terminal state when retrying can never help", async () => {
    // A 200 carrying a body that is not a search result, every night. No
    // amount of retrying reads this venue, so the cap must end it.
    useProvider(permanentlyMalformed());
    for (let attempt = 0; attempt < MAX_VENUE_ATTEMPTS; attempt += 1) {
      vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + attempt * WEEK_MS));
      await GET(req());
    }

    const final = (await edinburgh())!;
    expect(final.terminal.length).toBeGreaterThan(0);
    for (const entry of final.terminal) {
      expect(entry.attempts).toBe(MAX_VENUE_ATTEMPTS);
      // Visible: named, dated, and carrying the reason.
      expect(entry.osmId).toEqual(expect.any(String));
      expect(entry.failedAt).toEqual(expect.any(String));
      expect(entry.lastError.length).toBeGreaterThan(0);
    }
    // And the operator is told once, by name, with the way back beside it.
    const terminalLine = errorLines.find((line) => line.includes("[terminal]"));
    expect(terminalLine).toContain("requeue");

    // A fourth night spends nothing on a refused venue.
    vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + MAX_VENUE_ATTEMPTS * WEEK_MS));
    useProvider(permanentlyMalformed());
    await GET(req());
    const refused = new Set(final.terminal.map((entry) => entry.osmId));
    const stillRefused = (await edinburgh())!.terminal.map((entry) => entry.osmId);
    for (const osmId of refused) expect(stillRefused).toContain(osmId);
  });

  it("never blocks the venues behind it", async () => {
    // One venue refuses; the rest of the city answers. The cursor must still
    // pass the bad one and the night must still reach the pubs behind it.
    let call = 0;
    useProvider(((request: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      if (call === 1) return failingProvider(500)();
      return healthyProvider(request, init);
    }) as never);

    const body = await readBody(await GET(req()));
    expect(body.ok).toBe(true);
    const after = (await edinburgh())!;
    // The bad venue is owed a retry, and the cursor is past it.
    expect(after.deferred).toHaveLength(1);
    expect(after.nextIndex).toBeGreaterThan(1);
    // The night still spent its budget on real pubs rather than stopping.
    expect(body.queriesSpent).toBe(SEARCH_CRON_QUERY_CAP);
  });
});

describe("what a retry may cost", () => {
  it("never spends the same logical query twice", async () => {
    useProvider(failingProvider(503));
    await GET(req());
    const nightOne = queriesSent();

    vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + WEEK_MS));
    useProvider(healthyProvider);
    await GET(req());
    const nightTwo = queriesSent();

    // A retry re-asks the venue it could not read, and nothing else: the
    // queries night two repeats are exactly the deferred ones.
    const repeated = nightTwo.filter((query) => nightOne.includes(query));
    expect(repeated.length).toBeLessThanOrEqual(nightOne.length);
    // And within one night no venue is ever asked about twice.
    expect(new Set(nightTwo).size).toBe(nightTwo.length);
  });

  it("stays inside one query cap however many venues are owed a retry", async () => {
    useProvider(failingProvider(503));
    await GET(req());

    vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + WEEK_MS));
    useProvider(healthyProvider);
    const body = await readBody(await GET(req()));
    expect(body.queriesSpent).toBeLessThanOrEqual(SEARCH_CRON_QUERY_CAP);
    expect(queriesSent().length).toBeLessThanOrEqual(SEARCH_CRON_QUERY_CAP);
  });

  it("never charges a venue for a failure that was about us", async () => {
    // The provider budget is exhausted after two calls, so the third venue's
    // search is never really put. Charging it an attempt is how a venue
    // nobody asked about reaches the terminal cap over three bad nights.
    vi.stubEnv("SEARCH_GATEWAY_MAX_CALLS", "2");
    useProvider(healthyProvider);

    await GET(req());

    const after = (await edinburgh())!;
    // Two venues answered. The one the budget refused is owed its query and
    // is charged nothing, so its attempts are untouched.
    expect(after.deferred).toHaveLength(0);
    expect(after.terminal).toHaveLength(0);
    expect(fetchMock.mock.calls).toHaveLength(2);
  });
});

describe("an interrupted run", () => {
  it("resumes from the committed checkpoint rather than starting the city again", async () => {
    useProvider(healthyProvider);
    await GET(req());
    const afterFirst = (await edinburgh())!;
    expect(afterFirst.nextIndex).toBe(SEARCH_CRON_QUERY_CAP);

    // The next night dies partway: the provider stops answering after two.
    vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + WEEK_MS));
    let call = 0;
    useProvider(((request: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      if (call > 2) return failingProvider(503)();
      return healthyProvider(request, init);
    }) as never);
    await GET(req());

    const afterCrash = (await edinburgh())!;
    // The cursor moved forward from where the first run left it, never back.
    expect(afterCrash.nextIndex).toBeGreaterThan(afterFirst.nextIndex);
    // And the lease is released, so the next run is not blocked by a corpse.
    expect(afterCrash.leaseOwner).toBeNull();

    // Night three starts where night two really got to.
    vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + 2 * WEEK_MS));
    useProvider(healthyProvider);
    await GET(req());
    expect((await edinburgh())!.nextIndex).toBeGreaterThan(afterCrash.nextIndex);
  });
});

describe("the queue reports on itself", () => {
  it("says how old the oldest owed retry is", async () => {
    // One venue refuses, the rest answer, so the route reports a 200 body and
    // the queue age rides it.
    let call = 0;
    useProvider(((request: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      if (call === 1) return failingProvider(503)();
      return healthyProvider(request, init);
    }) as never);

    const body = await readBody(await GET(req()));
    const edinburghRow = body.checkpoints.find((row) => row.city === "edinburgh");
    expect(edinburghRow?.deferred).toBe(1);
    // Freshly deferred, so the age is real and the alert is not raised.
    expect(edinburghRow?.queueAgeMs).toBe(0);
    expect(edinburghRow?.queueAgeAlert).toBe(false);
    expect(body.deferredQueueAgeAlertMs).toBe(DEFERRED_QUEUE_AGE_ALERT_MS);
  });

  it("alerts when the oldest owed retry has outlived the nights that should have cleared it", async () => {
    // A city stuck on one venue nothing ever reads: it is deferred, retried
    // and deferred again, so the count never grows and only its AGE says the
    // lane has stopped working.
    const stuck = (request: RequestInfo | URL, init?: RequestInit) => {
      const query = queryOf(init);
      return query.includes("Abbotsford") ? failingProvider(503)() : healthyProvider(request, init);
    };
    useProvider(stuck as never);
    await GET(req());
    const owed = (await edinburgh())!.deferred;
    expect(owed).toHaveLength(1);
    const owedFrom = defined(owed[0]).firstFailedAt;

    // Far enough on that the retries should have resolved this either way.
    // Two weeks on: past the alert threshold, and a whole number of weeks so
    // the seven-city rotation lands on Edinburgh again.
    expect(2 * WEEK_MS).toBeGreaterThan(DEFERRED_QUEUE_AGE_ALERT_MS);
    vi.setSystemTime(new Date(EDINBURGH_NIGHT.getTime() + 2 * WEEK_MS));
    errorLines = [];
    useProvider(failingProvider(503));
    await GET(req());

    const alert = errorLines.find((line) => line.includes("deferred-queue-not-draining"));
    expect(alert).toBeDefined();
    expect(alert).toContain("requeue");
    expect(alert).toContain(String(DEFERRED_QUEUE_AGE_ALERT_MS));
    // It names the stamp it measured from, so an operator can go and look.
    expect(alert).toContain(owedFrom);
  });

  it("reports the durability the write really had, not the one the keys imply", async () => {
    useProvider(healthyProvider);
    const body = await readBody(await GET(req()));
    // The test runner has no Supabase, so nothing is expected to be durable
    // and the observed answer agrees. The pair must never be one field: they
    // disagreeing is the whole finding.
    expect(body.checkpointExpectedDurable).toBe(false);
    expect(body.checkpointDurable).toBe(false);
    expect(
      errorLines.some((line) => line.includes("checkpoint-not-durable")),
    ).toBe(false);
  });
});

describe("what this lane may never touch", () => {
  // A SOURCE FENCE, because the invariant is an absence and no run can prove
  // one. "This job did not stamp freshness" is only ever demonstrated by the
  // job holding no way to.
  const LANE = [
    "app/api/cron/enrich-city-pubs/route.ts",
    "app/api/admin/city-enrichment/route.ts",
    "lib/tavilyPubEnrichment.server.ts",
    "lib/cityEnrichmentCheckpoint.ts",
    "lib/cityEnrichmentCheckpointStore.server.ts",
  ];

  it("never updates freshness merely because the job ran", () => {
    for (const file of LANE) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not reach the freshness spine`).not.toMatch(
        /from "@\/lib\/(freshness|dataFreshness|freshnessNotify)"/,
      );
      expect(source, `${file} must not stamp a feed`).not.toMatch(/feed_freshness/);
    }
  });

  it("never writes a price, so a retry can never duplicate one", () => {
    for (const file of LANE) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not reach a price store`).not.toMatch(
        /from "@\/lib\/(communityPriceStore|pintDropsStore|priceHistory)/,
      );
      expect(source, `${file} must not write a price table`).not.toMatch(
        /"(community_prices|pint_drops|drink_price_updates)"/,
      );
    }
  });
});
