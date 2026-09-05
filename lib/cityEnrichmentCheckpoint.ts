// City enrichment checkpoint - the policy that makes the nightly enrichment
// cron safe to fail and safe to retry.
//
// WHAT WENT WRONG (production, 2026-09-05 03:15:13): one Exa search timed out
// after 12,000 ms during Birmingham enrichment, the whole batch threw, and the
// run answered 502 having spent one query. The progress record named
// `nextIndex 102`, which was the index of the venue that had just FAILED, not
// an advancement past it. Nothing read that number back: the start index was a
// pure function of the calendar day, so the failed venue was neither retried
// nor recorded, and the nine unspent queries of that night's budget were lost.
//
// THE RULE THIS MODULE OWNS: the cursor is an ADVANCEMENT and it only ever
// advances past a venue whose outcome was RECORDED. A venue whose search
// failed is recorded too, in `deferred`, keyed by its OSM id and owed a retry
// with bounded backoff. So the cursor never stalls on one bad pub, and no pub
// is ever passed over in silence.
//
// This module is a pure leaf. It imports nothing, so the admin surface, the
// store and the tests all read one copy of these rules.

/** Bumped when a stored shape stops being readable by this policy. */
export const CITY_ENRICHMENT_CHECKPOINT_VERSION = 1;

/**
 * Queries one venue may ever cost. Three attempts, then terminal: a pub whose
 * site answers nothing twice is evidence about that site, and a fourth attempt
 * spends budget that a pub nobody has looked at would use better.
 */
export const MAX_VENUE_ATTEMPTS = 3;

/**
 * Backoff before a deferred venue may be attempted again, by attempts already
 * made. A cron runs nightly, so the first two steps let a same-night manual
 * re-run pick the venue up while the last one holds it back a full day.
 */
export const VENUE_RETRY_BACKOFF_MS = [30 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000] as const;

/**
 * Queries of one run's cap that retries may take. A poisoned set of deferred
 * venues can therefore never starve fresh coverage: at most four of ten.
 */
export const RETRY_QUERY_BUDGET = 4;

/**
 * Venues in a row a provider may refuse before the run stops asking. An outage
 * is one fact about the provider, not ten facts about ten pubs, and burning an
 * attempt on every pub it touches is how a bad night becomes terminal refusals
 * for pubs nobody ever really read.
 */
export const CONSECUTIVE_VENUE_FAILURE_LIMIT = 3;

/** Bounded lists. Operational state is not an archive, and a row has a size. */
export const MAX_DEFERRED_VENUES = 50;
export const MAX_TERMINAL_VENUES = 50;

/**
 * Is this failure about US rather than about the venue we asked after?
 *
 * An exhausted gateway budget or absent credentials mean the question was
 * never put, so it may not spend the venue's attempts. Everything else - a
 * timeout, a gateway 5xx, malformed output - is a venue we asked about and
 * could not read, which is exactly what a bounded retry is for.
 */
export function runLevelFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; name?: unknown };
  if (record.name === "AbortError") return true;
  return (
    record.code === "SEARCH_GATEWAY_BUDGET_EXHAUSTED" ||
    record.code === "SEARCH_PROVIDER_NOT_CONFIGURED"
  );
}

/**
 * A lease outlives the function that holds it (`maxDuration` is 120 s), so a
 * run killed mid-batch blocks nothing for long, and two schedulers firing at
 * once cannot both spend the night's budget.
 */
export const CITY_ENRICHMENT_LEASE_MS = 150_000;

export type DeferredVenue = {
  /** OSM id, because an index names a different pub after every pack rebuild. */
  osmId: string;
  attempts: number;
  lastError: string;
  firstFailedAt: string;
  retryAfter: string;
};

export type TerminalVenue = {
  osmId: string;
  attempts: number;
  lastError: string;
  failedAt: string;
};

export type CityEnrichmentRunOutcome = "ok" | "partial" | "failed" | "lease-held";

export type CityEnrichmentRunRecord = {
  runId: string;
  startedAt: string;
  endedAt: string;
  outcome: CityEnrichmentRunOutcome;
  attempted: number;
  succeeded: number;
  failed: number;
  deferredNow: number;
  terminalNow: number;
  queriesSpent: number;
  creditsSpent: number;
  matchedPubs: number;
  pricesExtracted: number;
  error?: string;
};

export type CityEnrichmentCheckpoint = {
  version: number;
  city: string;
  totalPubs: number;
  /** First index this city has not resolved yet. Monotonic inside one pass. */
  nextIndex: number;
  /** Completed sweeps of the city. The cursor wraps rather than sticking. */
  passes: number;
  deferred: DeferredVenue[];
  terminal: TerminalVenue[];
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
  lastRun: CityEnrichmentRunRecord | null;
};

function iso(now: number): string {
  return new Date(now).toISOString();
}

function boundedList<T>(items: T[], cap: number): T[] {
  // Keep the NEWEST entries: an operator reading this row is answering about
  // tonight, and an unbounded list is a row that eventually refuses to store.
  return items.length <= cap ? items : items.slice(items.length - cap);
}

export function emptyCityEnrichmentCheckpoint(
  city: string,
  totalPubs: number,
  now: number,
): CityEnrichmentCheckpoint {
  return {
    version: CITY_ENRICHMENT_CHECKPOINT_VERSION,
    city,
    totalPubs,
    nextIndex: 0,
    passes: 0,
    deferred: [],
    terminal: [],
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: iso(now),
    lastRun: null,
  };
}

/**
 * A stored row is data we did not write this run. Read it defensively: a shape
 * we cannot understand starts the city again rather than pointing the cursor
 * at a pub nobody chose.
 */
export function normaliseCheckpoint(
  raw: unknown,
  city: string,
  totalPubs: number,
  now: number,
): CityEnrichmentCheckpoint {
  const empty = emptyCityEnrichmentCheckpoint(city, totalPubs, now);
  if (typeof raw !== "object" || raw === null) return empty;
  const record = raw as Record<string, unknown>;
  if (record.version !== CITY_ENRICHMENT_CHECKPOINT_VERSION) return empty;

  const storedIndex = Number(record.nextIndex);
  // The pack decides what an index means. A cursor past the end of a rebuilt
  // pack is not a pub, so it wraps rather than reading as "city complete".
  const nextIndex =
    Number.isFinite(storedIndex) && storedIndex >= 0 && storedIndex < Math.max(totalPubs, 1)
      ? Math.floor(storedIndex)
      : 0;
  const passes = Number.isFinite(Number(record.passes)) ? Math.max(0, Math.floor(Number(record.passes))) : 0;

  return {
    ...empty,
    nextIndex,
    passes,
    deferred: parseDeferred(record.deferred),
    terminal: parseTerminal(record.terminal),
    leaseOwner: typeof record.leaseOwner === "string" ? record.leaseOwner : null,
    leaseExpiresAt: typeof record.leaseExpiresAt === "string" ? record.leaseExpiresAt : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : empty.updatedAt,
    lastRun: parseRunRecord(record.lastRun),
  };
}

function parseDeferred(value: unknown): DeferredVenue[] {
  if (!Array.isArray(value)) return [];
  return boundedList(
    value.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const row = entry as Record<string, unknown>;
      const osmId = typeof row.osmId === "string" ? row.osmId : "";
      if (!osmId) return [];
      return [{
        osmId,
        attempts: Math.max(1, Math.floor(Number(row.attempts) || 1)),
        lastError: typeof row.lastError === "string" ? row.lastError : "unknown",
        firstFailedAt: typeof row.firstFailedAt === "string" ? row.firstFailedAt : "",
        retryAfter: typeof row.retryAfter === "string" ? row.retryAfter : "",
      }];
    }),
    MAX_DEFERRED_VENUES,
  );
}

function parseTerminal(value: unknown): TerminalVenue[] {
  if (!Array.isArray(value)) return [];
  return boundedList(
    value.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const row = entry as Record<string, unknown>;
      const osmId = typeof row.osmId === "string" ? row.osmId : "";
      if (!osmId) return [];
      return [{
        osmId,
        attempts: Math.max(1, Math.floor(Number(row.attempts) || 1)),
        lastError: typeof row.lastError === "string" ? row.lastError : "unknown",
        failedAt: typeof row.failedAt === "string" ? row.failedAt : "",
      }];
    }),
    MAX_TERMINAL_VENUES,
  );
}

function parseRunRecord(value: unknown): CityEnrichmentRunRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.runId !== "string") return null;
  return row as unknown as CityEnrichmentRunRecord;
}

export function leaseIsLive(checkpoint: CityEnrichmentCheckpoint, now: number): boolean {
  if (!checkpoint.leaseOwner || !checkpoint.leaseExpiresAt) return false;
  const expiry = Date.parse(checkpoint.leaseExpiresAt);
  // A lease whose expiry we cannot read is treated as EXPIRED. A stamp nobody
  // can parse must never be able to block the city for good.
  if (!Number.isFinite(expiry)) return false;
  return expiry > now;
}

export type LeaseClaim =
  | { ok: true; checkpoint: CityEnrichmentCheckpoint }
  | { ok: false; heldBy: string; expiresAt: string };

export function claimEnrichmentLease(
  checkpoint: CityEnrichmentCheckpoint,
  options: { owner: string; now: number; leaseMs?: number },
): LeaseClaim {
  if (leaseIsLive(checkpoint, options.now)) {
    return {
      ok: false,
      heldBy: checkpoint.leaseOwner ?? "unknown",
      expiresAt: checkpoint.leaseExpiresAt ?? "",
    };
  }
  const leaseMs = options.leaseMs ?? CITY_ENRICHMENT_LEASE_MS;
  return {
    ok: true,
    checkpoint: {
      ...checkpoint,
      leaseOwner: options.owner,
      leaseExpiresAt: iso(options.now + leaseMs),
      updatedAt: iso(options.now),
    },
  };
}

export function releaseEnrichmentLease(
  checkpoint: CityEnrichmentCheckpoint,
  options: { now: number; runRecord?: CityEnrichmentRunRecord },
): CityEnrichmentCheckpoint {
  return {
    ...checkpoint,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: iso(options.now),
    lastRun: options.runRecord ?? checkpoint.lastRun,
  };
}

export function venueRetryDue(entry: DeferredVenue, now: number): boolean {
  const due = Date.parse(entry.retryAfter);
  // An unreadable stamp reads as DUE. A retry we cannot date is owed sooner
  // rather than never, and the attempt cap still bounds what it can cost.
  return !Number.isFinite(due) || due <= now;
}

export function backoffMsForAttempts(attempts: number): number {
  const step = Math.min(Math.max(attempts, 1), VENUE_RETRY_BACKOFF_MS.length) - 1;
  return VENUE_RETRY_BACKOFF_MS[step];
}

export type EnrichmentPlan = {
  /** Due deferred venues, oldest failure first, inside the retry budget. */
  retryOsmIds: string[];
  /** Where fresh coverage resumes. */
  startIndex: number;
  /** Queries left for fresh coverage once retries have taken their share. */
  freshBudget: number;
  /** Deferred venues held back by backoff, reported so a run is inspectable. */
  waitingRetries: number;
};

export function planCityEnrichment(
  checkpoint: CityEnrichmentCheckpoint,
  options: { now: number; queryBudget: number; retryBudget?: number },
): EnrichmentPlan {
  const queryBudget = Math.max(0, Math.floor(options.queryBudget));
  const retryBudget = Math.min(
    queryBudget,
    Math.max(0, Math.floor(options.retryBudget ?? RETRY_QUERY_BUDGET)),
  );
  const due = checkpoint.deferred
    .filter((entry) => venueRetryDue(entry, options.now))
    .slice()
    .sort((a, b) => Date.parse(a.firstFailedAt || "0") - Date.parse(b.firstFailedAt || "0"));
  const retryOsmIds = due.slice(0, retryBudget).map((entry) => entry.osmId);
  return {
    retryOsmIds,
    startIndex: checkpoint.nextIndex,
    freshBudget: Math.max(0, queryBudget - retryOsmIds.length),
    waitingRetries: checkpoint.deferred.length - due.length,
  };
}

function withoutOsmId<T extends { osmId: string }>(items: T[], osmId: string): T[] {
  return items.filter((entry) => entry.osmId !== osmId);
}

/**
 * A venue that answered. Its deferred entry leaves with the answer, because a
 * pub that has just been read is not owed a retry.
 */
export function recordVenueSuccess(
  checkpoint: CityEnrichmentCheckpoint,
  options: { osmId: string; now: number },
): CityEnrichmentCheckpoint {
  return {
    ...checkpoint,
    deferred: withoutOsmId(checkpoint.deferred, options.osmId),
    updatedAt: iso(options.now),
  };
}

export type VenueFailureRecord = {
  checkpoint: CityEnrichmentCheckpoint;
  outcome: "deferred" | "terminal";
  attempts: number;
};

/**
 * A venue whose search failed. It is DEFERRED with backoff until it has spent
 * `MAX_VENUE_ATTEMPTS`, then TERMINAL, which is a recorded refusal rather than
 * a disappearance: `requeueTerminalVenues` is the way back.
 */
export function recordVenueFailure(
  checkpoint: CityEnrichmentCheckpoint,
  options: { osmId: string; error: string; now: number },
): VenueFailureRecord {
  const existing = checkpoint.deferred.find((entry) => entry.osmId === options.osmId);
  const attempts = (existing?.attempts ?? 0) + 1;
  const firstFailedAt = existing?.firstFailedAt || iso(options.now);
  const rest = withoutOsmId(checkpoint.deferred, options.osmId);

  if (attempts >= MAX_VENUE_ATTEMPTS) {
    return {
      outcome: "terminal",
      attempts,
      checkpoint: {
        ...checkpoint,
        deferred: rest,
        terminal: boundedList(
          [
            ...withoutOsmId(checkpoint.terminal, options.osmId),
            { osmId: options.osmId, attempts, lastError: options.error, failedAt: iso(options.now) },
          ],
          MAX_TERMINAL_VENUES,
        ),
        updatedAt: iso(options.now),
      },
    };
  }

  return {
    outcome: "deferred",
    attempts,
    checkpoint: {
      ...checkpoint,
      deferred: boundedList(
        [
          ...rest,
          {
            osmId: options.osmId,
            attempts,
            lastError: options.error,
            firstFailedAt,
            retryAfter: iso(options.now + backoffMsForAttempts(attempts)),
          },
        ],
        MAX_DEFERRED_VENUES,
      ),
      updatedAt: iso(options.now),
    },
  };
}

/**
 * Move the cursor to where fresh coverage stopped. It never goes backwards
 * inside a pass, so a failed run can only ever leave the city further along
 * than it found it, and it wraps rather than reading as "nothing left to do".
 */
export function advanceCursor(
  checkpoint: CityEnrichmentCheckpoint,
  options: { nextIndex: number; totalPubs: number; now: number },
): CityEnrichmentCheckpoint {
  const totalPubs = Math.max(0, Math.floor(options.totalPubs));
  const proposed = Math.max(0, Math.floor(options.nextIndex));
  if (totalPubs === 0) {
    return { ...checkpoint, totalPubs, nextIndex: 0, updatedAt: iso(options.now) };
  }
  const forward = Math.max(checkpoint.nextIndex, proposed);
  const wrapped = forward >= totalPubs;
  return {
    ...checkpoint,
    totalPubs,
    nextIndex: wrapped ? 0 : forward,
    passes: wrapped ? checkpoint.passes + 1 : checkpoint.passes,
    updatedAt: iso(options.now),
  };
}

/**
 * The retry path a terminal failure is recorded with. An operator asks for one
 * venue by OSM id, or for all of them, and each returns to the deferred list
 * due immediately with its attempt count reset.
 */
export function requeueTerminalVenues(
  checkpoint: CityEnrichmentCheckpoint,
  options: { now: number; osmIds?: string[] },
): { checkpoint: CityEnrichmentCheckpoint; requeued: string[] } {
  const wanted = options.osmIds?.length ? new Set(options.osmIds) : null;
  const moving = checkpoint.terminal.filter((entry) => !wanted || wanted.has(entry.osmId));
  if (moving.length === 0) return { checkpoint, requeued: [] };
  const movingIds = new Set(moving.map((entry) => entry.osmId));
  return {
    requeued: moving.map((entry) => entry.osmId),
    checkpoint: {
      ...checkpoint,
      terminal: checkpoint.terminal.filter((entry) => !movingIds.has(entry.osmId)),
      deferred: boundedList(
        [
          ...checkpoint.deferred.filter((entry) => !movingIds.has(entry.osmId)),
          ...moving.map((entry) => ({
            osmId: entry.osmId,
            attempts: 0,
            lastError: entry.lastError,
            firstFailedAt: iso(options.now),
            retryAfter: iso(options.now),
          })),
        ],
        MAX_DEFERRED_VENUES,
      ),
      updatedAt: iso(options.now),
    },
  };
}

export type CityEnrichmentHealth = {
  city: string;
  totalPubs: number;
  nextIndex: number;
  passes: number;
  coverage: number;
  deferred: number;
  deferredDue: number;
  terminal: number;
  leaseHeld: boolean;
  leaseExpiresAt: string | null;
  updatedAt: string;
  lastRun: CityEnrichmentRunRecord | null;
  venuesOwedARetry: DeferredVenue[];
  venuesRefused: TerminalVenue[];
};

/** What the moderator surface prints. A projection, deciding nothing new. */
export function cityEnrichmentHealth(
  checkpoint: CityEnrichmentCheckpoint,
  now: number,
): CityEnrichmentHealth {
  return {
    city: checkpoint.city,
    totalPubs: checkpoint.totalPubs,
    nextIndex: checkpoint.nextIndex,
    passes: checkpoint.passes,
    coverage: checkpoint.totalPubs > 0 ? checkpoint.nextIndex / checkpoint.totalPubs : 0,
    deferred: checkpoint.deferred.length,
    deferredDue: checkpoint.deferred.filter((entry) => venueRetryDue(entry, now)).length,
    terminal: checkpoint.terminal.length,
    leaseHeld: leaseIsLive(checkpoint, now),
    leaseExpiresAt: checkpoint.leaseExpiresAt,
    updatedAt: checkpoint.updatedAt,
    lastRun: checkpoint.lastRun,
    venuesOwedARetry: checkpoint.deferred,
    venuesRefused: checkpoint.terminal,
  };
}
