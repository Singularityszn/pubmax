// lib/freshnessStoreOverlay.ts's resolveDurableFeedStoreReads is the resolver
// that answers /api/freshness and the freshness-audit cron with the REAL
// four-way outcome (unconfigured / unreachable / empty / ok) of reading
// price_update_retrieval and night_signal_candidates from the durable
// feed_freshness table (migration 0047). It must never collapse "the store
// could not be reached" into "empty" or "fresh" — those are three separate
// findings and resolveStoreStamp downstream depends on telling them apart.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  configured: true,
  row: null as { observed_at: string } | null,
  // Real @supabase/postgrest-js PostgrestError extends Error (message is
  // readable via `instanceof Error`, same as lib/storeBackend.ts errorMessage
  // expects) — mock it as a real Error, not a plain object, to match reality.
  error: null as Error | null,
  throws: null as Error | null,
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => db.configured,
  requireSupabaseAdmin: () => ({
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (db.throws) throw db.throws;
          return { data: db.row, error: db.error };
        },
      };
    },
  }),
}));

import {
  NIGHT_SIGNAL_CANDIDATES_DATASET_ID,
  PRICE_UPDATE_RETRIEVAL_DATASET_ID,
  resolveDurableFeedStoreReads,
} from "@/lib/freshnessStoreOverlay";

beforeEach(() => {
  db.configured = true;
  db.row = null;
  db.error = null;
  db.throws = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveDurableFeedStoreReads — the real four-way read, never guessed", () => {
  it("reports unconfigured when Supabase env vars are absent, without attempting a query", async () => {
    db.configured = false;
    const reads = await resolveDurableFeedStoreReads();
    expect(reads[PRICE_UPDATE_RETRIEVAL_DATASET_ID]).toEqual({ kind: "unconfigured" });
    expect(reads[NIGHT_SIGNAL_CANDIDATES_DATASET_ID]).toEqual({ kind: "unconfigured" });
  });

  it("reports ok with the real observedAt when the store answers", async () => {
    db.row = { observed_at: "2026-07-16T00:00:00Z" };
    const reads = await resolveDurableFeedStoreReads();
    expect(reads[PRICE_UPDATE_RETRIEVAL_DATASET_ID]).toEqual({
      kind: "ok",
      observedAt: "2026-07-16T00:00:00Z",
    });
  });

  it("reports empty (not unreachable) when the query succeeds but no row exists yet", async () => {
    db.row = null;
    db.error = null;
    const reads = await resolveDurableFeedStoreReads();
    expect(reads[PRICE_UPDATE_RETRIEVAL_DATASET_ID]).toEqual({ kind: "empty" });
  });

  it("the unreachable case: a query error is unreachable, distinct from empty or unconfigured", async () => {
    db.error = new Error("connection reset");
    const reads = await resolveDurableFeedStoreReads();
    const read = reads[PRICE_UPDATE_RETRIEVAL_DATASET_ID];
    expect(read.kind).toBe("unreachable");
    expect(read.kind === "unreachable" && read.error).toContain("connection reset");
  });

  it("the unreachable case: a schema-miss error names the migration, still unreachable not empty", async () => {
    db.error = new Error("Could not find the table 'public.feed_freshness' in the schema cache");
    const reads = await resolveDurableFeedStoreReads();
    const read = reads[NIGHT_SIGNAL_CANDIDATES_DATASET_ID];
    expect(read.kind).toBe("unreachable");
    expect(read.kind === "unreachable" && read.error).toContain("migration 0047");
  });

  it("the unreachable case: a thrown exception (network failure) never becomes empty or ok", async () => {
    db.throws = new Error("fetch failed: ENOTFOUND");
    const reads = await resolveDurableFeedStoreReads();
    const read = reads[PRICE_UPDATE_RETRIEVAL_DATASET_ID];
    expect(read.kind).toBe("unreachable");
    expect(read.kind === "unreachable" && read.error).toContain("ENOTFOUND");
  });

  it("resolves both feed keys independently under the same store outcome", async () => {
    db.row = { observed_at: "2026-07-16T00:00:00Z" };
    const reads = await resolveDurableFeedStoreReads();
    expect(Object.keys(reads).sort()).toEqual(
      [NIGHT_SIGNAL_CANDIDATES_DATASET_ID, PRICE_UPDATE_RETRIEVAL_DATASET_ID].sort(),
    );
  });
});
