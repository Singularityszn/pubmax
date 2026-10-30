// Venue corrections store - dual backend (process-memory + Supabase
// public.venue_corrections, migration 0197).
//
// This store PERSISTS a "That's wrong" note and moves it through open ->
// resolved or dismissed. It NEVER writes a venue fact: no pack, no pin, no
// hours and no price lane reads these rows. Service-role writes; no browser
// role has a grant.
//
// Reads are fail-soft. A HARD durable write failure THROWS so the route answers
// 503 rather than a fake success.

import "server-only";

import { randomUUID } from "node:crypto";

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import {
  isStoredVenueCorrectionKind,
  isVenueCorrectionStatus,
  type StoredVenueCorrectionKind,
  type VenueCorrection,
  type VenueCorrectionDecision,
  type VenueCorrectionStatus,
} from "@/lib/venueCorrections";

const TABLE = "venue_corrections";
const MIGRATION_HINT = "apply migration 0197";
const STORE_TAG = "venue-corrections";

/** Bounded reads: never return more than this many rows for one query. */
const MAX_REVIEW_ROWS = 200;
const MAX_OWNER_ROWS = 200;

export type NewVenueCorrection = {
  venueId: string;
  kind: StoredVenueCorrectionKind;
  note: string;
  ownerUserId: string;
};

type VenueCorrectionListResult = {
  status: "ready" | "degraded";
  corrections: VenueCorrection[];
};

export type VenueCorrectionsStore = {
  /** Store one note. THROWS on a hard durable failure. */
  create(fields: NewVenueCorrection, now?: number): Promise<VenueCorrection>;
  /** Moderator queue: rows in a status, newest first. Fail-soft ([]). */
  listForReview(status: VenueCorrectionStatus): Promise<VenueCorrection[]>;
  /** The owner's own rows, newest first (account export). Fail-soft (degraded, []). */
  listForOwner(ownerUserId: string, limit?: number): Promise<VenueCorrectionListResult>;
  /** Moderator lookup of one row. Fail-soft (null). */
  getById(id: string): Promise<VenueCorrection | null>;
  /** Moderator verdict on an OPEN row. False when it is unknown or already decided. THROWS on hard failure. */
  decide(id: string, decision: VenueCorrectionDecision, resolvedBy: string, now?: number): Promise<boolean>;
};

function byNewest(left: { createdAt: string }, right: { createdAt: string }): number {
  return right.createdAt.localeCompare(left.createdAt);
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, VenueCorrection>();

export const memoryVenueCorrectionsStore: VenueCorrectionsStore = {
  async create(fields, now = Date.now()) {
    const row: VenueCorrection = {
      id: randomUUID(),
      venueId: fields.venueId,
      kind: fields.kind,
      note: fields.note,
      ownerUserId: fields.ownerUserId,
      status: "open",
      createdAt: new Date(now).toISOString(),
      resolvedAt: null,
      resolvedBy: null,
    };
    byId.set(row.id, row);
    return { ...row };
  },

  async listForReview(status) {
    return [...byId.values()]
      .filter((row) => row.status === status)
      .sort(byNewest)
      .slice(0, MAX_REVIEW_ROWS)
      .map((row) => ({ ...row }));
  },

  async listForOwner(ownerUserId, limit = MAX_OWNER_ROWS) {
    const corrections = [...byId.values()]
      .filter((row) => row.ownerUserId === ownerUserId)
      .sort(byNewest)
      .slice(0, Math.max(1, Math.floor(limit)))
      .map((row) => ({ ...row }));
    return { status: "ready", corrections };
  },

  async getById(id) {
    const hit = byId.get(id);
    return hit ? { ...hit } : null;
  },

  async decide(id, decision, resolvedBy, now = Date.now()) {
    const hit = byId.get(id);
    if (!hit || hit.status !== "open") return false;
    hit.status = decision;
    hit.resolvedAt = new Date(now).toISOString();
    hit.resolvedBy = resolvedBy;
    return true;
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fromRow(row: Record<string, unknown>): VenueCorrection | null {
  const id = readText(row.id);
  const ownerUserId = readText(row.owner_user_id);
  const venueId = readText(row.venue_id);
  if (!id || !ownerUserId || !venueId) return null;
  if (!isStoredVenueCorrectionKind(row.kind) || !isVenueCorrectionStatus(row.status)) return null;
  return {
    id,
    venueId,
    kind: row.kind,
    note: readText(row.note),
    ownerUserId,
    status: row.status,
    createdAt: readText(row.created_at) || new Date(0).toISOString(),
    resolvedAt: readText(row.resolved_at) || null,
    resolvedBy: readText(row.resolved_by) || null,
  };
}

function rows(data: unknown): VenueCorrection[] {
  return (Array.isArray(data) ? data : [])
    .map((row) => fromRow(row as Record<string, unknown>))
    .filter((row): row is VenueCorrection => row !== null);
}

const supabaseVenueCorrectionsStore: VenueCorrectionsStore = {
  async create(fields, now = Date.now()) {
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryVenueCorrectionsStore.create(fields, now),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .insert({
            owner_user_id: fields.ownerUserId,
            venue_id: fields.venueId,
            kind: fields.kind,
            note: fields.note,
            created_at: new Date(now).toISOString(),
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        const stored = fromRow(data as Record<string, unknown>);
        if (!stored) throw new Error("venue correction insert returned an unreadable row");
        return stored;
      },
    });
  },

  async listForReview(status) {
    return guard({
      context: "list-review",
      onSchemaMiss: () => memoryVenueCorrectionsStore.listForReview(status),
      onError: async () => [],
      message: "review list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("status", status)
          .order("created_at", { ascending: false })
          .limit(MAX_REVIEW_ROWS);
        if (error) throw new Error(error.message);
        return rows(data);
      },
    });
  },

  async listForOwner(ownerUserId, limit = MAX_OWNER_ROWS) {
    return guard({
      context: "list-owner",
      onSchemaMiss: () => memoryVenueCorrectionsStore.listForOwner(ownerUserId, limit),
      onError: async () => ({ status: "degraded" as const, corrections: [] }),
      message: "owner list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("owner_user_id", ownerUserId)
          .order("created_at", { ascending: false })
          .limit(Math.max(1, Math.floor(limit)));
        if (error) throw new Error(error.message);
        return { status: "ready" as const, corrections: rows(data) };
      },
    });
  },

  async getById(id) {
    return guard({
      context: "get",
      onSchemaMiss: () => memoryVenueCorrectionsStore.getById(id),
      onError: async () => null,
      message: "read failed",
      run: async () => {
        const { data, error } = await admin().from(TABLE).select("*").eq("id", id).maybeSingle();
        if (error) throw new Error(error.message);
        return data ? fromRow(data as Record<string, unknown>) : null;
      },
    });
  },

  async decide(id, decision, resolvedBy, now = Date.now()) {
    return guard({
      context: "decide",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryVenueCorrectionsStore.decide(id, decision, resolvedBy, now),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            status: decision,
            resolved_at: new Date(now).toISOString(),
            resolved_by: resolvedBy,
          })
          .eq("id", id)
          // Only an open row moves: a second moderator's tap on a decided one is a no-op.
          .eq("status", "open")
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },
};

export const venueCorrectionsStore = createDualBackendStore(
  memoryVenueCorrectionsStore,
  supabaseVenueCorrectionsStore,
);

/** Test-only: clear the in-memory corrections between cases. */
export function __resetVenueCorrections(): void {
  byId.clear();
}
