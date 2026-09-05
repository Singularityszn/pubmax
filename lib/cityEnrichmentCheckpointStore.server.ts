import "server-only";

// Durable home for the city enrichment checkpoint (migration 0142).
//
// A Vercel function's filesystem is read-only, so the `.data/` checkpoint the
// local CLI keeps cannot exist here. Without one, the nightly cron derived its
// start index from the calendar day, which is how a failed venue came to be
// neither retried nor recorded.
//
// TWO rules this module owns, and `lib/cityEnrichmentCheckpoint.ts` owns the
// rest:
//
// 1. THE LEASE IS CLAIMED IN ONE WRITE. A read-then-write claim is two runs
//    both deciding they may spend the night's budget. The claim is a single
//    conditional UPDATE that matches only a row with no lease or an expired
//    one, so the loser gets no row back and spends nothing.
// 2. A COMMIT IS GUARDED ON THE LEASE WE HOLD. A run whose lease expired
//    mid-flight may not overwrite the state of the run that took over, so the
//    commit carries `lease_owner = ours` and a commit that matches nothing is
//    reported rather than retried. That is what makes a previous run's valid
//    progress survive a later failed one.

import {
  admin,
  createFailSoftGuard,
  errorMessage,
  isMissingTableSchema,
  isUniqueViolation,
  selectStore,
} from "@/lib/storeBackend";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  CITY_ENRICHMENT_CHECKPOINT_VERSION,
  claimEnrichmentLease,
  emptyCityEnrichmentCheckpoint,
  normaliseCheckpoint,
  type CityEnrichmentCheckpoint,
} from "@/lib/cityEnrichmentCheckpoint";

const TABLE = "city_enrichment_progress";
const MIGRATION_HINT = "apply migration 0142";
const STORE_TAG = "city-enrichment-checkpoint";

const guard = createFailSoftGuard({
  tag: STORE_TAG,
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

export type CheckpointClaim =
  | { status: "claimed"; checkpoint: CityEnrichmentCheckpoint; durable: boolean }
  | { status: "lease-held"; heldBy: string; expiresAt: string }
  /** A read we could not run. It costs a night of enrichment, never a wrong write. */
  | { status: "unavailable"; reason: string };

export type CheckpointCommit =
  | { status: "committed"; durable: boolean }
  | { status: "lease-lost" }
  | { status: "unavailable"; reason: string };

export type CityEnrichmentCheckpointStore = {
  read(city: string, totalPubs: number, now: number): Promise<CityEnrichmentCheckpoint | null>;
  claim(input: {
    city: string;
    totalPubs: number;
    owner: string;
    now: number;
    leaseMs?: number;
  }): Promise<CheckpointClaim>;
  commit(checkpoint: CityEnrichmentCheckpoint, owner: string): Promise<CheckpointCommit>;
  /** Owner-free write for the moderator requeue path, which holds no lease. */
  save(checkpoint: CityEnrichmentCheckpoint): Promise<CheckpointCommit>;
};

type Row = {
  city: string;
  version: number;
  total_pubs: number;
  next_index: number;
  passes: number;
  deferred: unknown;
  terminal: unknown;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_run: unknown;
  updated_at: string;
};

function rowToCheckpoint(
  row: Row,
  city: string,
  totalPubs: number,
  now: number,
): CityEnrichmentCheckpoint {
  return normaliseCheckpoint(
    {
      version: row.version,
      nextIndex: row.next_index,
      passes: row.passes,
      deferred: row.deferred,
      terminal: row.terminal,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      updatedAt: row.updated_at,
      lastRun: row.last_run,
    },
    city,
    totalPubs,
    now,
  );
}

function checkpointToRow(checkpoint: CityEnrichmentCheckpoint): Row {
  return {
    city: checkpoint.city,
    version: CITY_ENRICHMENT_CHECKPOINT_VERSION,
    total_pubs: checkpoint.totalPubs,
    next_index: checkpoint.nextIndex,
    passes: checkpoint.passes,
    deferred: checkpoint.deferred,
    terminal: checkpoint.terminal,
    lease_owner: checkpoint.leaseOwner,
    lease_expires_at: checkpoint.leaseExpiresAt,
    last_run: checkpoint.lastRun,
    updated_at: checkpoint.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Memory backend: keyless development, the e2e server and the test runner.
// ---------------------------------------------------------------------------

const memoryRows = new Map<string, CityEnrichmentCheckpoint>();

/** Test-only: the memory backend keeps state across cases otherwise. */
export function resetCityEnrichmentCheckpointMemory(): void {
  memoryRows.clear();
  guard.resetWarnings();
}

const memoryStore: CityEnrichmentCheckpointStore = {
  async read(city, totalPubs, now) {
    const held = memoryRows.get(city);
    return held ? normaliseCheckpoint(held, city, totalPubs, now) : null;
  },
  async claim({ city, totalPubs, owner, now, leaseMs }) {
    const held = memoryRows.get(city);
    const current = held
      ? normaliseCheckpoint(held, city, totalPubs, now)
      : emptyCityEnrichmentCheckpoint(city, totalPubs, now);
    const claim = claimEnrichmentLease(current, { owner, now, leaseMs });
    if (!claim.ok) {
      return { status: "lease-held", heldBy: claim.heldBy, expiresAt: claim.expiresAt };
    }
    const claimed = { ...claim.checkpoint, totalPubs };
    memoryRows.set(city, claimed);
    return { status: "claimed", checkpoint: claimed, durable: false };
  },
  async commit(checkpoint, owner) {
    const held = memoryRows.get(checkpoint.city);
    // Mirror the durable guard exactly: a run that lost its lease writes nothing.
    if (held && held.leaseOwner !== null && held.leaseOwner !== owner) {
      return { status: "lease-lost" };
    }
    memoryRows.set(checkpoint.city, checkpoint);
    return { status: "committed", durable: false };
  },
  async save(checkpoint) {
    memoryRows.set(checkpoint.city, checkpoint);
    return { status: "committed", durable: false };
  },
};

// ---------------------------------------------------------------------------
// Supabase backend.
// ---------------------------------------------------------------------------

const supabaseStore: CityEnrichmentCheckpointStore = {
  async read(city, totalPubs, now) {
    return guard.guard<CityEnrichmentCheckpoint | null>({
      context: "read",
      onSchemaMiss: () => memoryStore.read(city, totalPubs, now),
      onError: () => null,
      message: `checkpoint read failed for ${city}`,
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("city", city)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? rowToCheckpoint(data as Row, city, totalPubs, now) : null;
      },
    });
  },

  async claim({ city, totalPubs, owner, now, leaseMs }) {
    try {
      const client = admin();
      const empty = emptyCityEnrichmentCheckpoint(city, totalPubs, now);
      // Make sure the row exists without disturbing a live one: an insert that
      // conflicts is the ordinary case on every night but the first.
      const insert = await client
        .from(TABLE)
        .upsert(checkpointToRow(empty), { onConflict: "city", ignoreDuplicates: true });
      if (insert.error && !isUniqueViolation(insert.error)) throw new Error(insert.error.message);

      const claimed = claimEnrichmentLease(empty, { owner, now, leaseMs });
      if (!claimed.ok) {
        return { status: "lease-held", heldBy: claimed.heldBy, expiresAt: claimed.expiresAt };
      }

      const nowIso = new Date(now).toISOString();
      // ONE conditional UPDATE. Two schedulers firing together both send this
      // and exactly one row comes back, because the second no longer matches.
      const { data, error } = await client
        .from(TABLE)
        .update({
          lease_owner: owner,
          lease_expires_at: claimed.checkpoint.leaseExpiresAt,
          total_pubs: totalPubs,
          updated_at: nowIso,
        })
        .eq("city", city)
        .or(`lease_owner.is.null,lease_expires_at.lt.${nowIso}`)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        const current = await supabaseStore.read(city, totalPubs, now);
        return {
          status: "lease-held",
          heldBy: current?.leaseOwner ?? "unknown",
          expiresAt: current?.leaseExpiresAt ?? "",
        };
      }
      return {
        status: "claimed",
        checkpoint: rowToCheckpoint(data as Row, city, totalPubs, now),
        durable: true,
      };
    } catch (err) {
      if (isMissingTableSchema(err, TABLE)) {
        guard.warn("claim", err);
        return memoryStore.claim({ city, totalPubs, owner, now, leaseMs });
      }
      // A read we could not run is not permission to run unbudgeted. The cron
      // skips the night and says so rather than spending without a checkpoint.
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },

  async commit(checkpoint, owner) {
    try {
      const { data, error } = await admin()
        .from(TABLE)
        .update(checkpointToRow(checkpoint))
        .eq("city", checkpoint.city)
        .eq("lease_owner", owner)
        .select("city")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { status: "lease-lost" };
      return { status: "committed", durable: true };
    } catch (err) {
      if (isMissingTableSchema(err, TABLE)) {
        guard.warn("commit", err);
        return memoryStore.commit(checkpoint, owner);
      }
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },

  async save(checkpoint) {
    try {
      const { error } = await admin()
        .from(TABLE)
        .upsert(checkpointToRow(checkpoint), { onConflict: "city" });
      if (error) throw new Error(error.message);
      return { status: "committed", durable: true };
    } catch (err) {
      if (isMissingTableSchema(err, TABLE)) {
        guard.warn("save", err);
        return memoryStore.save(checkpoint);
      }
      return { status: "unavailable", reason: errorMessage(err) };
    }
  },
};

export function cityEnrichmentCheckpointStore(): CityEnrichmentCheckpointStore {
  return selectStore(memoryStore, supabaseStore);
}

/** Whether this deployment has a durable checkpoint at all. */
export function cityEnrichmentCheckpointIsDurable(): boolean {
  return isSupabaseConfigured();
}
