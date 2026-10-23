// The checkpoint policy on its own: no provider, no store, no clock.
//
// The one sentence these cases exist to hold: `nextIndex` is an ADVANCEMENT
// and it only ever advances past a venue whose outcome was RECORDED. The
// production 502 of 2026-09-05 happened because a number that looked like a
// cursor was in fact the index of the venue that had just failed, and nothing
// read it back at all.

import { describe, expect, it } from "vitest";

import {
  CITY_ENRICHMENT_LEASE_MS,
  DEFERRED_QUEUE_AGE_ALERT_MS,
  MAX_DEFERRED_VENUES,
  MAX_TERMINAL_VENUES,
  MAX_VENUE_ATTEMPTS,
  RETRY_QUERY_BUDGET,
  VENUE_RETRY_BACKOFF_MS,
  VENUE_RETRY_JITTER_RATIO,
  advanceCursor,
  backoffMsForAttempts,
  cityEnrichmentHealth,
  deferredQueueAgeExceeded,
  deferredQueueAgeMs,
  jitteredBackoffMs,
  claimEnrichmentLease,
  emptyCityEnrichmentCheckpoint,
  leaseIsLive,
  normaliseCheckpoint,
  planCityEnrichment,
  recordVenueFailure,
  recordVenueSuccess,
  releaseEnrichmentLease,
  requeueTerminalVenues,
  runLevelFailure,
  venueRetryDue,
} from "@/lib/cityEnrichmentCheckpoint";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-09-05T03:15:13.000Z");

function fresh(totalPubs = 106) {
  return emptyCityEnrichmentCheckpoint("birmingham", totalPubs, NOW);
}

describe("the cursor", () => {
  it("advances past a venue that failed, because the deferred list owns its retry", () => {
    let checkpoint = fresh();
    const failed = recordVenueFailure(checkpoint, {
      osmId: "node/1",
      error: "Search request timed out after 12000ms.",
      now: NOW,
    });
    checkpoint = advanceCursor(failed.checkpoint, { nextIndex: 103, totalPubs: 106, now: NOW });

    expect(failed.outcome).toBe("deferred");
    expect(checkpoint.nextIndex).toBe(103);
    // The venue is not skipped: it is owed, by name.
    expect(checkpoint.deferred.map((entry) => entry.osmId)).toEqual(["node/1"]);
  });

  it("never moves backwards, so a failed run cannot lose an earlier run's work", () => {
    const ahead = advanceCursor(fresh(), { nextIndex: 60, totalPubs: 106, now: NOW });
    const behind = advanceCursor(ahead, { nextIndex: 10, totalPubs: 106, now: NOW });
    expect(behind.nextIndex).toBe(60);
  });

  it("wraps at the end of the city rather than reading as nothing left to do", () => {
    const wrapped = advanceCursor(fresh(), { nextIndex: 106, totalPubs: 106, now: NOW });
    expect(wrapped.nextIndex).toBe(0);
    expect(wrapped.passes).toBe(1);
  });

  it("starts the city again when the pack no longer holds the stored index", () => {
    const stored = advanceCursor(fresh(), { nextIndex: 100, totalPubs: 106, now: NOW });
    // A rebuilt pack with fewer pubs: index 100 is a different pub or no pub.
    const reread = normaliseCheckpoint(stored, "birmingham", 40, NOW);
    expect(reread.nextIndex).toBe(0);
  });
});

describe("bounded retries", () => {
  it("backs a venue off further with every attempt", () => {
    expect(backoffMsForAttempts(1)).toBe(VENUE_RETRY_BACKOFF_MS[0]);
    expect(backoffMsForAttempts(2)).toBe(VENUE_RETRY_BACKOFF_MS[1]);
    // Past the table it holds at the longest step rather than growing for ever.
    expect(backoffMsForAttempts(99)).toBe(VENUE_RETRY_BACKOFF_MS.at(-1));
  });

  it("refuses a venue after the attempt cap and never spends another query on it", () => {
    let checkpoint = fresh();
    let outcome: "deferred" | "terminal" = "deferred";
    for (let attempt = 1; attempt <= MAX_VENUE_ATTEMPTS; attempt += 1) {
      const record = recordVenueFailure(checkpoint, { osmId: "node/1", error: "503", now: NOW });
      checkpoint = record.checkpoint;
      outcome = record.outcome;
    }
    expect(outcome).toBe("terminal");
    expect(checkpoint.deferred).toHaveLength(0);
    expect(checkpoint.terminal).toEqual([
      expect.objectContaining({ osmId: "node/1", attempts: MAX_VENUE_ATTEMPTS }),
    ]);
    // A refused venue is not planned for again.
    const plan = planCityEnrichment(checkpoint, { now: NOW, queryBudget: 10 });
    expect(plan.retryOsmIds).toEqual([]);
  });

  it("holds a deferred venue back until its backoff has passed", () => {
    const deferred = recordVenueFailure(fresh(), { osmId: "node/1", error: "503", now: NOW })
      .checkpoint;
    expect(venueRetryDue(defined(deferred.deferred[0]), NOW)).toBe(false);
    expect(venueRetryDue(defined(deferred.deferred[0]), NOW + VENUE_RETRY_BACKOFF_MS[0] + 1)).toBe(true);

    const soon = planCityEnrichment(deferred, { now: NOW, queryBudget: 10 });
    expect(soon.retryOsmIds).toEqual([]);
    expect(soon.waitingRetries).toBe(1);

    const later = planCityEnrichment(deferred, {
      now: NOW + VENUE_RETRY_BACKOFF_MS[0] + 1,
      queryBudget: 10,
    });
    expect(later.retryOsmIds).toEqual(["node/1"]);
  });

  it("owes a retry we cannot date sooner rather than never", () => {
    expect(
      venueRetryDue(
        { osmId: "x", attempts: 1, lastError: "", firstFailedAt: "", retryAfter: "not-a-date" },
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps retries from starving fresh coverage", () => {
    let checkpoint = fresh();
    for (let index = 0; index < 20; index += 1) {
      checkpoint = recordVenueFailure(checkpoint, {
        osmId: `node/${index}`,
        error: "503",
        now: NOW,
      }).checkpoint;
    }
    const plan = planCityEnrichment(checkpoint, {
      now: NOW + VENUE_RETRY_BACKOFF_MS[0] + 1,
      queryBudget: 10,
      retryBudget: RETRY_QUERY_BUDGET,
    });
    expect(plan.retryOsmIds).toHaveLength(RETRY_QUERY_BUDGET);
    expect(plan.freshBudget).toBe(10 - RETRY_QUERY_BUDGET);
  });

  it("drops a venue from the retry queue the moment it answers", () => {
    const deferred = recordVenueFailure(fresh(), { osmId: "node/1", error: "503", now: NOW })
      .checkpoint;
    expect(recordVenueSuccess(deferred, { osmId: "node/1", now: NOW }).deferred).toEqual([]);
  });

  it("bounds both lists so one row can never grow without limit", () => {
    let checkpoint = fresh();
    for (let index = 0; index < MAX_DEFERRED_VENUES + 25; index += 1) {
      checkpoint = recordVenueFailure(checkpoint, {
        osmId: `node/${index}`,
        error: "503",
        now: NOW,
      }).checkpoint;
    }
    expect(checkpoint.deferred.length).toBeLessThanOrEqual(MAX_DEFERRED_VENUES);
    expect(checkpoint.terminal.length).toBeLessThanOrEqual(MAX_TERMINAL_VENUES);
  });
});

describe("the lease", () => {
  it("refuses a second claim while it is live, and admits one after it expires", () => {
    const claimed = claimEnrichmentLease(fresh(), { owner: "run-a", now: NOW });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const second = claimEnrichmentLease(claimed.checkpoint, { owner: "run-b", now: NOW + 1_000 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.heldBy).toBe("run-a");

    // A run that crashed holds nothing once the lease is past.
    const later = claimEnrichmentLease(claimed.checkpoint, {
      owner: "run-b",
      now: NOW + CITY_ENRICHMENT_LEASE_MS + 1,
    });
    expect(later.ok).toBe(true);
  });

  it("treats a lease stamp nobody can read as expired", () => {
    const broken = { ...fresh(), leaseOwner: "run-a", leaseExpiresAt: "whenever" };
    expect(leaseIsLive(broken, NOW)).toBe(false);
  });

  it("is released with the run's own record, even when the run failed", () => {
    const claimed = claimEnrichmentLease(fresh(), { owner: "run-a", now: NOW });
    if (!claimed.ok) throw new Error("claim refused");
    const released = releaseEnrichmentLease(claimed.checkpoint, {
      now: NOW,
      runRecord: {
        runId: "run-a",
        startedAt: new Date(NOW).toISOString(),
        endedAt: new Date(NOW).toISOString(),
        outcome: "failed",
        attempted: 1,
        succeeded: 0,
        failed: 1,
        deferredNow: 1,
        terminalNow: 0,
        queriesSpent: 1,
        creditsSpent: 0,
        matchedPubs: 0,
        pricesExtracted: 0,
        error: "Search request timed out after 12000ms.",
      },
    });
    expect(released.leaseOwner).toBeNull();
    expect(released.lastRun?.outcome).toBe("failed");
  });
});

describe("the retry path a refusal is recorded with", () => {
  it("puts a refused venue back, due immediately", () => {
    let checkpoint = fresh();
    for (let attempt = 0; attempt < MAX_VENUE_ATTEMPTS; attempt += 1) {
      checkpoint = recordVenueFailure(checkpoint, { osmId: "node/1", error: "503", now: NOW })
        .checkpoint;
    }
    const moved = requeueTerminalVenues(checkpoint, { now: NOW });
    expect(moved.requeued).toEqual(["node/1"]);
    expect(moved.checkpoint.terminal).toEqual([]);
    expect(venueRetryDue(defined(moved.checkpoint.deferred[0]), NOW)).toBe(true);
    // Its attempts start again, so the requeue is a real second chance.
    expect(defined(moved.checkpoint.deferred[0]).attempts).toBe(0);
  });

  it("moves only the venues it was asked for", () => {
    let checkpoint = fresh();
    for (const osmId of ["node/1", "node/2"]) {
      for (let attempt = 0; attempt < MAX_VENUE_ATTEMPTS; attempt += 1) {
        checkpoint = recordVenueFailure(checkpoint, { osmId, error: "503", now: NOW }).checkpoint;
      }
    }
    const moved = requeueTerminalVenues(checkpoint, { now: NOW, osmIds: ["node/2"] });
    expect(moved.requeued).toEqual(["node/2"]);
    expect(moved.checkpoint.terminal.map((entry) => entry.osmId)).toEqual(["node/1"]);
  });
});

describe("what counts as a failure about us", () => {
  it("never spends a venue's attempts on an exhausted budget or an abort", () => {
    expect(
      runLevelFailure(
        Object.assign(new Error("cap"), { code: "SEARCH_GATEWAY_BUDGET_EXHAUSTED" }),
      ),
    ).toBe(true);
    expect(runLevelFailure(Object.assign(new Error("stop"), { name: "AbortError" }))).toBe(true);
    // A timeout or a 5xx is a venue we asked about and could not read.
    expect(runLevelFailure(new Error("Search request timed out after 12000ms."))).toBe(false);
    expect(runLevelFailure(new Error("Tavily search failed (503)."))).toBe(false);
  });
});

describe("what the moderator surface prints", () => {
  it("separates the venues owed a retry now from the ones still backing off", () => {
    let checkpoint = fresh();
    checkpoint = recordVenueFailure(checkpoint, { osmId: "node/1", error: "503", now: NOW })
      .checkpoint;
    checkpoint = recordVenueFailure(checkpoint, {
      osmId: "node/2",
      error: "503",
      now: NOW - VENUE_RETRY_BACKOFF_MS[0] - 1,
    }).checkpoint;

    const health = cityEnrichmentHealth(checkpoint, NOW);
    expect(health.deferred).toBe(2);
    expect(health.deferredDue).toBe(1);
    expect(health.terminal).toBe(0);
    expect(health.venuesOwedARetry.map((entry) => entry.osmId)).toEqual(["node/1", "node/2"]);
  });

  it("reads a row it cannot understand as a city nobody has run", () => {
    expect(normaliseCheckpoint({ version: 99, nextIndex: 500 }, "birmingham", 106, NOW)).toEqual(
      emptyCityEnrichmentCheckpoint("birmingham", 106, NOW),
    );
    expect(normaliseCheckpoint(null, "birmingham", 106, NOW).nextIndex).toBe(0);
  });
});

describe("jitter", () => {
  it("spreads the venues one failed batch deferred at the same instant", () => {
    // The production shape: three venues fail inside one run, so every
    // `firstFailedAt` and every backoff base is identical. Without jitter they
    // share one `retryAfter` to the millisecond, come due together and are
    // re-asked together against whatever was still down.
    let checkpoint = fresh();
    for (const osmId of ["node/1001", "node/1002", "node/1003"]) {
      checkpoint = recordVenueFailure(checkpoint, { osmId, error: "timeout", now: NOW }).checkpoint;
    }
    const dueTimes = checkpoint.deferred.map((entry) => Date.parse(entry.retryAfter));
    expect(new Set(dueTimes).size).toBe(dueTimes.length);
  });

  it("only ever takes time OFF the step, so no venue waits longer than the table says", () => {
    const base = backoffMsForAttempts(1);
    const floor = base * (1 - VENUE_RETRY_JITTER_RATIO);
    for (let index = 0; index < 200; index += 1) {
      const jittered = jitteredBackoffMs(`node/${index}`, 1);
      expect(jittered).toBeLessThanOrEqual(base);
      expect(jittered).toBeGreaterThanOrEqual(Math.floor(floor));
    }
  });

  it("is reproducible, because a retry time nobody can replay is one nobody can debug", () => {
    expect(jitteredBackoffMs("node/1001", 2)).toBe(jitteredBackoffMs("node/1001", 2));
    // And it is really applied: at least one venue sits inside the band
    // rather than on its ceiling, or the spread above proves nothing.
    const offCeiling = ["node/1001", "node/1002", "node/1003"].filter(
      (osmId) => jitteredBackoffMs(osmId, 1) < backoffMsForAttempts(1),
    );
    expect(offCeiling.length).toBeGreaterThan(0);
  });
});

describe("the queue age", () => {
  it("is measured from the FIRST failure, so a venue re-failed nightly never looks new", () => {
    const first = recordVenueFailure(fresh(), { osmId: "node/1", error: "503", now: NOW })
      .checkpoint;
    const day = 24 * 60 * 60_000;
    const again = recordVenueFailure(first, {
      osmId: "node/1",
      error: "503",
      now: NOW + day,
    }).checkpoint;
    expect(deferredQueueAgeMs(again, NOW + day)).toBe(day);
  });

  it("answers null for an empty queue, which is not an age of zero", () => {
    expect(deferredQueueAgeMs(fresh(), NOW)).toBeNull();
    expect(deferredQueueAgeExceeded(fresh(), NOW)).toBe(false);
    expect(cityEnrichmentHealth(fresh(), NOW).queueAgeMs).toBeNull();
  });

  it("alerts once the oldest owed retry has outlived the nights that should have resolved it", () => {
    const deferred = recordVenueFailure(fresh(), { osmId: "node/1", error: "503", now: NOW })
      .checkpoint;
    const justInside = NOW + DEFERRED_QUEUE_AGE_ALERT_MS;
    expect(deferredQueueAgeExceeded(deferred, justInside)).toBe(false);
    expect(cityEnrichmentHealth(deferred, justInside).queueAgeAlert).toBe(false);

    const past = justInside + 1;
    expect(deferredQueueAgeExceeded(deferred, past)).toBe(true);
    const health = cityEnrichmentHealth(deferred, past);
    expect(health.queueAgeAlert).toBe(true);
    // The stamp it measured from, so an operator can go and look at the row.
    expect(health.oldestDeferredFirstFailedAt).toBe(defined(deferred.deferred[0]).firstFailedAt);
  });

  it("ignores a stamp it cannot read rather than reporting an age it invented", () => {
    const checkpoint = {
      ...fresh(),
      deferred: [
        { osmId: "node/1", attempts: 1, lastError: "", firstFailedAt: "", retryAfter: "" },
      ],
    };
    expect(deferredQueueAgeMs(checkpoint, NOW)).toBeNull();
    expect(deferredQueueAgeExceeded(checkpoint, NOW)).toBe(false);
  });
});
