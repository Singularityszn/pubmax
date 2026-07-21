// Structured Visit Reports store (Wayfinder 3.4) — the impure seam. ONE store
// interface, TWO implementations (process-memory + Supabase
// public.structured_visit_reports), chosen at the single visitReportsStore()
// seam, exactly like areaDemandStore / ratingsStore / priceConfirmStore.
//
// Supabase when env keys exist, process-memory otherwise. Before migration 0046
// lands (or on a schema-cache miss) the durable path fails soft to the in-memory
// store, so capture keeps working and becomes durable the moment the table
// exists — the same soft degradation vibe votes (#435) and area demand (#474)
// ship with. A HARD durable write failure throws so the route answers 503 (house
// rule: degraded dependency, never a fake success). Reads are fail-soft.
//
// Idempotent by construction: ONE report per handle per venue per night. A
// re-submission for the same (venueId, handle, visitedAt) UPDATES the existing
// row in place (same id) rather than stacking a second row.
//
// Moderation mirrors the Pint Drop machinery: a public `report` records a
// per-actor-deduped flag and hides the row once VISIT_REPORT_HIDE_THRESHOLD
// DISTINCT actors have flagged it; `listForReview("hidden")` feeds the admin
// queue; `moderate` restores or keeps-hidden and stamps the review.

import { randomUUID } from "crypto";

import { createFailSoftGuard, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  cleanAtmosphere,
  cleanBusyness,
  cleanPriceSanity,
  cleanWouldReturn,
  normalizeHandle,
  toVisitReportDTO,
  VISIT_REPORT_HIDE_THRESHOLD,
  type VisitReport,
  type VisitReportDTO,
  type VisitReportFields,
  type VisitReportStatus,
} from "@/lib/visitReports";

const TABLE = "structured_visit_reports";

/** Bounded public reads: a venue read never returns more than this many rows
 *  (also the cap on how many feed the recency-weighted summary). */
export const MAX_VENUE_REPORTS = 500;

export type VisitReportStore = {
  /**
   * Persist a validated report, upserting on (venueId, handle, visitedAt) so a
   * re-submission for the same night updates in place (one report per handle per
   * venue per night). Returns the public DTO. THROWS on a hard storage failure
   * (the route maps that to 503).
   */
  create(fields: VisitReportFields, now?: number): Promise<VisitReportDTO>;
  /** Public read: visible reports for a venue, newest-first, capped. Fail-soft
   *  ([] on storage error). */
  listForVenue(venueId: string): Promise<VisitReportDTO[]>;
  /** Moderator review queue: unreviewed reports in a status (with the full row
   *  incl. the report trail). Fail-soft ([] on storage error). */
  listForReview(status: "hidden"): Promise<VisitReport[]>;
  /**
   * Public report: record a per-actor-deduped flag; hides at
   * VISIT_REPORT_HIDE_THRESHOLD DISTINCT actors. Returns false for an unknown
   * id. A duplicate flag by the same actor is an idempotent no-op.
   */
  report(id: string, reason: string | undefined, actorHash: string): Promise<boolean>;
  /** Moderator decision: set the final status and stamp the review. False =
   *  unknown id. */
  moderate(id: string, status: VisitReportStatus, note?: string): Promise<boolean>;
};

function nightKey(venueId: string, handle: string, visitedAt: string): string {
  return `${venueId}::${handle}::${visitedAt}`;
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Flat id → report map plus a night-key → id index for the idempotent upsert.
// Resets on restart — right for dev/demo/test; production uses Supabase.
const byId = new Map<string, VisitReport>();
const idByNight = new Map<string, string>();

function memoryUpsert(fields: VisitReportFields, now: number): VisitReport {
  const key = nightKey(fields.venueId, fields.handle, fields.visitedAt);
  const existingId = idByNight.get(key);
  const createdAt = new Date(now).toISOString();
  if (existingId) {
    const prev = byId.get(existingId)!;
    // Update in place: refresh the structured fields + note + timestamp, keep
    // the id and any moderation state (a re-report of the same night doesn't
    // wipe a pending hide).
    const updated: VisitReport = {
      ...prev,
      busyness: fields.busyness,
      atmosphere: fields.atmosphere,
      wouldReturn: fields.wouldReturn,
      priceSanity: fields.priceSanity,
      note: fields.note,
      createdAt,
    };
    byId.set(existingId, updated);
    return updated;
  }
  const report: VisitReport = {
    id: randomUUID(),
    ...fields,
    status: "visible",
    createdAt,
  };
  byId.set(report.id, report);
  idByNight.set(key, report.id);
  return report;
}

export const memoryVisitReportStore: VisitReportStore = {
  async create(fields, now = Date.now()) {
    return toVisitReportDTO(memoryUpsert(fields, now));
  },

  async listForVenue(venueId) {
    return Array.from(byId.values())
      .filter((r) => r.venueId === venueId && r.status === "visible")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_VENUE_REPORTS)
      .map(toVisitReportDTO);
  },

  async listForReview(status) {
    return Array.from(byId.values())
      .filter((r) => r.status === status && !r.moderatedAt)
      .sort((a, b) => (b.reportedAt ?? b.createdAt).localeCompare(a.reportedAt ?? a.createdAt));
  },

  async report(id, reason, actorHash) {
    const hit = byId.get(id);
    if (!hit) return false;
    const actors = hit.reportActors ?? [];
    // Idempotent: a same-actor duplicate never bumps the counter twice.
    if (actors.includes(actorHash)) return true;
    const nextActors = [...actors, actorHash];
    hit.reportActors = nextActors;
    hit.reportCount = nextActors.length;
    hit.reportedAt = new Date().toISOString();
    if (reason) hit.reportReason = reason;
    if (nextActors.length >= VISIT_REPORT_HIDE_THRESHOLD) hit.status = "hidden";
    return true;
  },

  async moderate(id, status, note) {
    const hit = byId.get(id);
    if (!hit) return false;
    hit.status = status;
    hit.moderatedAt = new Date().toISOString();
    if (note) hit.moderatorNote = note;
    return true;
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, isSchemaMiss, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "visit-reports",
  tables: TABLE,
  migrationHint: "apply migration 0046",
});

function admin() {
  return requireSupabaseAdmin();
}

// snake_case row <-> camelCase VisitReport, in one place.
function toRow(report: VisitReport) {
  return {
    id: report.id,
    venue_id: report.venueId,
    handle: report.handle,
    visited_at: report.visitedAt,
    busyness: report.busyness,
    atmosphere: report.atmosphere,
    would_return: report.wouldReturn,
    price_sanity: report.priceSanity,
    note: report.note,
    status: report.status,
    report_count: report.reportCount ?? 0,
    report_actors: report.reportActors ?? [],
    reported_at: report.reportedAt ?? null,
    report_reason: report.reportReason ?? null,
    moderated_at: report.moderatedAt ?? null,
    moderator_note: report.moderatorNote ?? null,
    created_at: report.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): VisitReport {
  const actors = Array.isArray(row.report_actors)
    ? (row.report_actors as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    handle: String(row.handle),
    visitedAt: String(row.visited_at),
    // Re-coerce on the way out (defence in depth): a hand-edited row can't
    // smuggle an off-allowlist value into a public read.
    busyness: cleanBusyness(row.busyness),
    atmosphere: cleanAtmosphere(row.atmosphere),
    wouldReturn: cleanWouldReturn(row.would_return),
    priceSanity: cleanPriceSanity(row.price_sanity),
    note: typeof row.note === "string" ? row.note : "",
    status: row.status === "hidden" ? "hidden" : "visible",
    createdAt: String(row.created_at),
    reportCount: row.report_count == null ? undefined : Number(row.report_count),
    reportActors: actors.length ? actors : undefined,
    reportedAt: row.reported_at ? String(row.reported_at) : undefined,
    reportReason: row.report_reason ? String(row.report_reason) : undefined,
    moderatedAt: row.moderated_at ? String(row.moderated_at) : undefined,
    moderatorNote: row.moderator_note ? String(row.moderator_note) : undefined,
  };
}

/** Postgres unique_violation (23505): a concurrent insert raced us to the same
 *  (venue, handle, night) — fall through to an update of the existing row. */
function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

async function selectExistingId(fields: VisitReportFields): Promise<string | null> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("id")
    .eq("venue_id", fields.venueId)
    .eq("handle", fields.handle)
    .eq("visited_at", fields.visitedAt)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String((data as { id: unknown }).id) : null;
}

async function updateFields(id: string, fields: VisitReportFields, createdAt: string): Promise<void> {
  const { error } = await admin()
    .from(TABLE)
    .update({
      busyness: fields.busyness,
      atmosphere: fields.atmosphere,
      would_return: fields.wouldReturn,
      price_sanity: fields.priceSanity,
      note: fields.note,
      created_at: createdAt,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export const supabaseVisitReportStore: VisitReportStore = {
  async create(fields, now = Date.now()) {
    const createdAt = new Date(now).toISOString();
    return guard<VisitReportDTO>({
      context: "create",
      onSchemaMiss: () => memoryVisitReportStore.create(fields, now),
      // No onError: a hard write failure THROWS so the route answers 503.
      run: async () => {
        // Idempotent upsert (one per night): update in place when a row for this
        // (venue, handle, night) already exists, else insert a fresh id.
        const existingId = await selectExistingId(fields);
        if (existingId) {
          await updateFields(existingId, fields, createdAt);
          return toVisitReportDTO({ id: existingId, ...fields, status: "visible", createdAt });
        }
        const report: VisitReport = { id: randomUUID(), ...fields, status: "visible", createdAt };
        const { error } = await admin().from(TABLE).insert(toRow(report));
        if (error) {
          // A race inserted the row between our select and insert — update instead.
          if (isUniqueViolation(error)) {
            const raced = await selectExistingId(fields);
            if (raced) {
              await updateFields(raced, fields, createdAt);
              return toVisitReportDTO({ id: raced, ...fields, status: "visible", createdAt });
            }
          }
          throw new Error(error.message);
        }
        return toVisitReportDTO(report);
      },
    });
  },

  async listForVenue(venueId) {
    return guard<VisitReportDTO[]>({
      context: "listForVenue",
      onSchemaMiss: () => memoryVisitReportStore.listForVenue(venueId),
      message: "listForVenue failed — returning no reports",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("venue_id", venueId)
          .eq("status", "visible")
          .order("created_at", { ascending: false })
          .limit(MAX_VENUE_REPORTS);
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => toVisitReportDTO(fromRow(r as Record<string, unknown>)));
      },
    });
  },

  async listForReview(status) {
    return guard<VisitReport[]>({
      context: "listForReview",
      onSchemaMiss: () => memoryVisitReportStore.listForReview(status),
      message: "listForReview failed — returning empty queue",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("status", status)
          .is("moderated_at", null)
          .order("reported_at", { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      },
    });
  },

  async report(id, reason, actorHash) {
    return guard<boolean>({
      context: "report",
      onSchemaMiss: () => memoryVisitReportStore.report(id, reason, actorHash),
      // A report that can't be recorded should surface, not fake-succeed — but a
      // read/no-row case returns false. Non-schema errors throw → route 503.
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("id, status, report_count, report_actors")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return false;
        const row = data as {
          id: unknown;
          status: unknown;
          report_count: unknown;
          report_actors: unknown;
        };
        const actors = Array.isArray(row.report_actors)
          ? (row.report_actors as unknown[]).filter((a): a is string => typeof a === "string")
          : [];
        // Idempotent: a same-actor duplicate is a no-op (row unchanged).
        if (actors.includes(actorHash)) return true;
        const nextActors = [...actors, actorHash];
        const nextStatus =
          nextActors.length >= VISIT_REPORT_HIDE_THRESHOLD ? "hidden" : String(row.status ?? "visible");
        const { error: updateError } = await admin()
          .from(TABLE)
          .update({
            report_actors: nextActors,
            report_count: nextActors.length,
            reported_at: new Date().toISOString(),
            ...(reason ? { report_reason: reason } : {}),
            status: nextStatus,
          })
          .eq("id", id);
        if (updateError) throw new Error(updateError.message);
        return true;
      },
    });
  },

  async moderate(id, status, note) {
    return guard<boolean>({
      context: "moderate",
      onSchemaMiss: () => memoryVisitReportStore.moderate(id, status, note),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            status,
            moderated_at: new Date().toISOString(),
            ...(note ? { moderator_note: note } : {}),
          })
          .eq("id", id)
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function visitReportsStore(): VisitReportStore {
  return selectStore(memoryVisitReportStore, supabaseVisitReportStore);
}

/** Bound schema-miss predicate, exported for tests / callers that branch on it. */
export const isVisitReportsSchemaMiss = isSchemaMiss;

/** Test-only: clear the in-memory state + warn dedupe between cases. */
export function __resetVisitReports(): void {
  byId.clear();
  idByNight.clear();
  resetSchemaMissWarnings();
}
