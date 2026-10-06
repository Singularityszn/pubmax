// The scheduled sweep under fault. Nothing here reaches the paid provider: the
// global fetch is stubbed per query, so each case is one shape of failure.
//
// What the cases hold: a query that FAILED leaves no half-written candidate and
// is recorded for a bounded retry; two failures in a row call a provider outage
// rather than burning an attempt on every query; a live lease means the second
// scheduler spends nothing at all; and a re-run never resurrects a candidate a
// person already decided.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storeOverride } = vi.hoisted(() => ({
  storeOverride: { candidates: null as unknown },
}));
vi.mock("@/lib/nightSignalStore.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nightSignalStore.server")>();
  return {
    ...actual,
    nightSignalCandidateStore: () => storeOverride.candidates ?? actual.nightSignalCandidateStore(),
  };
});

import { GET } from "@/app/api/cron/refresh-night-signals/route";
import {
  claimNightSignalLease,
  emptyNightSignalCheckpoint,
  NIGHT_SIGNAL_SWEEP_SCOPE,
} from "@/lib/nightSignalReview";
import {
  nightSignalCandidateStore,
  nightSignalCheckpointStore,
  resetNightSignalStoreMemory,
} from "@/lib/nightSignalStore.server";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-09-05T20:00:00.000Z");

function req(): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-night-signals");
}

/** One Exa result the honesty rules accept: dated, https, area-attributable. */
function exaResult(area: string, headline: string, path: string): unknown {
  return {
    title: headline,
    url: `https://example.com/london/${path}`,
    publishedDate: "2026-09-01T09:00:00.000Z",
    text: `The ${area} pub pours a rotating list of cask ale and stays open until 1am.`,
  };
}

function okResponse(results: unknown[]): Response {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Answer each Exa call in turn. `null` means the provider refused, which is the
 * fault this file is about.
 */
function fetchAnswering(answers: Array<unknown[] | null>): ReturnType<typeof vi.fn> {
  let call = 0;
  return vi.fn(async () => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (answer === null) return new Response("upstream error", { status: 503 });
    return okResponse(defined(answer));
  });
}

const CAMDEN = exaResult(
  "Camden",
  "The Camden Arms reopens as a late-night taproom on Chalk Farm Road",
  "camden-arms",
);
const BRIXTON = exaResult(
  "Brixton",
  "A Brixton beer hall wins London pub of the year for its cask list",
  "brixton-beer-hall",
);

beforeEach(() => {
  resetNightSignalStoreMemory();
  storeOverride.candidates = null;
  vi.stubEnv("EXA_API_KEY", "test-exa-key");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a failed provider call leaves no half-written candidate", () => {
  it("stores what answered, records the failure, and stores nothing for it", async () => {
    // Query 1 answers, query 2 refuses, query 3 answers: one failure, so the
    // run carries on rather than calling an outage.
    vi.stubGlobal("fetch", fetchAnswering([[CAMDEN], null, [BRIXTON]]));

    const response = await GET(req());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.queriesRun).toBe(2);
    expect(body.queriesFailed).toBe(1);
    expect(body.abort).toBeNull();
    expect(body.staged).toBe(2);

    const pending = await nightSignalCandidateStore().list({ state: "pending" });
    if (pending.status !== "ready") throw new Error("the memory store always answers");
    expect(pending.candidates).toHaveLength(2);
    // Every stored row is whole: a candidate that failed validation, or that a
    // refused query would have produced, is simply not there.
    for (const candidate of pending.candidates) {
      expect(candidate.reviewState).toBe("pending");
      expect(candidate.reviewedAt).toBeNull();
      expect(candidate.sourceUrl.startsWith("https://")).toBe(true);
      expect(candidate.routeEffect).toBe("none");
    }

    const checkpoint = await nightSignalCheckpointStore().read(NIGHT_SIGNAL_SWEEP_SCOPE, NOW);
    expect(checkpoint?.deferred).toHaveLength(1);
    expect(checkpoint?.deferred[0]).toMatchObject({ attempts: 1 });
    expect(checkpoint?.deferred[0]?.reason).toMatch(/Exa search failed \(503\)/);
    // The lease is given back, so the next sweep is not blocked by this one.
    expect(checkpoint?.leaseOwner).toBeNull();
    expect(checkpoint?.lastRun).toMatchObject({ queriesRun: 2, queriesFailed: 1 });
  });

  it("calls a provider outage instead of burning an attempt on every query", async () => {
    const fetchMock = fetchAnswering([null]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(req());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    // Two refusals in a row end the run: the third query keeps its attempts.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const checkpoint = await nightSignalCheckpointStore().read(NIGHT_SIGNAL_SWEEP_SCOPE, NOW);
    expect(checkpoint?.deferred).toHaveLength(2);
    expect(checkpoint?.lastRun?.abort).toBe("provider-outage");
    const pending = await nightSignalCandidateStore().list({ state: "pending" });
    expect(pending.status === "ready" && pending.candidates).toHaveLength(0);
  });

  it("reports a write it could not run rather than claiming the candidates were stored", async () => {
    vi.stubGlobal("fetch", fetchAnswering([[CAMDEN]]));
    storeOverride.candidates = {
      save: async () => ({ status: "unavailable", reason: "connection refused" }),
      list: async () => ({ status: "unavailable", reason: "connection refused" }),
      approved: async () => ({ status: "unavailable", reason: "connection refused" }),
      review: async () => ({ status: "unavailable", reason: "connection refused" }),
    };

    const response = await GET(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
    const checkpoint = await nightSignalCheckpointStore().read(NIGHT_SIGNAL_SWEEP_SCOPE, NOW);
    expect(checkpoint?.lastRun?.abort).toBe("store-unavailable");
    expect(checkpoint?.leaseOwner).toBeNull();
  });
});

describe("one lease, one sweep", () => {
  it("spends nothing while another run holds the lease", async () => {
    const claimed = claimNightSignalLease(
      emptyNightSignalCheckpoint(NIGHT_SIGNAL_SWEEP_SCOPE, NOW - 1_000),
      { owner: "run-already-going", now: NOW - 1_000 },
    );
    if (!claimed.ok) throw new Error("the first lease must be claimable");
    await nightSignalCheckpointStore().save(claimed.checkpoint);

    const fetchMock = fetchAnswering([[CAMDEN]]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      skipped: "lease-held",
      heldBy: "run-already-going",
      staged: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks nobody anything without a key, and takes no lease for it", async () => {
    vi.stubEnv("EXA_API_KEY", "");
    const fetchMock = fetchAnswering([[CAMDEN]]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(req());
    expect(await response.json()).toMatchObject({ skipped: "no-exa-key", staged: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await nightSignalCheckpointStore().read(NIGHT_SIGNAL_SWEEP_SCOPE, NOW)).toBeNull();
  });
});

describe("a re-run is idempotent", () => {
  it("keeps what it already holds and never resurrects a decided candidate", async () => {
    vi.stubGlobal("fetch", fetchAnswering([[CAMDEN]]));
    const first = await (await GET(req())).json();
    expect(first.staged).toBeGreaterThan(0);
    const id = first.candidateIds[0] as string;

    // A person rejects it, which is the whole point of the queue.
    const rejected = await nightSignalCandidateStore().review(id, {
      action: "reject",
      authority: "operations",
      now: NOW,
    });
    expect(rejected.status).toBe("decided");

    // The provider still returns it tomorrow. The sweep must not undo the
    // decision, and must not stage it a second time.
    vi.setSystemTime(new Date(NOW + 24 * 60 * 60_000));
    vi.stubGlobal("fetch", fetchAnswering([[CAMDEN]]));
    const second = await (await GET(req())).json();
    expect(second.staged).toBe(0);
    expect(second.kept).toBeGreaterThan(0);

    const pending = await nightSignalCandidateStore().list({ state: "pending" });
    expect(pending.status === "ready" && pending.candidates.map((row) => row.id)).not.toContain(id);
    const stillRejected = await nightSignalCandidateStore().list({ state: "rejected" });
    expect(
      stillRejected.status === "ready" && stillRejected.candidates.map((row) => row.id),
    ).toEqual([id]);
  });
});
