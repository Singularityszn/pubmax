// The Night Signal review policy: what a person may do to a stored candidate,
// and what a re-run may not. Pure, so these cases touch no store and no
// provider.

import { describe, expect, it } from "vitest";

import type { NightSignalClaim } from "@/lib/nightSignalClaims";
import {
  claimNightSignalLease,
  CONSECUTIVE_QUERY_FAILURE_LIMIT,
  dueNightSignalQueries,
  emptyNightSignalCheckpoint,
  MAX_QUERY_ATTEMPTS,
  nightSignalCandidateWriteLane,
  nightSignalProviderOutage,
  nightSignalQueryKey,
  NIGHT_SIGNAL_LEASE_MS,
  normaliseNightSignalCheckpoint,
  parseReviewAction,
  parseReviewAuthority,
  recordQueryFailure,
  recordQuerySuccess,
  releaseNightSignalLease,
  requeueTerminalQueries,
  reviewCandidateDecision,
  RETRY_QUERY_BUDGET,
  type NightSignalQuery,
} from "@/lib/nightSignalReview";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-09-05T20:00:00.000Z");
const DAY = 24 * 60 * 60_000;

const QUERIES: NightSignalQuery[] = [
  { kind: "opening", query: "new London pub or bar opening this month" },
  { kind: "event", query: "London pub wins award best pub of the year" },
  { kind: "event", query: "best pint in London pub review feature" },
];

function pendingCandidate(overrides: Partial<NightSignalClaim> = {}): NightSignalClaim {
  return {
    id: "opening:camden:20260901:abcd1234",
    kind: "opening",
    entity: { type: "night_area", id: "camden" },
    claim: "The Camden Arms reopens as a late-night taproom on Chalk Farm Road",
    sourceUrl: "https://example.com/london/camden-arms",
    publisher: "example.com",
    publishedAt: new Date(NOW - 3 * DAY).toISOString(),
    observedAt: new Date(NOW - DAY).toISOString(),
    expiresAt: new Date(NOW + 20 * DAY).toISOString(),
    confidence: 0.5,
    reviewState: "pending",
    verification: "single_source",
    routeEffect: "none",
    corroboratingSources: [],
    reviewedAt: null,
    reviewAuthority: null,
    ...overrides,
  };
}

describe("a person decides once", () => {
  it("approves a pending candidate under a named human authority", () => {
    const decision = reviewCandidateDecision(pendingCandidate(), {
      action: "approve",
      authority: "editorial",
      now: NOW,
    });
    expect(decision).toEqual({
      status: "decided",
      reviewState: "approved",
      reviewedAt: new Date(NOW).toISOString(),
      reviewAuthority: "editorial",
    });
  });

  it("rejects a pending candidate the same way", () => {
    const decision = reviewCandidateDecision(pendingCandidate(), {
      action: "reject",
      authority: "operations",
      now: NOW,
    });
    expect(decision.status).toBe("decided");
    expect(decision).toMatchObject({ reviewState: "rejected" });
  });

  it("refuses a second decision and names the standing one", () => {
    const decided = pendingCandidate({
      reviewState: "rejected",
      reviewedAt: new Date(NOW - 60_000).toISOString(),
      reviewAuthority: "operations",
    });
    expect(
      reviewCandidateDecision(decided, { action: "approve", authority: "editorial", now: NOW }),
    ).toEqual({
      status: "already_decided",
      reviewState: "rejected",
      reviewedAt: new Date(NOW - 60_000).toISOString(),
      reviewAuthority: "operations",
    });
  });

  it("refuses to approve a candidate that would publish nothing", () => {
    const stale = pendingCandidate({ expiresAt: new Date(NOW - 60_000).toISOString() });
    expect(
      reviewCandidateDecision(stale, { action: "approve", authority: "operations", now: NOW }),
    ).toEqual({ status: "expired", expiresAt: stale.expiresAt });
    // Rejecting one is still allowed: taking it out of the queue costs nobody
    // anything and leaves the reason on the row.
    expect(
      reviewCandidateDecision(stale, { action: "reject", authority: "operations", now: NOW }).status,
    ).toBe("decided");
  });

  it("takes only the two human authorities and only the two actions", () => {
    expect(parseReviewAction("approve")).toBe("approve");
    expect(parseReviewAction("publish")).toBeNull();
    expect(parseReviewAuthority(undefined)).toBe("operations");
    expect(parseReviewAuthority("editorial")).toBe("editorial");
    // `automated` is a real claim authority and NOT a door a caller may name:
    // the point of this surface is that a person advanced the candidate.
    expect(parseReviewAuthority("automated")).toBeNull();
  });
});

describe("a re-run never overturns a decision", () => {
  it("inserts an unseen candidate and keeps every candidate the store holds", () => {
    expect(nightSignalCandidateWriteLane(null)).toBe("insert");
    expect(nightSignalCandidateWriteLane({ reviewState: "pending" })).toBe("keep");
    expect(nightSignalCandidateWriteLane({ reviewState: "rejected" })).toBe("keep");
    expect(nightSignalCandidateWriteLane({ reviewState: "approved" })).toBe("keep");
  });
});

describe("the sweep is bounded and safe to retry", () => {
  it("claims one lease and refuses a second run inside its window", () => {
    const claimed = claimNightSignalLease(emptyNightSignalCheckpoint("london", NOW), {
      owner: "run-a",
      now: NOW,
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.checkpoint.leaseExpiresAt).toBe(
      new Date(NOW + NIGHT_SIGNAL_LEASE_MS).toISOString(),
    );

    const second = claimNightSignalLease(claimed.checkpoint, { owner: "run-b", now: NOW + 1_000 });
    expect(second).toEqual({
      ok: false,
      heldBy: "run-a",
      expiresAt: claimed.checkpoint.leaseExpiresAt,
    });

    // An expired lease is not a lease: the next run takes it.
    const later = claimNightSignalLease(claimed.checkpoint, {
      owner: "run-b",
      now: NOW + NIGHT_SIGNAL_LEASE_MS + 1,
    });
    expect(later.ok).toBe(true);
  });

  it("releases the lease with the run written down", () => {
    const claimed = claimNightSignalLease(emptyNightSignalCheckpoint("london", NOW), {
      owner: "run-a",
      now: NOW,
    });
    if (!claimed.ok) throw new Error("the first lease must be claimable");
    const released = releaseNightSignalLease(claimed.checkpoint, {
      now: NOW + 5_000,
      runRecord: {
        startedAt: new Date(NOW).toISOString(),
        finishedAt: new Date(NOW + 5_000).toISOString(),
        queriesRun: 3,
        queriesFailed: 0,
        candidatesSeen: 7,
        candidatesStored: 2,
        candidatesKept: 5,
        abort: null,
      },
    });
    expect(released.leaseOwner).toBeNull();
    expect(released.leaseExpiresAt).toBeNull();
    expect(released.lastRun?.candidatesStored).toBe(2);
  });

  it("defers a failed query with backoff and asks the other queries anyway", () => {
    const failed = recordQueryFailure(emptyNightSignalCheckpoint("london", NOW), {
      query: defined(QUERIES[0]),
      reason: "Exa search failed (503).",
      now: NOW,
    });
    expect(failed.terminal).toBe(false);
    expect(failed.attempts).toBe(1);
    expect(failed.checkpoint.deferred[0]).toMatchObject({
      key: nightSignalQueryKey(defined(QUERIES[0])),
      attempts: 1,
      reason: "Exa search failed (503).",
    });

    // Still inside its backoff, so this run asks the other two.
    expect(dueNightSignalQueries(failed.checkpoint, QUERIES, NOW + 60_000)).toEqual([
      QUERIES[1],
      QUERIES[2],
    ]);
    // Past it, the retry leads.
    expect(dueNightSignalQueries(failed.checkpoint, QUERIES, NOW + DAY)).toEqual([
      QUERIES[0],
      QUERIES[1],
      QUERIES[2],
    ]);
  });

  it("makes a query terminal at the attempt cap and gives it a way back", () => {
    let outcome = recordQueryFailure(emptyNightSignalCheckpoint("london", NOW), {
      query: defined(QUERIES[0]),
      reason: "timeout",
      now: NOW,
    });
    for (let attempt = 1; attempt < MAX_QUERY_ATTEMPTS; attempt += 1) {
      outcome = recordQueryFailure(outcome.checkpoint, {
        query: defined(QUERIES[0]),
        reason: "timeout",
        now: NOW + attempt * DAY,
      });
    }
    const checkpoint = outcome.checkpoint;
    expect(outcome.terminal).toBe(true);
    expect(outcome.attempts).toBe(MAX_QUERY_ATTEMPTS);
    expect(checkpoint.deferred).toHaveLength(0);
    expect(checkpoint.terminal[0]?.key).toBe(nightSignalQueryKey(defined(QUERIES[0])));
    // Terminal means the sweep stops asking, not that nobody may.
    expect(dueNightSignalQueries(checkpoint, QUERIES, NOW + 30 * DAY)).toEqual([
      QUERIES[1],
      QUERIES[2],
    ]);

    const requeued = requeueTerminalQueries(checkpoint, { now: NOW + 31 * DAY });
    expect(requeued.requeued).toBe(1);
    expect(dueNightSignalQueries(requeued.checkpoint, QUERIES, NOW + 31 * DAY)).toEqual(QUERIES);
    // Requeueing nothing is honest about it rather than rewriting the row.
    expect(requeueTerminalQueries(requeued.checkpoint, { now: NOW }).requeued).toBe(0);
  });

  it("caps how much of one run retries may take", () => {
    let checkpoint = emptyNightSignalCheckpoint("london", NOW);
    for (const query of QUERIES) {
      checkpoint = recordQueryFailure(checkpoint, { query, reason: "timeout", now: NOW }).checkpoint;
    }
    const due = dueNightSignalQueries(checkpoint, QUERIES, NOW + DAY);
    expect(due).toHaveLength(RETRY_QUERY_BUDGET);
  });

  it("clears a deferred query the provider then answered", () => {
    const failed = recordQueryFailure(emptyNightSignalCheckpoint("london", NOW), {
      query: defined(QUERIES[0]),
      reason: "timeout",
      now: NOW,
    }).checkpoint;
    const answered = recordQuerySuccess(failed, { query: defined(QUERIES[0]), now: NOW + DAY });
    expect(answered.deferred).toHaveLength(0);
  });

  it("calls a provider outage rather than burning an attempt on every query", () => {
    expect(nightSignalProviderOutage(CONSECUTIVE_QUERY_FAILURE_LIMIT - 1)).toBe(false);
    expect(nightSignalProviderOutage(CONSECUTIVE_QUERY_FAILURE_LIMIT)).toBe(true);
  });

  it("rebuilds a stored row of another version rather than half-reading it", () => {
    const stored = { version: 99, scope: "london", deferred: [{ key: "x", attempts: 7 }] };
    expect(normaliseNightSignalCheckpoint(stored, "london", NOW)).toEqual(
      emptyNightSignalCheckpoint("london", NOW),
    );
  });

  it("reads an undateable lease as expired rather than blocking every later run", () => {
    const stuck = normaliseNightSignalCheckpoint(
      {
        version: 1,
        scope: "london",
        deferred: [],
        terminal: [],
        leaseOwner: "run-a",
        leaseExpiresAt: "not a date",
        updatedAt: new Date(NOW).toISOString(),
      },
      "london",
      NOW,
    );
    expect(claimNightSignalLease(stuck, { owner: "run-b", now: NOW }).ok).toBe(true);
  });
});
