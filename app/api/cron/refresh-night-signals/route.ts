// GET /api/cron/refresh-night-signals — scheduled Night Signal candidate sweep.
//
// The EXA candidate ingestion (scripts/ingest_night_signal_candidates.mjs) was
// stranded on the retired GitHub Actions runner. EXA_API_KEY is now present in
// Vercel, so this cron runs the SAME tested sweep in a function: it queries Exa
// for recent, dated, attributable London pub buzz, PERSISTS what it finds as
// PENDING candidates, and stamps an honest freshness observation so
// /api/freshness and the freshness-audit see that candidate ingestion is running.
//
// WHAT CHANGED (this is the follow-up the old header named): a serverless
// function cannot own the git-PR review flow the CLI uses, so every candidate
// used to die with the invocation and the reviewed feed never advanced. A
// candidate is now stored in `night_signal_claims` as PENDING and a person
// advances it at POST /api/admin/night-signals. This cron still PUBLISHES
// NOTHING: it may only ever write pending rows, and human review still gates
// what a reader sees (docs/CRON_PLANE_RUNBOOK.md).
//
// BOUNDED AND SAFE TO RETRY, in the enrichment cron's shape: one lease per
// scope so two schedulers cannot both spend the provider budget, a per-query
// attempt cap with backoff, and a consecutive-failure limit that calls a
// provider outage rather than burning an attempt on every query.
//
// AUTH: CRON_SECRET Bearer (lib/cronAuth). Mutating-by-effect GET; not part of the
// public mutating-verb inventory (docs/WRITE_SURFACE_CERTIFICATION.md).

import { randomUUID } from "node:crypto";

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { assertCronRequest } from "@/lib/cronAuth";
import { feedFreshnessStore } from "@/lib/feedFreshnessStore";
import { NIGHT_SIGNAL_CANDIDATES_FEED_KEY } from "@/lib/freshnessStoreOverlay";
import { validateNightSignalClaim, type NightSignalClaim } from "@/lib/nightSignalClaims";
import { nightSignalQuerySet, sweepNightSignalQuery } from "@/lib/nightSignalIngest.server";
import {
  dueNightSignalQueries,
  nightSignalProviderOutage,
  NIGHT_SIGNAL_SWEEP_SCOPE,
  recordQueryFailure,
  recordQuerySuccess,
  releaseNightSignalLease,
  type NightSignalCheckpoint,
  type NightSignalRunRecord,
} from "@/lib/nightSignalReview";
import {
  nightSignalCandidateStore,
  nightSignalCheckpointStore,
} from "@/lib/nightSignalStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 3 Exa queries in series; a full sweep is bounded well under this ceiling.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    // Documented keyless default: safe no-op, never a fake stamp, and no lease
    // spent on a run that was never going to ask anybody anything.
    console.warn(
      "[cron:refresh-night-signals] EXA_API_KEY absent: candidate ingestion skipped (safe no-op).",
    );
    return jsonNoStore({
      ok: true,
      feed: "night_signal_candidates",
      skipped: "no-exa-key",
      staged: 0,
    });
  }

  const startedAt = Date.now();
  const owner = `cron-${startedAt}-${randomUUID().slice(0, 8)}`;
  const claim = await nightSignalCheckpointStore().claim({
    scope: NIGHT_SIGNAL_SWEEP_SCOPE,
    owner,
    now: startedAt,
  });
  if (claim.status === "lease-held") {
    // Another run is inside the window. Doing nothing is the whole point of a
    // lease, so this is an honest 200 rather than a failure.
    console.log(
      `[cron:refresh-night-signals] lease held by ${claim.heldBy} until ${claim.expiresAt}; skipping.`,
    );
    return jsonNoStore({
      ok: true,
      feed: "night_signal_candidates",
      skipped: "lease-held",
      heldBy: claim.heldBy,
      leaseExpiresAt: claim.expiresAt,
      staged: 0,
    });
  }
  if (claim.status === "unavailable") {
    console.error(
      "[cron:refresh-night-signals][night-signals][ALERT] checkpoint unavailable; sweeping without one would spend unbudgeted:",
      claim.reason,
    );
    return publicApiError("Night Signal checkpoint unavailable.", "CHECKPOINT_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  let checkpoint: NightSignalCheckpoint = claim.checkpoint;
  const due = dueNightSignalQueries(checkpoint, nightSignalQuerySet(), startedAt);
  const candidates = new Map<string, NightSignalClaim>();
  let queriesRun = 0;
  let queriesFailed = 0;
  let candidatesSeen = 0;
  let consecutiveFailures = 0;
  let abort: string | null = null;

  for (const query of due) {
    const now = Date.now();
    const outcome = await sweepNightSignalQuery(query, { apiKey, now });
    if (outcome.status === "failed") {
      // Recorded BEFORE the run decides what to do next, so the query that ends
      // a sweep is never a query nobody hears about again.
      const failure = recordQueryFailure(checkpoint, { query, reason: outcome.reason, now });
      checkpoint = failure.checkpoint;
      queriesFailed += 1;
      consecutiveFailures += 1;
      console.warn(
        `[cron:refresh-night-signals] query failed (attempt ${failure.attempts}${failure.terminal ? ", terminal" : ""}): ${outcome.reason}`,
      );
      if (nightSignalProviderOutage(consecutiveFailures)) {
        abort = "provider-outage";
        break;
      }
      continue;
    }
    checkpoint = recordQuerySuccess(checkpoint, { query, now });
    queriesRun += 1;
    consecutiveFailures = 0;
    for (const candidate of outcome.candidates) {
      candidatesSeen += 1;
      // Only a contract-valid PENDING claim is ever offered to the store, so a
      // half-formed candidate cannot become a row a person has to clean up.
      const valid = validateNightSignalClaim(candidate);
      if (valid && valid.reviewState === "pending") candidates.set(valid.id, valid);
    }
  }

  const save = await nightSignalCandidateStore().save([...candidates.values()]);
  const finishedAt = Date.now();
  const runRecord: NightSignalRunRecord = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    queriesRun,
    queriesFailed,
    candidatesSeen,
    candidatesStored: save.status === "saved" ? save.stored.length : 0,
    candidatesKept: save.status === "saved" ? save.kept.length : 0,
    abort: save.status === "unavailable" ? "store-unavailable" : abort,
  };
  // The lease is released and the run written down whatever happened, so the
  // next sweep is never blocked by a run that already ended.
  const commit = await nightSignalCheckpointStore().commit(
    releaseNightSignalLease(checkpoint, { now: finishedAt, runRecord }),
    owner,
  );
  if (commit.status !== "committed") {
    console.error(
      `[cron:refresh-night-signals][night-signals][ALERT] checkpoint commit did not land (${commit.status}); attempts may be re-spent.`,
    );
  }

  if (save.status === "unavailable") {
    console.error(
      "[cron:refresh-night-signals][night-signals][ALERT] candidate store unavailable: the sweep ran and NOTHING was persisted:",
      save.reason,
    );
    return publicApiError("Night Signal candidate store unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  if (queriesRun === 0) {
    // Every query the run was owed refused. That is a fact about the provider,
    // and it may never be stamped as an observation of the feed.
    console.error(
      "[cron:refresh-night-signals][night-signals][ALERT] no query answered; freshness NOT stamped.",
    );
    return publicApiError("Night Signal provider unavailable.", "PROVIDER_UNAVAILABLE", 502, {
      retryable: true,
    });
  }

  const observedAt = new Date(finishedAt).toISOString();
  const outcome = await feedFreshnessStore().stamp({
    feed: NIGHT_SIGNAL_CANDIDATES_FEED_KEY,
    observedAt,
    rowsServed: save.stored.length,
    note: `${save.stored.length} new pending candidate(s) stored, ${save.kept.length} already held (awaiting human review)`,
  });
  if (outcome.failed) {
    console.error(
      "[cron:refresh-night-signals][night-signals][ALERT] freshness stamp failed: ingestion ran but freshness NOT recorded.",
    );
    return publicApiError("Night Signal freshness store unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  console.log(
    `[cron:refresh-night-signals] stored ${save.stored.length} pending candidate(s), kept ${save.kept.length}, ${queriesFailed} query failure(s) at ${observedAt}.`,
  );
  return jsonNoStore({
    ok: true,
    feed: "night_signal_candidates",
    observedAt,
    durable: save.durable,
    queriesRun,
    queriesFailed,
    abort: runRecord.abort,
    // PENDING only — never published; human review still gates the reviewed feed.
    staged: save.stored.length,
    kept: save.kept.length,
    candidateIds: save.stored,
  });
}
