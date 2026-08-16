// Crowd occupancy store — dual backend (memory + Supabase).
//
// One table, trust derived on READ: `readNow` only answers from reports
// inside 90 minutes. A re-tap by the same account at the same pub inside
// 15 minutes updates that row. Service-role writes; the browser never
// touches the table.

import { randomUUID } from "crypto";

import { isDeployedProduction } from "@/lib/deploymentEnv";
import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import {
  OCCUPANCY_SOURCE,
  occupancyLevelFromSql,
  occupancyLevelToSql,
  occupancyNowFromReports,
  occupancyRetakeOpen,
  type OccupancyLevel,
  type OccupancyNowAnswer,
  type OccupancyReport,
  type OccupancySource,
} from "@/lib/occupancy";

const TABLE = "venue_occupancy_reports";
const MIGRATION_HINT = "apply migrations 0107 and 0109";
const STORE_TAG = "venue-occupancy";

export type OccupancyStoredReport = OccupancyReport & {
  id: string;
  hiddenAt: string | null;
  reportCount: number;
  reporters: Set<string>;
  reportReason?: string;
};

export type OccupancyWriteInput = {
  venueId: string;
  level: OccupancyLevel;
  reporterUserId: string;
  now?: number;
};

export type OccupancyStore = {
  report(input: OccupancyWriteInput): Promise<OccupancyStoredReport>;
  readNow(venueId: string, now?: number): Promise<OccupancyNowAnswer>;
  flag(id: string, reason?: string, actorHash?: string): Promise<boolean>;
  moderate(id: string, hidden: boolean, note?: string): Promise<boolean>;
};

function cleanVenueId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 64);
}

function cleanUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const memoryReports: OccupancyStoredReport[] = [];

function stamp(
  input: OccupancyWriteInput,
  nowMs: number,
  id = randomUUID(),
): OccupancyStoredReport {
  return {
    id,
    venueId: cleanVenueId(input.venueId),
    level: input.level,
    reportedAt: new Date(nowMs).toISOString(),
    reporterUserId: cleanUserId(input.reporterUserId),
    source: OCCUPANCY_SOURCE,
    hiddenAt: null,
    reportCount: 0,
    reporters: new Set<string>(),
  };
}

function cleanReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function findMemoryRow(id: string): OccupancyStoredReport | undefined {
  return memoryReports.find((row) => row.id === id);
}

export const memoryOccupancyStore: OccupancyStore = {
  async report(input) {
    const venueId = cleanVenueId(input.venueId);
    const reporterUserId = cleanUserId(input.reporterUserId);
    if (!venueId) throw new Error("A venue is required.");
    if (!reporterUserId) throw new Error("A signed-in account is required.");
    const nowMs = input.now ?? Date.now();
    const open = memoryReports.find(
      (row) =>
        row.venueId === venueId &&
        row.reporterUserId === reporterUserId &&
        occupancyRetakeOpen(row.reportedAt, nowMs),
    );
    if (open) {
      open.level = input.level;
      open.reportedAt = new Date(nowMs).toISOString();
      return open;
    }
    const row = stamp({ ...input, venueId, reporterUserId }, nowMs);
    memoryReports.push(row);
    return row;
  },

  async readNow(venueId, now) {
    const id = cleanVenueId(venueId);
    return occupancyNowFromReports(
      memoryReports.filter((row) => row.venueId === id),
      now ?? Date.now(),
    );
  },

  async flag(id, reason, actorHash) {
    const row = findMemoryRow(id);
    if (!row) return false;
    const reporter = actorHash && actorHash !== "" ? actorHash : null;
    if (reporter) {
      if (row.reporters.has(reporter)) return true;
      row.reporters.add(reporter);
    }
    row.reportCount += 1;
    const cleaned = cleanReason(reason);
    if (cleaned) row.reportReason = cleaned;
    return true;
  },

  async moderate(id, hidden) {
    const row = findMemoryRow(id);
    if (!row) return false;
    row.hiddenAt = hidden ? new Date().toISOString() : null;
    return true;
  },
};

const guard = createFailSoftGuard({
  tag: STORE_TAG,
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

type OccupancyRow = {
  id?: unknown;
  venue_id?: unknown;
  reported_at?: unknown;
  level?: unknown;
  reporter_user_id?: unknown;
  source?: unknown;
  hidden_at?: unknown;
  report_count?: unknown;
  report_reason?: unknown;
};

const OCCUPANCY_SELECT =
  "id, venue_id, reported_at, level, reporter_user_id, source, hidden_at, report_count, report_reason";

function fromRow(row: OccupancyRow): OccupancyStoredReport | null {
  const id = typeof row.id === "string" ? row.id : "";
  const venueId = cleanVenueId(row.venue_id);
  const level = occupancyLevelFromSql(row.level);
  const reportedAt =
    typeof row.reported_at === "string" ? row.reported_at : "";
  const reporterUserId = cleanUserId(row.reporter_user_id);
  // The table CHECKs source = 'crowd'; anything else is a row this layer does
  // not speak for, so it is dropped rather than relabelled.
  if (row.source !== OCCUPANCY_SOURCE) return null;
  const source: OccupancySource = OCCUPANCY_SOURCE;
  if (!id || !venueId || !level || !reportedAt || !reporterUserId) return null;
  const hiddenAt =
    typeof row.hidden_at === "string" && row.hidden_at !== ""
      ? row.hidden_at
      : null;
  const reportCount =
    typeof row.report_count === "number" && Number.isFinite(row.report_count)
      ? Math.max(0, Math.floor(row.report_count))
      : 0;
  const reportReason =
    typeof row.report_reason === "string" ? row.report_reason : undefined;
  return {
    id,
    venueId,
    level,
    reportedAt,
    reporterUserId,
    source,
    hiddenAt,
    reportCount,
    reporters: new Set<string>(),
    reportReason,
  };
}

export const supabaseOccupancyStore: OccupancyStore = {
  async report(input) {
    const venueId = cleanVenueId(input.venueId);
    const reporterUserId = cleanUserId(input.reporterUserId);
    if (!venueId) throw new Error("A venue is required.");
    if (!reporterUserId) throw new Error("A signed-in account is required.");
    const nowMs = input.now ?? Date.now();
    return guard.guard({
      context: "report",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () =>
            memoryOccupancyStore.report({
              ...input,
              venueId,
              reporterUserId,
              now: nowMs,
            }),
        }),
      run: async () => {
        const since = new Date(nowMs - 15 * 60 * 1000).toISOString();
        const { data: openRows, error: openError } = await admin()
          .from(TABLE)
          .select(OCCUPANCY_SELECT)
          .eq("venue_id", venueId)
          .eq("reporter_user_id", reporterUserId)
          .gte("reported_at", since)
          .order("reported_at", { ascending: false })
          .limit(1);
        if (openError) throw new Error(openError.message);
        const open = fromRow((openRows ?? [])[0] ?? {});
        if (open && occupancyRetakeOpen(open.reportedAt, nowMs)) {
          const { data, error } = await admin()
            .from(TABLE)
            .update({
              level: occupancyLevelToSql(input.level),
              reported_at: new Date(nowMs).toISOString(),
            })
            .eq("id", open.id)
            .select(OCCUPANCY_SELECT)
            .limit(1);
          if (error) throw new Error(error.message);
          const updated = fromRow((data ?? [])[0] ?? {});
          if (!updated) throw new Error("The occupancy report did not persist.");
          return updated;
        }
        const row = stamp({ ...input, venueId, reporterUserId }, nowMs);
        const { data, error } = await admin()
          .from(TABLE)
          .insert({
            id: row.id,
            venue_id: row.venueId,
            reported_at: row.reportedAt,
            level: occupancyLevelToSql(row.level),
            reporter_user_id: row.reporterUserId,
            source: row.source,
          })
          .select(OCCUPANCY_SELECT)
          .limit(1);
        if (error) throw new Error(error.message);
        const stored = fromRow((data ?? [])[0] ?? {});
        if (!stored) throw new Error("The occupancy report did not persist.");
        return stored;
      },
    });
  },

  async readNow(venueId, now) {
    const id = cleanVenueId(venueId);
    if (!id) {
      return occupancyNowFromReports([], now ?? Date.now());
    }
    return guard.guard({
      context: "readNow",
      // A read that could not run is degraded, never "no reports". Outside a
      // deployed production instance the memory store is the real backend
      // while the migration is being prepared.
      onSchemaMiss: () =>
        isDeployedProduction()
          ? Promise.resolve(
              occupancyNowFromReports([], now ?? Date.now(), { degraded: true }),
            )
          : memoryOccupancyStore.readNow(id, now),
      onError: () => occupancyNowFromReports([], now ?? Date.now(), { degraded: true }),
      message: "occupancy read failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(OCCUPANCY_SELECT)
          .eq("venue_id", id)
          .order("reported_at", { ascending: false })
          .limit(200);
        if (error) throw new Error(error.message);
        const reports = (data ?? [])
          .map((row) => fromRow(row as OccupancyRow))
          .filter((row): row is OccupancyStoredReport => row !== null);
        return occupancyNowFromReports(reports, now ?? Date.now());
      },
    });
  },

  async flag(id, reason, actorHash) {
    const reportId = typeof id === "string" ? id.trim() : "";
    if (!reportId) return false;
    return guard.guard({
      context: "flag",
      onSchemaMiss: () => memoryOccupancyStore.flag(reportId, reason, actorHash),
      run: async () => {
        const { data, error } = await admin().rpc("report_occupancy_report", {
          p_id: reportId,
          p_actor_hash: actorHash ?? "",
          p_reason: cleanReason(reason),
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
    });
  },

  async moderate(id, hidden) {
    const reportId = typeof id === "string" ? id.trim() : "";
    if (!reportId) return false;
    return guard.guard({
      context: "moderate",
      onSchemaMiss: () => memoryOccupancyStore.moderate(reportId, hidden),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({ hidden_at: hidden ? new Date().toISOString() : null })
          .eq("id", reportId)
          .select("id")
          .limit(1);
        if (error) throw new Error(error.message);
        return Boolean(data?.[0]);
      },
    });
  },
};

export const occupancyStore = createDualBackendStore(
  memoryOccupancyStore,
  supabaseOccupancyStore,
);

export function __resetMemoryOccupancyReports(): void {
  memoryReports.length = 0;
  guard.resetWarnings();
}
