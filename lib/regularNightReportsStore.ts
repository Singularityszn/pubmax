// Regular night reports store - dual backend (process-memory + Supabase
// public.regular_night_reports and public.regular_night_report_still_on,
// migration 0200).
//
// This store PERSISTS a drinker's "there's a regular night here" report and
// moves it through open -> confirmed or hidden. It NEVER writes a venue fact:
// no pack, no pin, no hours and no listing reads these rows. Service-role
// writes; no browser role has a grant.
//
// EXPIRY IS A COLUMN, AND THE LIVE READ HONOURS IT. `listLive` returns open and
// confirmed rows whose `expires_at` is still ahead; a hidden row and an expired
// row never leave it. "Still on" is once per account per report: the
// `regular_night_report_still_on` primary key is the once.
//
// Reads are fail-soft. A HARD durable write failure THROWS so the route answers
// 503 rather than a fake success.

import "server-only";

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  isUniqueViolation,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import {
  isLiveRegularNightReport,
  isRegularNightReportKind,
  isRegularNightReportStatus,
  readRegularNightWeekday,
  REGULAR_NIGHT_REPORT_TTL_MS,
  type RegularNightReport,
  type RegularNightReportDecision,
  type RegularNightReportInput,
  type RegularNightReportStatus,
} from "@/lib/regularNightReports";

const TABLE = "regular_night_reports";
const STILL_ON_TABLE = "regular_night_report_still_on";
const MIGRATION_HINT = "apply migration 0200";
const STORE_TAG = "regular-night-reports";

/** Bounded reads: never return more than this many rows for one query. */
const MAX_LIVE_ROWS = 100;
const MAX_REVIEW_ROWS = 200;
const MAX_OWNER_ROWS = 200;
/** An expiry move races another "still on" at most this many times before it gives up. */
const STILL_ON_ATTEMPTS = 3;

type NewRegularNightReport = RegularNightReportInput & {
  id: string;
  photoKey: string;
  reporterUserId: string;
};

type RegularNightReportLiveQuery = { weekday?: number; venueId?: string };

type RegularNightReportListResult = {
  status: "ready" | "degraded";
  reports: RegularNightReport[];
};

type RegularNightStillOnResult = "extended" | "already" | "own" | "not_found";

export type RegularNightReportsStore = {
  /** Store one report. THROWS on a hard durable failure. */
  create(fields: NewRegularNightReport, now?: number): Promise<RegularNightReport>;
  /** Public read: open and confirmed rows not yet expired, for a weekday and or a pub. Fail-soft (degraded, []). */
  listLive(query: RegularNightReportLiveQuery, now?: number): Promise<RegularNightReportListResult>;
  /** Moderator queue: rows in a status, newest first. Fail-soft ([]). */
  listForReview(status: RegularNightReportStatus): Promise<RegularNightReport[]>;
  /** The reporter's own rows, newest first (account export). Fail-soft (degraded, []). */
  listForOwner(reporterUserId: string, limit?: number): Promise<RegularNightReportListResult>;
  /** One row by id. Fail-soft (null). */
  getById(id: string): Promise<RegularNightReport | null>;
  /**
   * A moderator verdict. Confirm moves an OPEN row; hide moves an open or a
   * confirmed one. False when the row is unknown or the move does not apply.
   * THROWS on hard failure.
   */
  decide(id: string, decision: RegularNightReportDecision, by: string, now?: number): Promise<boolean>;
  /**
   * A different account says the night is still on: once per account per
   * report, on a live row only. Moves `expiresAt` 90 days on and stamps
   * `lastSeenAt`. THROWS on hard failure.
   */
  stillOn(id: string, userId: string, now?: number): Promise<RegularNightStillOnResult>;
};

function byNewest(left: { createdAt: string }, right: { createdAt: string }): number {
  return right.createdAt.localeCompare(left.createdAt);
}

function matchesLiveQuery(row: RegularNightReport, query: RegularNightReportLiveQuery): boolean {
  if (query.weekday !== undefined && row.weekday !== query.weekday) return false;
  if (query.venueId !== undefined && row.venueId !== query.venueId) return false;
  return true;
}

function decisionApplies(status: RegularNightReportStatus, decision: RegularNightReportDecision): boolean {
  return decision === "confirmed" ? status === "open" : status !== "hidden";
}

function extendedExpiry(expiresAt: string): string {
  return new Date(Date.parse(expiresAt) + REGULAR_NIGHT_REPORT_TTL_MS).toISOString();
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, RegularNightReport>();
const stillOnBy = new Map<string, Set<string>>();

export const memoryRegularNightReportsStore: RegularNightReportsStore = {
  async create(fields, now = Date.now()) {
    const createdAt = new Date(now).toISOString();
    const row: RegularNightReport = {
      id: fields.id,
      venueId: fields.venueId,
      kind: fields.kind,
      weekday: fields.weekday,
      startTime: fields.startTime,
      note: fields.note,
      photoKey: fields.photoKey,
      reporterUserId: fields.reporterUserId,
      status: "open",
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: new Date(now + REGULAR_NIGHT_REPORT_TTL_MS).toISOString(),
      confirmedBy: null,
      confirmedAt: null,
    };
    byId.set(row.id, row);
    return { ...row };
  },

  async listLive(query, now = Date.now()) {
    const reports = [...byId.values()]
      .filter((row) => isLiveRegularNightReport(row, now) && matchesLiveQuery(row, query))
      .sort(byNewest)
      .slice(0, MAX_LIVE_ROWS)
      .map((row) => ({ ...row }));
    return { status: "ready", reports };
  },

  async listForReview(status) {
    return [...byId.values()]
      .filter((row) => row.status === status)
      .sort(byNewest)
      .slice(0, MAX_REVIEW_ROWS)
      .map((row) => ({ ...row }));
  },

  async listForOwner(reporterUserId, limit = MAX_OWNER_ROWS) {
    const reports = [...byId.values()]
      .filter((row) => row.reporterUserId === reporterUserId)
      .sort(byNewest)
      .slice(0, Math.max(1, Math.floor(limit)))
      .map((row) => ({ ...row }));
    return { status: "ready", reports };
  },

  async getById(id) {
    const hit = byId.get(id);
    return hit ? { ...hit } : null;
  },

  async decide(id, decision, by, now = Date.now()) {
    const hit = byId.get(id);
    if (!hit || !decisionApplies(hit.status, decision)) return false;
    hit.status = decision;
    if (decision === "confirmed") {
      hit.confirmedAt = new Date(now).toISOString();
      hit.confirmedBy = by;
    }
    return true;
  },

  async stillOn(id, userId, now = Date.now()) {
    const hit = byId.get(id);
    if (!hit || !isLiveRegularNightReport(hit, now)) return "not_found";
    if (hit.reporterUserId === userId) return "own";
    const seen = stillOnBy.get(id) ?? new Set<string>();
    if (seen.has(userId)) return "already";
    seen.add(userId);
    stillOnBy.set(id, seen);
    hit.expiresAt = extendedExpiry(hit.expiresAt);
    hit.lastSeenAt = new Date(now).toISOString();
    return "extended";
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: [TABLE, STILL_ON_TABLE],
  migrationHint: MIGRATION_HINT,
});

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fromRow(row: Record<string, unknown>): RegularNightReport | null {
  const id = readText(row.id);
  const reporterUserId = readText(row.reporter_user_id);
  const venueId = readText(row.venue_id);
  const photoKey = readText(row.photo_key);
  const weekday = readRegularNightWeekday(row.weekday);
  const createdAt = readText(row.created_at);
  const expiresAt = readText(row.expires_at);
  if (!id || !reporterUserId || !venueId || !photoKey || weekday === null || !createdAt || !expiresAt) return null;
  if (!isRegularNightReportKind(row.kind) || !isRegularNightReportStatus(row.status)) return null;
  return {
    id,
    venueId,
    kind: row.kind,
    weekday,
    startTime: readText(row.start_time) || null,
    note: readText(row.note),
    photoKey,
    reporterUserId,
    status: row.status,
    createdAt,
    lastSeenAt: readText(row.last_seen_at) || createdAt,
    expiresAt,
    confirmedBy: readText(row.confirmed_by) || null,
    confirmedAt: readText(row.confirmed_at) || null,
  };
}

function rows(data: unknown): RegularNightReport[] {
  return (Array.isArray(data) ? data : [])
    .map((row) => fromRow(row as Record<string, unknown>))
    .filter((row): row is RegularNightReport => row !== null);
}

async function readOne(id: string): Promise<RegularNightReport | null> {
  const { data, error } = await admin().from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data as Record<string, unknown>) : null;
}

const supabaseRegularNightReportsStore: RegularNightReportsStore = {
  async create(fields, now = Date.now()) {
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryRegularNightReportsStore.create(fields, now),
        }),
      run: async () => {
        const createdAt = new Date(now).toISOString();
        const { data, error } = await admin()
          .from(TABLE)
          .insert({
            id: fields.id,
            venue_id: fields.venueId,
            kind: fields.kind,
            weekday: fields.weekday,
            start_time: fields.startTime,
            note: fields.note,
            photo_key: fields.photoKey,
            reporter_user_id: fields.reporterUserId,
            created_at: createdAt,
            last_seen_at: createdAt,
            expires_at: new Date(now + REGULAR_NIGHT_REPORT_TTL_MS).toISOString(),
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        const stored = fromRow(data as Record<string, unknown>);
        if (!stored) throw new Error("regular night report insert returned an unreadable row");
        return stored;
      },
    });
  },

  async listLive(query, now = Date.now()) {
    return guard({
      context: "list-live",
      onSchemaMiss: () => memoryRegularNightReportsStore.listLive(query, now),
      onError: async () => ({ status: "degraded" as const, reports: [] }),
      message: "live list failed",
      run: async () => {
        let read = admin()
          .from(TABLE)
          .select("*")
          .in("status", ["open", "confirmed"])
          .gt("expires_at", new Date(now).toISOString());
        if (query.weekday !== undefined) read = read.eq("weekday", query.weekday);
        if (query.venueId !== undefined) read = read.eq("venue_id", query.venueId);
        const { data, error } = await read.order("created_at", { ascending: false }).limit(MAX_LIVE_ROWS);
        if (error) throw new Error(error.message);
        // The filter above is the rule; this is the same rule again, so a row
        // the query let through by mistake still never reaches a reader.
        return { status: "ready" as const, reports: rows(data).filter((row) => isLiveRegularNightReport(row, now)) };
      },
    });
  },

  async listForReview(status) {
    return guard({
      context: "list-review",
      onSchemaMiss: () => memoryRegularNightReportsStore.listForReview(status),
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

  async listForOwner(reporterUserId, limit = MAX_OWNER_ROWS) {
    return guard({
      context: "list-owner",
      onSchemaMiss: () => memoryRegularNightReportsStore.listForOwner(reporterUserId, limit),
      onError: async () => ({ status: "degraded" as const, reports: [] }),
      message: "owner list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("reporter_user_id", reporterUserId)
          .order("created_at", { ascending: false })
          .limit(Math.max(1, Math.floor(limit)));
        if (error) throw new Error(error.message);
        return { status: "ready" as const, reports: rows(data) };
      },
    });
  },

  async getById(id) {
    return guard({
      context: "get",
      onSchemaMiss: () => memoryRegularNightReportsStore.getById(id),
      onError: async () => null,
      message: "read failed",
      run: () => readOne(id),
    });
  },

  async decide(id, decision, by, now = Date.now()) {
    return guard({
      context: "decide",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryRegularNightReportsStore.decide(id, decision, by, now),
        }),
      run: async () => {
        const patch =
          decision === "confirmed"
            ? { status: decision, confirmed_at: new Date(now).toISOString(), confirmed_by: by }
            : { status: decision };
        const update = admin().from(TABLE).update(patch).eq("id", id);
        // Only a row the verdict applies to moves: a second tap is a no-op.
        const { data, error } = await (decision === "confirmed"
          ? update.eq("status", "open")
          : update.in("status", ["open", "confirmed"])
        ).select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },

  async stillOn(id, userId, now = Date.now()) {
    return guard({
      context: "still-on",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryRegularNightReportsStore.stillOn(id, userId, now),
        }),
      run: async (): Promise<RegularNightStillOnResult> => {
        const row = await readOne(id);
        if (!row || !isLiveRegularNightReport(row, now)) return "not_found";
        if (row.reporterUserId === userId) return "own";

        // The once: the primary key refuses a second row for this account.
        const claimed = await admin()
          .from(STILL_ON_TABLE)
          .insert({ report_id: id, user_id: userId, created_at: new Date(now).toISOString() });
        if (claimed.error) {
          if (isUniqueViolation(claimed.error)) return "already";
          throw new Error(claimed.error.message);
        }

        // Move the expiry from the value read, so two accounts saying "still
        // on" together each add their 90 days rather than one overwriting the other.
        let current = row;
        for (let attempt = 0; attempt < STILL_ON_ATTEMPTS; attempt += 1) {
          const { data, error } = await admin()
            .from(TABLE)
            .update({ expires_at: extendedExpiry(current.expiresAt), last_seen_at: new Date(now).toISOString() })
            .eq("id", id)
            .eq("expires_at", current.expiresAt)
            .select("id");
          if (error) throw new Error(error.message);
          if ((data ?? []).length > 0) return "extended";
          const reread = await readOne(id);
          if (!reread) return "not_found";
          current = reread;
        }
        throw new Error("regular night report expiry kept moving under the still-on write");
      },
    });
  },
};

export const regularNightReportsStore = createDualBackendStore(
  memoryRegularNightReportsStore,
  supabaseRegularNightReportsStore,
);

/** Test-only: clear the in-memory reports between cases. */
export function __resetRegularNightReports(): void {
  byId.clear();
  stillOnBy.clear();
}
