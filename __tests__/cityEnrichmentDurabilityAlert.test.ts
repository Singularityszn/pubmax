// A checkpoint that landed in memory must SAY so (Astra finding F04).
//
// `checkpointDurable` used to be answered by `isSupabaseConfigured()`, which
// is a question about credentials. The store falls back to process memory when
// its table is absent, so a deployment with keys and no migration 0142 wrote
// every deferral to a map that dies with the function instance, and reported a
// durable checkpoint while doing it. The retry lane was inert and the response
// said it was healthy, which is why F04 could observe deferred work and no
// recovery at the same time.
//
// This file drives the route with the enrichment core replaced, because the
// state under test is a DISAGREEMENT between what the deployment expects and
// what its writes did, and only a run that wrote can be in it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CityEnrichmentHealth } from "@/lib/cityEnrichmentCheckpoint";

const runScheduledCityEnrichment = vi.fn();

vi.mock("@/lib/tavilyPubEnrichment.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tavilyPubEnrichment.server")>();
  return { ...actual, runScheduledCityEnrichment };
});

const { GET } = await import("@/app/api/cron/enrich-city-pubs/route");

function req(): Request {
  return new Request("https://pubmaxxing.com/api/cron/enrich-city-pubs", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function health(overrides: Partial<CityEnrichmentHealth> = {}): CityEnrichmentHealth {
  return {
    city: "edinburgh",
    totalPubs: 153,
    nextIndex: 3,
    passes: 0,
    coverage: 3 / 153,
    deferred: 3,
    deferredDue: 0,
    terminal: 0,
    queueAgeMs: 0,
    oldestDeferredFirstFailedAt: "2026-09-06T03:15:00.000Z",
    queueAgeAlert: false,
    leaseHeld: false,
    leaseExpiresAt: null,
    updatedAt: "2026-09-06T03:15:13.000Z",
    lastRun: null,
    venuesOwedARetry: [],
    venuesRefused: [],
    ...overrides,
  };
}

function enrichmentResult(overrides: Record<string, unknown>) {
  return {
    city: "edinburgh",
    primaryCity: "edinburgh",
    totalPubs: 153,
    startIndex: 0,
    nextIndex: 3,
    queriesSpent: 3,
    creditsSpent: 3,
    matchedPubs: 0,
    prices: [],
    pages: [],
    delegatedChains: [],
    complete: false,
    cityRuns: [],
    checkpoints: [health()],
    ...overrides,
  };
}

let errorLines: string[];

beforeEach(() => {
  errorLines = [];
  runScheduledCityEnrichment.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the durability a run reports", () => {
  it("alerts when a deployment expecting a durable checkpoint wrote to memory", async () => {
    runScheduledCityEnrichment.mockResolvedValue(
      enrichmentResult({ checkpointDurable: false, checkpointExpectedDurable: true }),
    );

    const body = (await (await GET(req())).json()) as {
      checkpointDurable: boolean | null;
      checkpointExpectedDurable: boolean;
    };

    expect(body.checkpointDurable).toBe(false);
    expect(body.checkpointExpectedDurable).toBe(true);
    const alert = errorLines.find((line) => line.includes("checkpoint-not-durable"));
    expect(alert).toBeDefined();
    // It names the remedy, because the operator's next move is one command.
    expect(alert).toContain("migration 0142");
  });

  it("says nothing when a keyless deployment writes to memory, which is expected", async () => {
    runScheduledCityEnrichment.mockResolvedValue(
      enrichmentResult({ checkpointDurable: false, checkpointExpectedDurable: false }),
    );

    await GET(req());
    expect(errorLines.some((line) => line.includes("checkpoint-not-durable"))).toBe(false);
  });

  it("reports a run that wrote no checkpoint as null, never as memory", async () => {
    // Every city declined to spend: the lease was held, or the checkpoint
    // could not be read. Nothing was written, so nothing is known about where
    // a write would have landed, and false would be an invented answer.
    runScheduledCityEnrichment.mockResolvedValue(
      enrichmentResult({ checkpointDurable: null, checkpointExpectedDurable: true }),
    );

    const body = (await (await GET(req())).json()) as { checkpointDurable: boolean | null };
    expect(body.checkpointDurable).toBeNull();
    expect(errorLines.some((line) => line.includes("checkpoint-not-durable"))).toBe(false);
  });

  it("still alerts on the failure path, because a broken night is when it matters", async () => {
    const failure = Object.assign(new Error("City enrichment provider unavailable."), {
      checkpointDurable: false,
      checkpointExpectedDurable: true,
      checkpoints: [health({ deferred: 3, queueAgeAlert: true, queueAgeMs: 9_000_000 })],
      cityRuns: [],
    });
    runScheduledCityEnrichment.mockRejectedValue(failure);

    const response = await GET(req());
    expect(response.status).toBe(502);
    expect(errorLines.some((line) => line.includes("checkpoint-not-durable"))).toBe(true);
    expect(errorLines.some((line) => line.includes("deferred-queue-not-draining"))).toBe(true);
  });
});
