// Kitchen reports store - dual backend (process-memory + Supabase
// public.kitchen_reports, migration 0209).
//
// This store PERSISTS a drinker's "still serving" or "kitchen closed" tap and
// its one confirmation. It NEVER writes a venue fact: no pack, no pin, no hours
// and no kitchen time reads these rows. Service-role writes; no browser role
// has a grant.
//
// THE TAP RULE IS ONE FUNCTION, `planKitchenTap` (lib/kitchenReports.ts), read
// by both backends: a different word starts a report, the reporter cannot
// confirm their own, and one other account confirms once, with no third.
//
// Reads are fail-soft. A HARD durable write failure THROWS so the route answers
// 503 rather than a fake success.

import "server-only";

import { randomUUID } from "crypto";

import {
  KITCHEN_FRESH_WINDOW_MS,
  latestFreshKitchenReport,
  parseKitchenState,
  planKitchenTap,
  type KitchenReport,
  type KitchenState,
} from "@/lib/kitchenReports";
import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";

const TABLE = "kitchen_reports";
const MIGRATION_HINT = "apply migration 0209";
const STORE_TAG = "kitchen-reports";

/** Bounded reads: never return more than this many rows for one query. */
const MAX_OWNER_ROWS = 200;

type KitchenTapInput = { venueId: string; state: KitchenState; userId: string };

export type KitchenTapResult =
  | { outcome: "reported"; report: KitchenReport }
  | { outcome: "confirmed"; report: KitchenReport }
  | { outcome: "own" }
  | { outcome: "already" };

type KitchenLatestResult = { status: "ready" | "degraded"; report: KitchenReport | null };
type KitchenOwnerResult = { status: "ready" | "degraded"; reports: KitchenReport[] };

export type KitchenReportsStore = {
  /** One tap: report, confirm, or refuse. THROWS on a hard durable failure. */
  tap(input: KitchenTapInput, now?: number): Promise<KitchenTapResult>;
  /** The newest report inside the 90 minute window. Fail-soft (degraded, null). */
  readLatest(venueId: string, now?: number): Promise<KitchenLatestResult>;
  /** The reporter's own rows, newest first (account export). Fail-soft (degraded, []). */
  listForOwner(reporterUserId: string, limit?: number): Promise<KitchenOwnerResult>;
};

function byNewest(left: { reportedAt: string }, right: { reportedAt: string }): number {
  return right.reportedAt.localeCompare(left.reportedAt);
}

// ── Memory ───────────────────────────────────────────────────────────────────
const memoryRows = new Map<string, KitchenReport>();

function memoryLatest(venueId: string, now: number): KitchenReport | null {
  return latestFreshKitchenReport(
    [...memoryRows.values()].filter((row) => row.venueId === venueId),
    now,
  );
}

export const memoryKitchenReportsStore: KitchenReportsStore = {
  async tap(input, now = Date.now()) {
    const latest = memoryLatest(input.venueId, now);
    const plan = planKitchenTap(latest, input.state, input.userId);
    if (plan.kind === "own" || plan.kind === "already") return { outcome: plan.kind };
    if (plan.kind === "confirm") {
      const hit = memoryRows.get(plan.id);
      if (!hit || hit.confirmedAt !== null) return { outcome: "already" };
      hit.confirmedBy = input.userId;
      hit.confirmedAt = new Date(now).toISOString();
      return { outcome: "confirmed", report: { ...hit } };
    }
    const row: KitchenReport = {
      id: randomUUID(),
      venueId: input.venueId,
      state: input.state,
      reporterUserId: input.userId,
      reportedAt: new Date(now).toISOString(),
      confirmedBy: null,
      confirmedAt: null,
    };
    memoryRows.set(row.id, row);
    return { outcome: "reported", report: { ...row } };
  },

  async readLatest(venueId, now = Date.now()) {
    const hit = memoryLatest(venueId, now);
    return { status: "ready", report: hit ? { ...hit } : null };
  },

  async listForOwner(reporterUserId, limit = MAX_OWNER_ROWS) {
    const reports = [...memoryRows.values()]
      .filter((row) => row.reporterUserId === reporterUserId)
      .sort(byNewest)
      .slice(0, Math.max(1, Math.floor(limit)))
      .map((row) => ({ ...row }));
    return { status: "ready", reports };
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: [TABLE],
  migrationHint: MIGRATION_HINT,
});

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fromRow(row: Record<string, unknown>): KitchenReport | null {
  const id = readText(row.id);
  const venueId = readText(row.venue_id);
  const reporterUserId = readText(row.reporter_user_id);
  const reportedAt = readText(row.reported_at);
  const state = parseKitchenState(row.state);
  if (!id || !venueId || !reporterUserId || !reportedAt || !state) return null;
  return {
    id,
    venueId,
    state,
    reporterUserId,
    reportedAt,
    confirmedBy: readText(row.confirmed_by) || null,
    confirmedAt: readText(row.confirmed_at) || null,
  };
}

function rows(data: unknown): KitchenReport[] {
  return (Array.isArray(data) ? data : [])
    .map((row) => fromRow(row as Record<string, unknown>))
    .filter((row): row is KitchenReport => row !== null);
}

async function readLatestRow(venueId: string, now: number): Promise<KitchenReport | null> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("*")
    .eq("venue_id", venueId)
    .gte("reported_at", new Date(now - KITCHEN_FRESH_WINDOW_MS).toISOString())
    .order("reported_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  // The filter above is the rule; this is the same rule again, so a row the
  // query let through by mistake still never reaches a reader.
  return latestFreshKitchenReport(rows(data), now);
}

const supabaseKitchenReportsStore: KitchenReportsStore = {
  async tap(input, now = Date.now()) {
    return guard({
      context: "tap",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryKitchenReportsStore.tap(input, now),
        }),
      run: async (): Promise<KitchenTapResult> => {
        const latest = await readLatestRow(input.venueId, now);
        const plan = planKitchenTap(latest, input.state, input.userId);
        if (plan.kind === "own" || plan.kind === "already") return { outcome: plan.kind };
        if (plan.kind === "confirm") {
          // Only an unconfirmed row by somebody else moves: two confirmers
          // racing each other leave one confirmation and one "already".
          const { data, error } = await admin()
            .from(TABLE)
            .update({ confirmed_by: input.userId, confirmed_at: new Date(now).toISOString() })
            .eq("id", plan.id)
            .is("confirmed_at", null)
            .neq("reporter_user_id", input.userId)
            .select("*");
          if (error) throw new Error(error.message);
          const moved = rows(data)[0];
          return moved ? { outcome: "confirmed", report: moved } : { outcome: "already" };
        }
        const { data, error } = await admin()
          .from(TABLE)
          .insert({
            venue_id: input.venueId,
            state: input.state,
            reporter_user_id: input.userId,
            reported_at: new Date(now).toISOString(),
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        const stored = fromRow(data as Record<string, unknown>);
        if (!stored) throw new Error("kitchen report insert returned an unreadable row");
        return { outcome: "reported", report: stored };
      },
    });
  },

  async readLatest(venueId, now = Date.now()) {
    return guard({
      context: "read-latest",
      onSchemaMiss: () => memoryKitchenReportsStore.readLatest(venueId, now),
      onError: async () => ({ status: "degraded" as const, report: null }),
      message: "latest read failed",
      run: async () => ({ status: "ready" as const, report: await readLatestRow(venueId, now) }),
    });
  },

  async listForOwner(reporterUserId, limit = MAX_OWNER_ROWS) {
    return guard({
      context: "list-owner",
      onSchemaMiss: () => memoryKitchenReportsStore.listForOwner(reporterUserId, limit),
      onError: async () => ({ status: "degraded" as const, reports: [] }),
      message: "owner list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("reporter_user_id", reporterUserId)
          .order("reported_at", { ascending: false })
          .limit(Math.max(1, Math.floor(limit)));
        if (error) throw new Error(error.message);
        return { status: "ready" as const, reports: rows(data) };
      },
    });
  },
};

export const kitchenReportsStore = createDualBackendStore(
  memoryKitchenReportsStore,
  supabaseKitchenReportsStore,
);

/** Test-only: clear the in-memory reports between cases. */
export function __resetKitchenReports(): void {
  memoryRows.clear();
}
