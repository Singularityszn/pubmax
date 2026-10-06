// Night Signal candidate review - the policy that lets a swept candidate be
// PERSISTED and then ADVANCED by a person.
//
// WHAT WAS MISSING: `app/api/cron/refresh-night-signals` swept Exa, returned
// the candidates in its own response body and wrote nothing. A serverless
// function cannot own the git-PR review flow the CLI uses, so every candidate
// died with the invocation and the reviewed feed never advanced. This module is
// the rule set that replaces that flow: a candidate is stored PENDING, a
// moderator approves or rejects it once, and the feed reads approved rows.
//
// FOUR rules live here and nowhere else.
//
// 1. A RE-RUN NEVER OVERTURNS A DECISION. The sweep is idempotent by INSERT IF
//    ABSENT: `nightSignalCandidateWriteLane` answers "insert" only for a
//    candidate id the store has never seen, so a rejected candidate that Exa
//    still returns every night can never come back as pending.
// 2. A PERSON DECIDES ONCE. `reviewCandidateDecision` moves pending to approved
//    or rejected and refuses a second decision, naming the standing one, so two
//    moderators racing the same candidate cannot silently overwrite each other.
// 3. APPROVING PUBLISHES SOMETHING. A candidate whose own `expiresAt` has
//    passed is refused rather than approved into a feed that would filter it
//    out, because an approval that shows nobody anything reads as a bug.
// 4. THE SWEEP IS BOUNDED AND SAFE TO RETRY, in the shape
//    `lib/cityEnrichmentCheckpoint.ts` set: one lease per scope, a query whose
//    provider call failed is RECORDED and owed a bounded retry, an attempt cap
//    makes it terminal with a way back, and consecutive failures call a
//    provider outage rather than burning an attempt on every query.
//
// This module is a pure leaf: its one import is the claim TYPE set, so the
// cron, the store, the moderator door and the tests read one copy of the rules.

import { lastOf } from "@/lib/tuple";
import type {
  NightSignalClaim,
  NightSignalReviewAuthority,
  NightSignalReviewState,
} from "@/lib/nightSignalClaims";

/** Bumped when a stored checkpoint shape stops being readable by this policy. */
const NIGHT_SIGNAL_CHECKPOINT_VERSION = 1;

/** The Exa query set is London publications, so one scope holds the sweep. */
export const NIGHT_SIGNAL_SWEEP_SCOPE = "london";

/**
 * Provider calls one query may ever cost. Three attempts, then terminal: a
 * query the provider refuses three times is evidence about the provider or the
 * query, and a fourth attempt spends a sweep another query would use better.
 */
export const MAX_QUERY_ATTEMPTS = 3;

/**
 * Backoff before a deferred query may be asked again, by attempts already made.
 * The cron runs on its own schedule, so the first two steps let a same-day
 * re-run pick the query up while the last holds it back most of a day.
 */
const QUERY_RETRY_BACKOFF_MS = [15 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;

/**
 * Provider calls of one run that retries may take. A poisoned deferred queue
 * can therefore never starve fresh coverage.
 */
export const RETRY_QUERY_BUDGET = 2;

/**
 * Queries in a row a provider may refuse before the run stops asking. An outage
 * is one fact about the provider, not one fact per query, and burning an
 * attempt on every query it touches is how a bad night becomes terminal
 * refusals for queries nobody really asked.
 */
export const CONSECUTIVE_QUERY_FAILURE_LIMIT = 2;

/**
 * How long a claimed sweep lease lives. It outlives the function's own
 * `maxDuration` (60s), so a crashed run blocks the next one only briefly.
 */
export const NIGHT_SIGNAL_LEASE_MS = 150_000;

/** Bounded lists. Operational state is not an archive, and a row has a size. */
const MAX_DEFERRED_QUERIES = 20;
const MAX_TERMINAL_QUERIES = 20;

/** Page ceiling for the moderator queue read. */
export const MAX_REVIEW_PAGE = 100;

export type NightSignalQuery = { kind: string; query: string };

type DeferredQuery = {
  key: string;
  attempts: number;
  retryAfter: string;
  reason: string;
  recordedAt: string;
};

type TerminalQuery = {
  key: string;
  attempts: number;
  reason: string;
  recordedAt: string;
};

export type NightSignalRunRecord = {
  startedAt: string;
  finishedAt: string;
  queriesRun: number;
  queriesFailed: number;
  candidatesSeen: number;
  candidatesStored: number;
  candidatesKept: number;
  /** Why the run stopped early, or null when it ran its whole due set. */
  abort: string | null;
};

export type NightSignalCheckpoint = {
  version: number;
  scope: string;
  deferred: DeferredQuery[];
  terminal: TerminalQuery[];
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastRun: NightSignalRunRecord | null;
  updatedAt: string;
};

function iso(value: number): string {
  return new Date(value).toISOString();
}

function trimmed(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finiteInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/**
 * Stable key for one query of the set. The text is the identity, because the
 * set's ORDER is not: a query added at the front must not inherit another
 * query's attempts.
 */
export function nightSignalQueryKey(query: NightSignalQuery): string {
  return `${trimmed(query.kind, 40)}|${trimmed(query.query, 200)}`;
}

export function emptyNightSignalCheckpoint(scope: string, now: number): NightSignalCheckpoint {
  return {
    version: NIGHT_SIGNAL_CHECKPOINT_VERSION,
    scope: trimmed(scope, 60) || NIGHT_SIGNAL_SWEEP_SCOPE,
    deferred: [],
    terminal: [],
    leaseOwner: null,
    leaseExpiresAt: null,
    lastRun: null,
    updatedAt: iso(now),
  };
}

function normaliseDeferred(value: unknown): DeferredQuery[] {
  if (!Array.isArray(value)) return [];
  const rows: DeferredQuery[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const key = trimmed(row.key, 240);
    if (!key) continue;
    rows.push({
      key,
      attempts: finiteInt(row.attempts, 1),
      retryAfter: isoOrNull(row.retryAfter) ?? iso(0),
      reason: trimmed(row.reason, 240),
      recordedAt: isoOrNull(row.recordedAt) ?? iso(0),
    });
  }
  return rows.slice(0, MAX_DEFERRED_QUERIES);
}

function normaliseTerminal(value: unknown): TerminalQuery[] {
  if (!Array.isArray(value)) return [];
  const rows: TerminalQuery[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const key = trimmed(row.key, 240);
    if (!key) continue;
    rows.push({
      key,
      attempts: finiteInt(row.attempts, MAX_QUERY_ATTEMPTS),
      reason: trimmed(row.reason, 240),
      recordedAt: isoOrNull(row.recordedAt) ?? iso(0),
    });
  }
  return rows.slice(0, MAX_TERMINAL_QUERIES);
}

function normaliseRunRecord(value: unknown): NightSignalRunRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const startedAt = isoOrNull(row.startedAt);
  const finishedAt = isoOrNull(row.finishedAt);
  if (!startedAt || !finishedAt) return null;
  return {
    startedAt,
    finishedAt,
    queriesRun: finiteInt(row.queriesRun, 0),
    queriesFailed: finiteInt(row.queriesFailed, 0),
    candidatesSeen: finiteInt(row.candidatesSeen, 0),
    candidatesStored: finiteInt(row.candidatesStored, 0),
    candidatesKept: finiteInt(row.candidatesKept, 0),
    abort: trimmed(row.abort, 240) || null,
  };
}

/**
 * Read a stored checkpoint back into the shape this policy reasons over. A row
 * written by an older version is rebuilt as an empty checkpoint rather than
 * half-read, because a half-read attempt count is a wrong attempt count.
 */
export function normaliseNightSignalCheckpoint(
  value: unknown,
  scope: string,
  now: number,
): NightSignalCheckpoint {
  if (!value || typeof value !== "object") return emptyNightSignalCheckpoint(scope, now);
  const row = value as Record<string, unknown>;
  if (finiteInt(row.version, 0) !== NIGHT_SIGNAL_CHECKPOINT_VERSION) {
    return emptyNightSignalCheckpoint(scope, now);
  }
  return {
    version: NIGHT_SIGNAL_CHECKPOINT_VERSION,
    scope: trimmed(row.scope, 60) || trimmed(scope, 60) || NIGHT_SIGNAL_SWEEP_SCOPE,
    deferred: normaliseDeferred(row.deferred),
    terminal: normaliseTerminal(row.terminal),
    leaseOwner: trimmed(row.leaseOwner, 120) || null,
    leaseExpiresAt: isoOrNull(row.leaseExpiresAt),
    lastRun: normaliseRunRecord(row.lastRun),
    updatedAt: isoOrNull(row.updatedAt) ?? iso(now),
  };
}

function nightSignalLeaseIsLive(checkpoint: NightSignalCheckpoint, now: number): boolean {
  if (!checkpoint.leaseOwner || !checkpoint.leaseExpiresAt) return false;
  const expires = Date.parse(checkpoint.leaseExpiresAt);
  // An unreadable expiry reads as EXPIRED. A lease nobody can date must not
  // block every later run for ever.
  return Number.isFinite(expires) && expires > now;
}

export type NightSignalLeaseClaim =
  | { ok: true; checkpoint: NightSignalCheckpoint }
  | { ok: false; heldBy: string; expiresAt: string };

export function claimNightSignalLease(
  checkpoint: NightSignalCheckpoint,
  options: { owner: string; now: number; leaseMs?: number },
): NightSignalLeaseClaim {
  if (nightSignalLeaseIsLive(checkpoint, options.now)) {
    return {
      ok: false,
      heldBy: checkpoint.leaseOwner ?? "unknown",
      expiresAt: checkpoint.leaseExpiresAt ?? "",
    };
  }
  const leaseMs = options.leaseMs ?? NIGHT_SIGNAL_LEASE_MS;
  return {
    ok: true,
    checkpoint: {
      ...checkpoint,
      leaseOwner: trimmed(options.owner, 120),
      leaseExpiresAt: iso(options.now + leaseMs),
      updatedAt: iso(options.now),
    },
  };
}

export function releaseNightSignalLease(
  checkpoint: NightSignalCheckpoint,
  options: { now: number; runRecord?: NightSignalRunRecord },
): NightSignalCheckpoint {
  return {
    ...checkpoint,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: iso(options.now),
    lastRun: options.runRecord ?? checkpoint.lastRun,
  };
}

function retryDue(entry: DeferredQuery, now: number): boolean {
  const due = Date.parse(entry.retryAfter);
  // An unreadable stamp reads as DUE: a retry we cannot date is owed sooner
  // rather than never, and the attempt cap still bounds what it can cost.
  return !Number.isFinite(due) || due <= now;
}

/**
 * The queries this run may ask, in the order it should ask them. Terminal
 * queries are refused, deferred ones wait out their backoff and are capped at
 * `RETRY_QUERY_BUDGET`, and every query the checkpoint has never recorded is
 * fresh coverage.
 */
export function dueNightSignalQueries(
  checkpoint: NightSignalCheckpoint,
  queries: readonly NightSignalQuery[],
  now: number,
  retryBudget = RETRY_QUERY_BUDGET,
): NightSignalQuery[] {
  const terminal = new Set(checkpoint.terminal.map((entry) => entry.key));
  const deferred = new Map(checkpoint.deferred.map((entry) => [entry.key, entry]));
  const fresh: NightSignalQuery[] = [];
  const retries: NightSignalQuery[] = [];
  for (const query of queries) {
    const key = nightSignalQueryKey(query);
    if (terminal.has(key)) continue;
    const owed = deferred.get(key);
    if (!owed) {
      fresh.push(query);
      continue;
    }
    if (retryDue(owed, now)) retries.push(query);
  }
  return [...retries.slice(0, Math.max(0, retryBudget)), ...fresh];
}

/** A query that answered is owed nothing: its deferred entry leaves. */
export function recordQuerySuccess(
  checkpoint: NightSignalCheckpoint,
  options: { query: NightSignalQuery; now: number },
): NightSignalCheckpoint {
  const key = nightSignalQueryKey(options.query);
  return {
    ...checkpoint,
    deferred: checkpoint.deferred.filter((entry) => entry.key !== key),
    updatedAt: iso(options.now),
  };
}

export type QueryFailureOutcome = {
  checkpoint: NightSignalCheckpoint;
  /** True once the attempt cap refused this query until a moderator requeues it. */
  terminal: boolean;
  attempts: number;
};

/**
 * A provider failure is RECORDED before the run decides what to do next, so a
 * query that ends a run is never a query nobody hears about again.
 */
export function recordQueryFailure(
  checkpoint: NightSignalCheckpoint,
  options: { query: NightSignalQuery; reason: string; now: number },
): QueryFailureOutcome {
  const key = nightSignalQueryKey(options.query);
  const previous = checkpoint.deferred.find((entry) => entry.key === key);
  const attempts = (previous?.attempts ?? 0) + 1;
  const reason = trimmed(options.reason, 240) || "unknown provider failure";
  const recordedAt = iso(options.now);
  if (attempts >= MAX_QUERY_ATTEMPTS) {
    const terminal = [
      ...checkpoint.terminal.filter((entry) => entry.key !== key),
      { key, attempts, reason, recordedAt },
    ].slice(-MAX_TERMINAL_QUERIES);
    return {
      checkpoint: {
        ...checkpoint,
        deferred: checkpoint.deferred.filter((entry) => entry.key !== key),
        terminal,
        updatedAt: recordedAt,
      },
      terminal: true,
      attempts,
    };
  }
  const backoff = QUERY_RETRY_BACKOFF_MS[Math.min(attempts - 1, QUERY_RETRY_BACKOFF_MS.length - 1)] ?? lastOf(QUERY_RETRY_BACKOFF_MS);
  const deferred = [
    ...checkpoint.deferred.filter((entry) => entry.key !== key),
    { key, attempts, retryAfter: iso(options.now + backoff), reason, recordedAt },
  ].slice(-MAX_DEFERRED_QUERIES);
  return {
    checkpoint: { ...checkpoint, deferred, updatedAt: recordedAt },
    terminal: false,
    attempts,
  };
}

/**
 * The way back from a terminal refusal, which is why the moderator door has a
 * POST at all. Named keys requeue those; no keys requeues every terminal one.
 */
export function requeueTerminalQueries(
  checkpoint: NightSignalCheckpoint,
  options: { now: number; keys?: readonly string[] },
): { checkpoint: NightSignalCheckpoint; requeued: number } {
  const wanted = options.keys && options.keys.length > 0 ? new Set(options.keys) : null;
  const kept = checkpoint.terminal.filter((entry) => (wanted ? !wanted.has(entry.key) : false));
  const requeued = checkpoint.terminal.length - kept.length;
  if (requeued === 0) return { checkpoint, requeued: 0 };
  return {
    checkpoint: { ...checkpoint, terminal: kept, updatedAt: iso(options.now) },
    requeued,
  };
}

/** Consecutive provider refusals that mean the provider, not the query. */
export function nightSignalProviderOutage(consecutiveFailures: number): boolean {
  return consecutiveFailures >= CONSECUTIVE_QUERY_FAILURE_LIMIT;
}

// --- Review ------------------------------------------------------------------

const NIGHT_SIGNAL_REVIEW_ACTIONS = ["approve", "reject"] as const;
export type NightSignalReviewAction = (typeof NIGHT_SIGNAL_REVIEW_ACTIONS)[number];

/**
 * Authorities a PERSON may review under. `automated` is deliberately absent:
 * the whole point of this door is that a human advanced the candidate, and a
 * route that let a caller name itself automated would erase that.
 */
const HUMAN_REVIEW_AUTHORITIES = ["operations", "editorial"] as const;
const DEFAULT_REVIEW_AUTHORITY: NightSignalReviewAuthority = "operations";

export function parseReviewAction(value: unknown): NightSignalReviewAction | null {
  return NIGHT_SIGNAL_REVIEW_ACTIONS.includes(value as NightSignalReviewAction)
    ? (value as NightSignalReviewAction)
    : null;
}

export function parseReviewAuthority(value: unknown): NightSignalReviewAuthority | null {
  if (value === undefined || value === null || value === "") return DEFAULT_REVIEW_AUTHORITY;
  return HUMAN_REVIEW_AUTHORITIES.includes(value as "operations" | "editorial")
    ? (value as NightSignalReviewAuthority)
    : null;
}

export type NightSignalReviewDecision =
  | {
      status: "decided";
      reviewState: Exclude<NightSignalReviewState, "pending">;
      reviewedAt: string;
      reviewAuthority: NightSignalReviewAuthority;
    }
  | {
      status: "already_decided";
      reviewState: NightSignalReviewState;
      reviewedAt: string | null;
      reviewAuthority: NightSignalReviewAuthority | null;
    }
  | { status: "expired"; expiresAt: string };

/**
 * What one review action does to one stored candidate. Pure, so the store, the
 * route and the tests cannot disagree about when a decision is refused.
 */
export function reviewCandidateDecision(
  candidate: Pick<NightSignalClaim, "reviewState" | "reviewedAt" | "reviewAuthority" | "expiresAt">,
  options: { action: NightSignalReviewAction; authority: NightSignalReviewAuthority; now: number },
): NightSignalReviewDecision {
  if (candidate.reviewState !== "pending") {
    return {
      status: "already_decided",
      reviewState: candidate.reviewState,
      reviewedAt: candidate.reviewedAt,
      reviewAuthority: candidate.reviewAuthority,
    };
  }
  const expires = Date.parse(candidate.expiresAt);
  if (options.action === "approve" && Number.isFinite(expires) && expires <= options.now) {
    // Approving it would publish nothing: `activeNightSignalClaims` filters an
    // expired claim out. Refusing says so instead of pretending it shipped.
    return { status: "expired", expiresAt: candidate.expiresAt };
  }
  return {
    status: "decided",
    reviewState: options.action === "approve" ? "approved" : "rejected",
    reviewedAt: iso(options.now),
    reviewAuthority: options.authority,
  };
}

/**
 * What a sweep may do to a candidate id the store already holds. INSERT IF
 * ABSENT is the whole rule: a candidate a person has decided, and a candidate
 * still waiting for one, are both left exactly as they are.
 */
export function nightSignalCandidateWriteLane(
  existing: Pick<NightSignalClaim, "reviewState"> | null,
): "insert" | "keep" {
  return existing === null ? "insert" : "keep";
}
