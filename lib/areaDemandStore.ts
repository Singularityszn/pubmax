import "server-only";

// Area-demand store — the durable-or-memory backing for the demand capture on
// the honest unsupported-area preview (Wayfinder 3.2). When PUBMAXX cannot serve
// an area, the user can register that they want it; this store records that
// signal so coverage can be prioritised by real demand.
//
// ONE store interface, TWO implementations (process-memory + Supabase
// public.area_demand) — the house dual-backend seam: Supabase when env keys
// exist, process-memory otherwise, chosen at the single areaDemandStore() seam. Before migration 0045
// lands (or on a schema miss), local/preview paths fail soft to memory. Deployed
// production returns a failed write outcome so the route answers 503 instead of
// acknowledging an ephemeral process-memory write.
//
// PRIVACY: `area` is free text as the user said it and `email` is OPTIONAL —
// most rows carry NO contact at all (demand is captured without it). No
// coordinates are ever stored; the taste doctrine forbids raw location in the
// payload. Email, when offered, is PII and API-only (RLS, service-role only).

import {
  coerceAreaDemandSource,
  normaliseArea,
  type AreaDemandSummary,
  type AreaDemandSource,
  type NormalisedAreaDemand,
} from "@/lib/areaDemand";
import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type RecordAreaDemandInput = NormalisedAreaDemand;

export type RecordAreaDemandOutcome = {
  /** `recorded` = the demand signal was persisted. */
  status: "recorded";
  /** Set when a durable write hard-failed — the demand was NOT recorded. */
  failed?: true;
};

export const AREA_DEMAND_SUMMARY_DEFAULT_LIMIT = 50;
export const AREA_DEMAND_SUMMARY_MAX_LIMIT = 100;
export const AREA_DEMAND_SUMMARY_DEFAULT_DAYS = 90;
export const AREA_DEMAND_SUMMARY_MAX_DAYS = 365;

export type AreaDemandSummaryOptions = Readonly<{
  limit: number;
  sinceDays: number;
}>;

export type AreaDemandSummaryResult = Readonly<{
  items: readonly AreaDemandSummary[];
  partial: boolean;
  status: "ready" | "degraded";
}>;

export function normaliseAreaDemandSummaryOptions(
  input: Partial<AreaDemandSummaryOptions> = {},
): AreaDemandSummaryOptions {
  const rawLimit = Number.isFinite(input.limit)
    ? Math.floor(input.limit ?? 0)
    : 0;
  const rawSinceDays = Number.isFinite(input.sinceDays)
    ? Math.floor(input.sinceDays ?? 0)
    : 0;
  return {
    limit:
      rawLimit > 0
        ? Math.min(rawLimit, AREA_DEMAND_SUMMARY_MAX_LIMIT)
        : AREA_DEMAND_SUMMARY_DEFAULT_LIMIT,
    sinceDays:
      rawSinceDays > 0
        ? Math.min(rawSinceDays, AREA_DEMAND_SUMMARY_MAX_DAYS)
        : AREA_DEMAND_SUMMARY_DEFAULT_DAYS,
  };
}

export type AreaDemandStore = {
  /**
   * Record one demand signal. NEVER throws; a durable write that hard-fails
   * resolves with `failed: true` so the route can answer 503 (no fake success).
   * Not deduped — each expression of demand is a distinct signal (a re-tap is a
   * genuine "still want this"), but table growth is bounded by the route's
   * durable rate limit.
   */
  record(input: RecordAreaDemandInput, now?: number): Promise<RecordAreaDemandOutcome>;
  /** Count of recorded signals for an area (case-insensitive), for prioritising
   *  coverage. NEVER throws; a read failure resolves 0. */
  countForArea(area: string): Promise<number>;
  /** Ranked coverage demand with no optional contact field or viewer point. */
  listSummary(
    options?: Partial<AreaDemandSummaryOptions>,
    now?: number,
  ): Promise<AreaDemandSummaryResult>;
};

// Bound process memory in a long-lived server — evict the oldest rows past this
// many (the durable table has no such cap).
const MAX_ROWS = 50_000;
const DAY_MS = 86_400_000;
const SUMMARY_PAGE_SIZE = 1_000;
const SUMMARY_ROW_CAP = 20_000;

// ── In-memory implementation ─────────────────────────────────────────────────
type DemandRecord = {
  area: string;
  areaKey: string;
  matchedPatchId: string | null;
  source: AreaDemandSource;
  email: string | null;
  createdAt: number;
};

type DemandEvictionRange = {
  earliestCreatedAt: number;
  latestCreatedAt: number;
};

// Next can evaluate the public write and admin read routes in separate bundles.
// Keep keyless data on the server process so both bundles see one store.
const areaDemandMemoryGlobal = globalThis as typeof globalThis & {
  __pubmaxAreaDemandRows?: DemandRecord[];
  __pubmaxAreaDemandEvictionRange?: DemandEvictionRange;
};
const rows = areaDemandMemoryGlobal.__pubmaxAreaDemandRows ??= [];

function rememberEvictions(evicted: readonly DemandRecord[]): void {
  if (evicted.length === 0) return;
  const previous = areaDemandMemoryGlobal.__pubmaxAreaDemandEvictionRange;
  let earliestCreatedAt =
    previous?.earliestCreatedAt ?? Number.POSITIVE_INFINITY;
  let latestCreatedAt =
    previous?.latestCreatedAt ?? Number.NEGATIVE_INFINITY;
  for (const row of evicted) {
    earliestCreatedAt = Math.min(earliestCreatedAt, row.createdAt);
    latestCreatedAt = Math.max(latestCreatedAt, row.createdAt);
  }
  areaDemandMemoryGlobal.__pubmaxAreaDemandEvictionRange = {
    earliestCreatedAt,
    latestCreatedAt,
  };
}

function areaKey(area: string): string {
  return area.toLowerCase();
}

type DemandSummaryRow = Omit<DemandRecord, "email">;

function emptySourceCounts(): Record<AreaDemandSource, number> {
  return { "near-empty": 0, "area-picker": 0, "map-miss": 0 };
}

function summariseRows(
  summaryRows: readonly DemandSummaryRow[],
  limit: number,
): AreaDemandSummary[] {
  const grouped = new Map<
    string,
    {
      area: string;
      areaKey: string;
      matchedPatchId: string | null;
      signalCount: number;
      sourceCounts: Record<AreaDemandSource, number>;
      firstSeen: number;
      lastSeen: number;
    }
  >();

  for (const row of summaryRows) {
    const key = `${row.areaKey}\u0000${row.matchedPatchId ?? ""}`;
    const existing = grouped.get(key);
    if (!existing) {
      const sourceCounts = emptySourceCounts();
      sourceCounts[row.source] = 1;
      grouped.set(key, {
        area: row.area,
        areaKey: row.areaKey,
        matchedPatchId: row.matchedPatchId,
        signalCount: 1,
        sourceCounts,
        firstSeen: row.createdAt,
        lastSeen: row.createdAt,
      });
      continue;
    }

    existing.signalCount += 1;
    existing.sourceCounts[row.source] += 1;
    existing.firstSeen = Math.min(existing.firstSeen, row.createdAt);
    if (row.createdAt >= existing.lastSeen) {
      existing.area = row.area;
      existing.lastSeen = row.createdAt;
    }
  }

  return [...grouped.values()]
    .sort(
      (a, b) =>
        b.signalCount - a.signalCount ||
        b.lastSeen - a.lastSeen ||
        a.areaKey.localeCompare(b.areaKey),
    )
    .slice(0, limit)
    .map((row) => ({
      ...row,
      firstSeen: new Date(row.firstSeen).toISOString(),
      lastSeen: new Date(row.lastSeen).toISOString(),
    }));
}

export const memoryAreaDemandStore: AreaDemandStore = {
  async record(input, now = Date.now()) {
    const area = normaliseArea(input.area);
    if (!area) return { status: "recorded", failed: true };
    rows.push({
      area,
      areaKey: areaKey(area),
      matchedPatchId: input.matchedPatchId ?? null,
      source: coerceAreaDemandSource(input.source),
      email: input.email ?? null,
      createdAt: now,
    });
    if (rows.length > MAX_ROWS) {
      rememberEvictions(rows.splice(0, rows.length - MAX_ROWS));
    }
    return { status: "recorded" };
  },

  async countForArea(area) {
    const key = areaKey(area.trim());
    if (!key) return 0;
    return rows.reduce((count, row) => (row.areaKey === key ? count + 1 : count), 0);
  },

  async listSummary(inputOptions, now = Date.now()) {
    const options = normaliseAreaDemandSummaryOptions(inputOptions);
    const cutoff = now - options.sinceDays * DAY_MS;
    const evicted = areaDemandMemoryGlobal.__pubmaxAreaDemandEvictionRange;
    return {
      items: summariseRows(
        rows.filter((row) => row.createdAt >= cutoff && row.createdAt <= now),
        options.limit,
      ),
      partial:
        evicted !== undefined &&
        evicted.latestCreatedAt >= cutoff &&
        evicted.earliestCreatedAt <= now,
      status: "ready",
    };
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "area-demand",
  tables: "area_demand",
  migrationHint: "apply migration 0045",
});

export const supabaseAreaDemandStore: AreaDemandStore = {
  async record(input, now = Date.now()) {
    const area = normaliseArea(input.area);
    if (!area) return { status: "recorded", failed: true };
    const iso = new Date(now).toISOString();
    return guard<RecordAreaDemandOutcome>({
      context: "record",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "area-demand",
          migrationHint: "apply migration 0045",
          fallback: () => memoryAreaDemandStore.record(input, now),
          onProduction: async (error) => {
            console.error(error.message);
            return { status: "recorded", failed: true };
          },
        }),
      message: "record failed — flagging degraded write",
      onError: () => ({ status: "recorded", failed: true }),
      run: async () => {
        const { error } = await requireSupabaseAdmin()
          .from("area_demand")
          .insert({
            area,
            area_key: areaKey(area),
            matched_patch_id: input.matchedPatchId ?? null,
            source: coerceAreaDemandSource(input.source),
            email: input.email ?? null,
            created_at: iso,
          });
        if (error) throw new Error(error.message);
        return { status: "recorded" };
      },
    });
  },

  async countForArea(area) {
    const key = areaKey(area.trim());
    if (!key) return 0;
    return guard<number>({
      context: "countForArea",
      onSchemaMiss: () => memoryAreaDemandStore.countForArea(area),
      message: "countForArea failed — returning 0",
      onError: () => 0,
      run: async () => {
        const { count, error } = await requireSupabaseAdmin()
          .from("area_demand")
          .select("*", { count: "exact", head: true })
          .eq("area_key", key);
        if (error) throw new Error(error.message);
        return typeof count === "number" ? count : 0;
      },
    });
  },

  async listSummary(inputOptions, now = Date.now()) {
    const options = normaliseAreaDemandSummaryOptions(inputOptions);
    const cutoff = new Date(now - options.sinceDays * DAY_MS).toISOString();
    const upper = new Date(now).toISOString();
    const degraded: AreaDemandSummaryResult = {
      items: [],
      partial: false,
      status: "degraded",
    };
    return guard<AreaDemandSummaryResult>({
      context: "listSummary",
      onSchemaMiss: async () => ({
        ...(await memoryAreaDemandStore.listSummary(options, now)),
        status: "degraded",
      }),
      message: "listSummary failed - returning no summary",
      onError: () => degraded,
      run: async () => {
        const summaryRows: DemandSummaryRow[] = [];
        let offset = 0;
        let rowsRead = 0;
        let exhausted = false;

        while (rowsRead < SUMMARY_ROW_CAP) {
          const pageSize = Math.min(
            SUMMARY_PAGE_SIZE,
            SUMMARY_ROW_CAP - rowsRead,
          );
          const { data, error } = await requireSupabaseAdmin()
            .from("area_demand")
            .select("id,area,area_key,matched_patch_id,source,created_at")
            .gte("created_at", cutoff)
            .lte("created_at", upper)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(offset, offset + pageSize - 1);
          if (error) throw new Error(error.message);

          const page = data ?? [];
          rowsRead += page.length;
          for (const raw of page) {
            const area = normaliseArea(raw.area);
            const createdAt = Date.parse(raw.created_at);
            if (!area || !Number.isFinite(createdAt)) continue;
            const storedAreaKey = normaliseArea(raw.area_key);
            summaryRows.push({
              area,
              areaKey: areaKey(storedAreaKey ?? area),
              matchedPatchId:
                typeof raw.matched_patch_id === "string"
                  ? raw.matched_patch_id
                  : null,
              source: coerceAreaDemandSource(raw.source),
              createdAt,
            });
          }

          if (page.length < pageSize) {
            exhausted = true;
            break;
          }
          offset += page.length;
        }

        return {
          items: summariseRows(summaryRows, options.limit),
          partial: !exhausted,
          status: "ready",
        };
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function areaDemandStore(): AreaDemandStore {
  return selectStore(memoryAreaDemandStore, supabaseAreaDemandStore);
}

/** Test-only: clear the in-memory rows and warn dedupe. */
export function __resetAreaDemand(): void {
  rows.length = 0;
  delete areaDemandMemoryGlobal.__pubmaxAreaDemandEvictionRange;
  resetSchemaMissWarnings();
}
