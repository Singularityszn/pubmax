import "server-only";

// Durable home for Night Signal candidates and for the sweep's own checkpoint.
//
// THE CANDIDATE TABLE ALREADY EXISTED: migration 0034 created
// `public.night_signal_claims` with every column a candidate needs - the three
// review states, the source, the corroborating evidence and the timestamps -
// plus the constraints that make an approved row answerable. Nothing had ever
// written to it. So this module is the writer that was missing, not a second
// shape for the same fact.
//
// THE CHECKPOINT IS NEW (migration 0146) and carries the sweep's lease,
// deferred queries and terminal refusals in the `city_enrichment_progress`
// idiom: the lease is claimed in ONE conditional UPDATE, and a commit is
// guarded on the lease we hold, so a run whose lease expired mid-flight cannot
// overwrite the run that took over.
//
// TWO reading rules the callers depend on. A read we could not RUN answers
// `unavailable` and never an empty queue, because an empty queue reads as "a
// person has nothing to review". And a durable row is validated back through
// `validateNightSignalClaim` before it leaves this module, so a row written
// around the app can never reach the feed unchecked.

import {
  admin,
  createFailSoftGuard,
  errorMessage,
  isMissingTableSchema,
  isUniqueViolation,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  validateNightSignalClaim,
  type NightSignalClaim,
  type NightSignalReviewAuthority,
  type NightSignalReviewState,
} from "@/lib/nightSignalClaims";
import {
  claimNightSignalLease,
  emptyNightSignalCheckpoint,
  MAX_REVIEW_PAGE,
  nightSignalCandidateWriteLane,
  normaliseNightSignalCheckpoint,
  reviewCandidateDecision,
  type NightSignalCheckpoint,
  type NightSignalReviewAction,
} from "@/lib/nightSignalReview";

const CANDIDATE_TABLE = "night_signal_claims";
const CHECKPOINT_TABLE = "night_signal_ingest_checkpoint";
const MIGRATION_HINT = "apply migrations 0034 and 0146";
const STORE_TAG = "night-signal-store";

const guard = createFailSoftGuard({
  tag: STORE_TAG,
  tables: [CANDIDATE_TABLE, CHECKPOINT_TABLE],
  migrationHint: MIGRATION_HINT,
});

const TABLES = [CANDIDATE_TABLE, CHECKPOINT_TABLE] as const;

// ---------------------------------------------------------------------------
// Row shapes.
// ---------------------------------------------------------------------------

type CandidateRow = {
  id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  claim: string;
  source_url: string;
  publisher: string;
  published_at: string;
  observed_at: string;
  expires_at: string;
  confidence: number;
  review_state: string;
  verification: string;
  route_effect: string;
  corroborating_sources: unknown;
  reviewed_at: string | null;
  review_authority: string | null;
};

function claimToRow(candidate: NightSignalClaim): CandidateRow {
  return {
    id: candidate.id,
    kind: candidate.kind,
    entity_type: candidate.entity.type,
    entity_id: candidate.entity.id,
    claim: candidate.claim,
    source_url: candidate.sourceUrl,
    publisher: candidate.publisher,
    published_at: candidate.publishedAt,
    observed_at: candidate.observedAt,
    expires_at: candidate.expiresAt,
    confidence: candidate.confidence,
    review_state: candidate.reviewState,
    verification: candidate.verification,
    route_effect: candidate.routeEffect,
    corroborating_sources: candidate.corroboratingSources,
    reviewed_at: candidate.reviewedAt,
    review_authority: candidate.reviewAuthority,
  };
}

/** A durable row is only a claim once the shipped validator says so. */
function rowToClaim(row: CandidateRow): NightSignalClaim | null {
  return validateNightSignalClaim({
    id: row.id,
    kind: row.kind,
    entity: { type: row.entity_type, id: row.entity_id },
    claim: row.claim,
    sourceUrl: row.source_url,
    publisher: row.publisher,
    publishedAt: row.published_at,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    confidence: row.confidence,
    reviewState: row.review_state,
    verification: row.verification,
    routeEffect: row.route_effect,
    corroboratingSources: row.corroborating_sources ?? [],
    reviewedAt: row.reviewed_at,
    reviewAuthority: row.review_authority,
  });
}

type CheckpointRow = {
  scope: string;
  version: number;
  deferred: unknown;
  terminal: unknown;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_run: unknown;
  updated_at: string;
};

function checkpointToRow(checkpoint: NightSignalCheckpoint): CheckpointRow {
  return {
    scope: checkpoint.scope,
    version: checkpoint.version,
    deferred: checkpoint.deferred,
    terminal: checkpoint.terminal,
    lease_owner: checkpoint.leaseOwner,
    lease_expires_at: checkpoint.leaseExpiresAt,
    last_run: checkpoint.lastRun,
    updated_at: checkpoint.updatedAt,
  };
}

function rowToCheckpoint(row: CheckpointRow, scope: string, now: number): NightSignalCheckpoint {
  return normaliseNightSignalCheckpoint(
    {
      version: row.version,
      scope: row.scope,
      deferred: row.deferred,
      terminal: row.terminal,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      lastRun: row.last_run,
      updatedAt: row.updated_at,
    },
    scope,
    now,
  );
}

// ---------------------------------------------------------------------------
// Public contracts.
// ---------------------------------------------------------------------------

/** What a sweep did to each candidate it offered the store. */
type CandidateSaveResult =
  | { status: "saved"; stored: string[]; kept: string[]; durable: boolean }
  /** A write we could not run. The sweep says so rather than claiming storage. */
  | { status: "unavailable"; reason: string };

type CandidateListResult =
  | { status: "ready"; candidates: NightSignalClaim[]; durable: boolean }
  | { status: "unavailable"; reason: string };

type CandidateReviewResult =
  | { status: "decided"; candidate: NightSignalClaim }
  | {
      status: "already_decided";
      reviewState: NightSignalReviewState;
      reviewedAt: string | null;
      reviewAuthority: NightSignalReviewAuthority | null;
    }
  | { status: "expired"; expiresAt: string }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

export type NightSignalCandidateStore = {
  save(candidates: readonly NightSignalClaim[]): Promise<CandidateSaveResult>;
  list(options: { state: NightSignalReviewState; limit?: number }): Promise<CandidateListResult>;
  /** Approved, in-window, already-reviewed rows - what the public feed may read. */
  approved(now: number): Promise<CandidateListResult>;
  review(
    id: string,
    options: { action: NightSignalReviewAction; authority: NightSignalReviewAuthority; now: number },
  ): Promise<CandidateReviewResult>;
};

type CheckpointClaim =
  | { status: "claimed"; checkpoint: NightSignalCheckpoint; durable: boolean }
  | { status: "lease-held"; heldBy: string; expiresAt: string }
  /** A read we could not run. It costs a sweep, never a wrong write. */
  | { status: "unavailable"; reason: string };

type CheckpointCommit =
  | { status: "committed"; durable: boolean }
  | { status: "lease-lost" }
  | { status: "unavailable"; reason: string };

export type NightSignalCheckpointStore = {
  read(scope: string, now: number): Promise<NightSignalCheckpoint | null>;
  claim(input: {
    scope: string;
    owner: string;
    now: number;
    leaseMs?: number;
  }): Promise<CheckpointClaim>;
  commit(checkpoint: NightSignalCheckpoint, owner: string): Promise<CheckpointCommit>;
  /** Owner-free write for the moderator requeue path, which holds no lease. */
  save(checkpoint: NightSignalCheckpoint): Promise<CheckpointCommit>;
};

function boundedLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return MAX_REVIEW_PAGE;
  return Math.min(Math.trunc(limit), MAX_REVIEW_PAGE);
}

/** The public feed's own window, in one place, so both backends agree. */
function isLiveApproved(candidate: NightSignalClaim, now: number): boolean {
  return (
    candidate.reviewState === "approved" &&
    Date.parse(candidate.expiresAt) > now &&
    Date.parse(candidate.observedAt) <= now &&
    Boolean(candidate.reviewedAt && Date.parse(candidate.reviewedAt) <= now)
  );
}

function newestFirst(a: NightSignalClaim, b: NightSignalClaim): number {
  return Date.parse(b.observedAt) - Date.parse(a.observedAt);
}

// ---------------------------------------------------------------------------
// Memory backend: keyless development, the e2e server and the test runner.
// ---------------------------------------------------------------------------

const memoryCandidates = new Map<string, NightSignalClaim>();
const memoryCheckpoints = new Map<string, NightSignalCheckpoint>();

/** Test-only: both maps outlive a case otherwise. */
export function resetNightSignalStoreMemory(): void {
  memoryCandidates.clear();
  memoryCheckpoints.clear();
  guard.resetWarnings();
}

const memoryCandidateStore: NightSignalCandidateStore = {
  async save(candidates) {
    const stored: string[] = [];
    const kept: string[] = [];
    for (const candidate of candidates) {
      const existing = memoryCandidates.get(candidate.id) ?? null;
      if (nightSignalCandidateWriteLane(existing) === "insert") {
        memoryCandidates.set(candidate.id, candidate);
        stored.push(candidate.id);
      } else {
        kept.push(candidate.id);
      }
    }
    return { status: "saved", stored, kept, durable: false };
  },

  async list({ state, limit }) {
    const candidates = [...memoryCandidates.values()]
      .filter((candidate) => candidate.reviewState === state)
      .sort(newestFirst)
      .slice(0, boundedLimit(limit));
    return { status: "ready", candidates, durable: false };
  },

  async approved(now) {
    const candidates = [...memoryCandidates.values()]
      .filter((candidate) => isLiveApproved(candidate, now))
      .sort(newestFirst);
    return { status: "ready", candidates, durable: false };
  },

  async review(id, { action, authority, now }) {
    const existing = memoryCandidates.get(id);
    if (!existing) return { status: "not_found" };
    const decision = reviewCandidateDecision(existing, { action, authority, now });
    if (decision.status !== "decided") return decision;
    const reviewed: NightSignalClaim = {
      ...existing,
      reviewState: decision.reviewState,
      reviewedAt: decision.reviewedAt,
      reviewAuthority: decision.reviewAuthority,
    };
    memoryCandidates.set(id, reviewed);
    return { status: "decided", candidate: reviewed };
  },
};

const memoryCheckpointStore: NightSignalCheckpointStore = {
  async read(scope, now) {
    const held = memoryCheckpoints.get(scope);
    return held ? normaliseNightSignalCheckpoint(held, scope, now) : null;
  },

  async claim({ scope, owner, now, leaseMs }) {
    const held = memoryCheckpoints.get(scope);
    const current = held
      ? normaliseNightSignalCheckpoint(held, scope, now)
      : emptyNightSignalCheckpoint(scope, now);
    const claimed = claimNightSignalLease(current, { owner, now, leaseMs });
    if (!claimed.ok) {
      return { status: "lease-held", heldBy: claimed.heldBy, expiresAt: claimed.expiresAt };
    }
    memoryCheckpoints.set(scope, claimed.checkpoint);
    return { status: "claimed", checkpoint: claimed.checkpoint, durable: false };
  },

  async commit(checkpoint, owner) {
    const held = memoryCheckpoints.get(checkpoint.scope);
    // Mirror the durable guard exactly: a run that lost its lease writes nothing.
    if (held && held.leaseOwner !== null && held.leaseOwner !== owner) {
      return { status: "lease-lost" };
    }
    memoryCheckpoints.set(checkpoint.scope, checkpoint);
    return { status: "committed", durable: false };
  },

  async save(checkpoint) {
    memoryCheckpoints.set(checkpoint.scope, checkpoint);
    return { status: "committed", durable: false };
  },
};

// ---------------------------------------------------------------------------
// Supabase backend.
// ---------------------------------------------------------------------------

const supabaseCandidateStore: NightSignalCandidateStore = {
  async save(candidates) {
    if (candidates.length === 0) {
      return { status: "saved", stored: [], kept: [], durable: true };
    }
    try {
      // INSERT IF ABSENT. `ignoreDuplicates` issues ON CONFLICT DO NOTHING, so
      // the rows that come back are exactly the ones this sweep created and a
      // decided candidate is never restored to pending.
      const { data, error } = await admin()
        .from(CANDIDATE_TABLE)
        .upsert(candidates.map(claimToRow), { onConflict: "id", ignoreDuplicates: true })
        .select("id");
      if (error && !isUniqueViolation(error)) throw new Error(error.message);
      const stored = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
      const storedSet = new Set(stored);
      const kept = candidates.map((row) => row.id).filter((id) => !storedSet.has(id));
      return { status: "saved", stored, kept, durable: true };
    } catch (err) {
      if (isMissingTableSchema(err, TABLES)) {
        guard.warn("save", err);
        return onMissingDurableWrite<CandidateSaveResult>({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryCandidateStore.save(candidates),
          onProduction: async (error) => ({ status: "unavailable", reason: error.message }),
        });
      }
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },

  async list({ state, limit }) {
    try {
      const { data, error } = await admin()
        .from(CANDIDATE_TABLE)
        .select("*")
        .eq("review_state", state)
        .order("observed_at", { ascending: false })
        .limit(boundedLimit(limit));
      if (error) throw new Error(error.message);
      const candidates = ((data ?? []) as CandidateRow[])
        .map(rowToClaim)
        .filter((candidate): candidate is NightSignalClaim => candidate !== null);
      return { status: "ready", candidates, durable: true };
    } catch (err) {
      if (isMissingTableSchema(err, TABLES)) {
        guard.warn("list", err);
        return memoryCandidateStore.list({ state, limit });
      }
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },

  async approved(now) {
    try {
      const nowIso = new Date(now).toISOString();
      const { data, error } = await admin()
        .from(CANDIDATE_TABLE)
        .select("*")
        .eq("review_state", "approved")
        .gt("expires_at", nowIso)
        .lte("observed_at", nowIso)
        .order("observed_at", { ascending: false })
        .limit(MAX_REVIEW_PAGE);
      if (error) throw new Error(error.message);
      const candidates = ((data ?? []) as CandidateRow[])
        .map(rowToClaim)
        .filter((candidate): candidate is NightSignalClaim => candidate !== null)
        .filter((candidate) => isLiveApproved(candidate, now));
      return { status: "ready", candidates, durable: true };
    } catch (err) {
      if (isMissingTableSchema(err, TABLES)) {
        guard.warn("approved", err);
        return memoryCandidateStore.approved(now);
      }
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },

  async review(id, { action, authority, now }) {
    try {
      const client = admin();
      const held = await client.from(CANDIDATE_TABLE).select("*").eq("id", id).maybeSingle();
      if (held.error) throw new Error(held.error.message);
      if (!held.data) return { status: "not_found" };
      const candidate = rowToClaim(held.data as CandidateRow);
      if (!candidate) return { status: "not_found" };

      const decision = reviewCandidateDecision(candidate, { action, authority, now });
      if (decision.status !== "decided") return decision;

      // ONE conditional UPDATE: `review_state = pending` is the guard, so two
      // moderators deciding at once produce one decision and one honest
      // already_decided rather than a silent overwrite.
      const { data, error } = await client
        .from(CANDIDATE_TABLE)
        .update({
          review_state: decision.reviewState,
          reviewed_at: decision.reviewedAt,
          review_authority: decision.reviewAuthority,
        })
        .eq("id", id)
        .eq("review_state", "pending")
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        const current = await client.from(CANDIDATE_TABLE).select("*").eq("id", id).maybeSingle();
        const standing = current.data ? rowToClaim(current.data as CandidateRow) : null;
        if (!standing) return { status: "not_found" };
        return {
          status: "already_decided",
          reviewState: standing.reviewState,
          reviewedAt: standing.reviewedAt,
          reviewAuthority: standing.reviewAuthority,
        };
      }
      const reviewed = rowToClaim(data as CandidateRow);
      if (!reviewed) {
        return { status: "unavailable", reason: "The stored review did not read back." };
      }
      return { status: "decided", candidate: reviewed };
    } catch (err) {
      if (isMissingTableSchema(err, TABLES)) {
        guard.warn("review", err);
        return onMissingDurableWrite<CandidateReviewResult>({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryCandidateStore.review(id, { action, authority, now }),
          onProduction: async (error) => ({ status: "unavailable", reason: error.message }),
        });
      }
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },
};

const supabaseCheckpointStore: NightSignalCheckpointStore = {
  async read(scope, now) {
    return guard.guard<NightSignalCheckpoint | null>({
      context: "checkpoint-read",
      onSchemaMiss: () => memoryCheckpointStore.read(scope, now),
      onError: () => null,
      message: `checkpoint read failed for ${scope}`,
      run: async () => {
        const { data, error } = await admin()
          .from(CHECKPOINT_TABLE)
          .select("*")
          .eq("scope", scope)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? rowToCheckpoint(data as CheckpointRow, scope, now) : null;
      },
    });
  },

  async claim({ scope, owner, now, leaseMs }) {
    try {
      const client = admin();
      const empty = emptyNightSignalCheckpoint(scope, now);
      // Make sure the row exists without disturbing a live one: an insert that
      // conflicts is the ordinary case on every sweep but the first.
      const insert = await client
        .from(CHECKPOINT_TABLE)
        .upsert(checkpointToRow(empty), { onConflict: "scope", ignoreDuplicates: true });
      if (insert.error && !isUniqueViolation(insert.error)) throw new Error(insert.error.message);

      const claimed = claimNightSignalLease(empty, { owner, now, leaseMs });
      if (!claimed.ok) {
        return { status: "lease-held", heldBy: claimed.heldBy, expiresAt: claimed.expiresAt };
      }

      const nowIso = new Date(now).toISOString();
      // ONE conditional UPDATE. Two schedulers firing together both send this
      // and exactly one row comes back, because the second no longer matches.
      const { data, error } = await client
        .from(CHECKPOINT_TABLE)
        .update({
          lease_owner: owner,
          lease_expires_at: claimed.checkpoint.leaseExpiresAt,
          updated_at: nowIso,
        })
        .eq("scope", scope)
        .or(`lease_owner.is.null,lease_expires_at.lt.${nowIso}`)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        const current = await supabaseCheckpointStore.read(scope, now);
        return {
          status: "lease-held",
          heldBy: current?.leaseOwner ?? "unknown",
          expiresAt: current?.leaseExpiresAt ?? "",
        };
      }
      return {
        status: "claimed",
        checkpoint: rowToCheckpoint(data as CheckpointRow, scope, now),
        durable: true,
      };
    } catch (err) {
      if (isMissingTableSchema(err, TABLES)) {
        guard.warn("checkpoint-claim", err);
        return memoryCheckpointStore.claim({ scope, owner, now, leaseMs });
      }
      // A read we could not run is not permission to sweep unbudgeted.
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },

  async commit(checkpoint, owner) {
    try {
      const { data, error } = await admin()
        .from(CHECKPOINT_TABLE)
        .update(checkpointToRow(checkpoint))
        .eq("scope", checkpoint.scope)
        .eq("lease_owner", owner)
        .select("scope")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { status: "lease-lost" };
      return { status: "committed", durable: true };
    } catch (err) {
      if (isMissingTableSchema(err, TABLES)) {
        guard.warn("checkpoint-commit", err);
        return memoryCheckpointStore.commit(checkpoint, owner);
      }
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },

  async save(checkpoint) {
    try {
      const { error } = await admin()
        .from(CHECKPOINT_TABLE)
        .upsert(checkpointToRow(checkpoint), { onConflict: "scope" });
      if (error) throw new Error(error.message);
      return { status: "committed", durable: true };
    } catch (err) {
      if (isMissingTableSchema(err, TABLES)) {
        guard.warn("checkpoint-save", err);
        return memoryCheckpointStore.save(checkpoint);
      }
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },
};

export function nightSignalCandidateStore(): NightSignalCandidateStore {
  return selectStore(memoryCandidateStore, supabaseCandidateStore);
}

export function nightSignalCheckpointStore(): NightSignalCheckpointStore {
  return selectStore(memoryCheckpointStore, supabaseCheckpointStore);
}

/** Whether this deployment holds candidates past the life of one invocation. */
export function nightSignalStoreIsDurable(): boolean {
  return isSupabaseConfigured();
}
