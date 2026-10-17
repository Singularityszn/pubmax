// Venue submission store - dual backend (process-memory + Supabase
// public.venue_submissions and public.venue_submission_files, migration 0181).
//
// This store PERSISTS a proposal and moves it through pending -> accepted,
// declined or duplicate. It NEVER writes a venue fact: no pack, no pin, no
// price lane reads these rows. An accepted submission reaches the map through
// the offline pack rebuild. Service-role writes; no browser role has a grant.
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
import { isDrinkCategory } from "@/lib/drinks";
import { cleanDrinkMeasure } from "@/lib/drinkMeasure";
import {
  isVenueSubmissionStatus,
  VENUE_SUBMISSION_MAX_FILES,
  VENUE_SUBMISSION_MAX_PENDING_PER_ACCOUNT,
  type VenueSubmission,
  type VenueSubmissionDecision,
  type VenueSubmissionFields,
  type VenueSubmissionFile,
  type VenueSubmissionPrice,
  type VenueSubmissionStatus,
} from "@/lib/venueSubmissions";

const TABLE = "venue_submissions";
const FILES_TABLE = "venue_submission_files";
const MIGRATION_HINT = "apply migration 0181";

/** Bounded reads: never return more than this many rows for one query. */
const MAX_REVIEW_ROWS = 200;
const MAX_OWNER_ROWS = 100;

type VenueSubmissionCreateResult =
  | { status: "created"; submission: VenueSubmission }
  | { status: "too_many_pending" };

type VenueSubmissionFileResult =
  | { status: "added"; file: VenueSubmissionFile }
  | { status: "not_found" }
  | { status: "too_many_files" };

type VenueSubmissionListResult = {
  status: "ready" | "degraded";
  submissions: VenueSubmission[];
};

type NewVenueSubmissionFile = Omit<VenueSubmissionFile, "createdAt">;

export type VenueSubmissionStore = {
  create(fields: VenueSubmissionFields, now?: number): Promise<VenueSubmissionCreateResult>;
  /** The owner's own submissions, newest first. Fail-soft (degraded, []). */
  listForOwner(ownerUserId: string): Promise<VenueSubmissionListResult>;
  /** One of the owner's own pending submissions, or null. Another account's reads as null. */
  getPendingForOwner(ownerUserId: string, id: string): Promise<VenueSubmission | null>;
  /** Record a stored menu file. Refuses past the per-submission cap. THROWS on hard failure. */
  addFile(file: NewVenueSubmissionFile, now?: number): Promise<VenueSubmissionFileResult>;
  /** Moderator queue: submissions in a status, newest first. Fail-soft ([]). */
  listForReview(status: VenueSubmissionStatus): Promise<VenueSubmission[]>;
  /** Moderator lookup of one submission. Fail-soft (null). */
  getById(id: string): Promise<VenueSubmission | null>;
  /** Moderator verdict on a PENDING submission. False when it is unknown or already decided. */
  decide(id: string, decision: VenueSubmissionDecision, now?: number): Promise<boolean>;
};

function byNewest(left: { createdAt: string }, right: { createdAt: string }): number {
  return right.createdAt.localeCompare(left.createdAt);
}

function applyDecision(row: VenueSubmission, decision: VenueSubmissionDecision, now: number): void {
  row.status = decision.status;
  row.duplicateOfVenueId = decision.status === "duplicate" ? decision.duplicateOfVenueId : null;
  row.reviewerNote = decision.note;
  row.reviewedAt = new Date(now).toISOString();
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, VenueSubmission>();

function copy(row: VenueSubmission): VenueSubmission {
  return { ...row, prices: row.prices.map((price) => ({ ...price })), files: row.files.map((file) => ({ ...file })) };
}

export const memoryVenueSubmissionStore: VenueSubmissionStore = {
  async create(fields, now = Date.now()) {
    const pending = [...byId.values()].filter(
      (row) => row.ownerUserId === fields.ownerUserId && row.status === "pending",
    ).length;
    if (pending >= VENUE_SUBMISSION_MAX_PENDING_PER_ACCOUNT) return { status: "too_many_pending" };
    const submission: VenueSubmission = {
      id: randomUUID(),
      ...fields,
      prices: fields.prices.map((price) => ({ ...price })),
      status: "pending",
      duplicateOfVenueId: null,
      reviewerNote: null,
      reviewedAt: null,
      createdAt: new Date(now).toISOString(),
      files: [],
    };
    byId.set(submission.id, submission);
    return { status: "created", submission: copy(submission) };
  },

  async listForOwner(ownerUserId) {
    const submissions = [...byId.values()]
      .filter((row) => row.ownerUserId === ownerUserId)
      .sort(byNewest)
      .slice(0, MAX_OWNER_ROWS)
      .map(copy);
    return { status: "ready", submissions };
  },

  async getPendingForOwner(ownerUserId, id) {
    const hit = byId.get(id);
    if (!hit || hit.ownerUserId !== ownerUserId || hit.status !== "pending") return null;
    return copy(hit);
  },

  async addFile(file, now = Date.now()) {
    const hit = byId.get(file.submissionId);
    if (!hit || hit.ownerUserId !== file.ownerUserId) return { status: "not_found" };
    if (hit.files.length >= VENUE_SUBMISSION_MAX_FILES) return { status: "too_many_files" };
    const stored: VenueSubmissionFile = { ...file, createdAt: new Date(now).toISOString() };
    hit.files.push(stored);
    return { status: "added", file: { ...stored } };
  },

  async listForReview(status) {
    return [...byId.values()]
      .filter((row) => row.status === status)
      .sort(byNewest)
      .slice(0, MAX_REVIEW_ROWS)
      .map(copy);
  },

  async getById(id) {
    const hit = byId.get(id);
    return hit ? copy(hit) : null;
  },

  async decide(id, decision, now = Date.now()) {
    const hit = byId.get(id);
    if (!hit || hit.status !== "pending") return false;
    applyDecision(hit, decision, now);
    return true;
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard } = createFailSoftGuard({
  tag: "venue-submissions",
  tables: [TABLE, FILES_TABLE],
  migrationHint: MIGRATION_HINT,
});

const SELECT_WITH_FILES = `*, ${FILES_TABLE}(*)`;

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The jsonb price array, re-read through the closed vocabulary. A line that no longer parses is dropped. */
function pricesFromRow(value: unknown): VenueSubmissionPrice[] {
  if (!Array.isArray(value)) return [];
  const prices: VenueSubmissionPrice[] = [];
  for (const line of value) {
    if (!line || typeof line !== "object") continue;
    const raw = line as Record<string, unknown>;
    const priceGbp = Number(raw.priceGbp);
    if (!isDrinkCategory(raw.drinkCategory) || !Number.isFinite(priceGbp)) continue;
    prices.push({
      drinkCategory: raw.drinkCategory,
      drinkName: readText(raw.drinkName),
      priceGbp,
      measure: cleanDrinkMeasure(raw.measure),
    });
  }
  return prices;
}

function fileFromRow(row: Record<string, unknown>): VenueSubmissionFile | null {
  const kind = row.kind === "pdf" ? "pdf" : row.kind === "image" ? "image" : null;
  const id = readText(row.id);
  const objectKey = readText(row.object_key);
  if (!kind || !id || !objectKey) return null;
  return {
    id,
    submissionId: readText(row.submission_id),
    ownerUserId: readText(row.owner_user_id),
    objectKey,
    kind,
    contentType: kind === "pdf" ? "application/pdf" : "image/jpeg",
    byteSize: Number(row.byte_size) || 0,
    sha256: readText(row.sha256),
    createdAt: readText(row.created_at) || new Date(0).toISOString(),
  };
}

function fromRow(row: Record<string, unknown>): VenueSubmission | null {
  const id = readText(row.id);
  const ownerUserId = readText(row.owner_user_id);
  if (!id || !ownerUserId || !isVenueSubmissionStatus(row.status)) return null;
  const rawFiles = Array.isArray(row[FILES_TABLE]) ? (row[FILES_TABLE] as Record<string, unknown>[]) : [];
  return {
    id,
    ownerUserId,
    name: readText(row.name),
    address: readText(row.address),
    postcode: readText(row.postcode),
    latitude: readCoordinate(row.latitude),
    longitude: readCoordinate(row.longitude),
    website: readText(row.website),
    menuUrl: readText(row.menu_url),
    openingHours: readText(row.opening_hours),
    note: readText(row.note),
    prices: pricesFromRow(row.prices),
    status: row.status,
    duplicateOfVenueId: readText(row.duplicate_of_venue_id) || null,
    reviewerNote: readText(row.reviewer_note) || null,
    reviewedAt: readText(row.reviewed_at) || null,
    createdAt: readText(row.created_at) || new Date(0).toISOString(),
    files: rawFiles
      .map(fileFromRow)
      .filter((file): file is VenueSubmissionFile => file !== null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}

function rows(data: unknown): VenueSubmission[] {
  return (Array.isArray(data) ? data : [])
    .map((row) => fromRow(row as Record<string, unknown>))
    .filter((row): row is VenueSubmission => row !== null);
}

const supabaseVenueSubmissionStore: VenueSubmissionStore = {
  async create(fields, now = Date.now()) {
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "venue-submissions",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryVenueSubmissionStore.create(fields, now),
        }),
      run: async () => {
        // A count then an insert, not one statement: two racing submits from one
        // account can land eleven, which the cap tolerates. It bounds a backlog,
        // it is not a uniqueness rule.
        const { count, error: countError } = await admin()
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("owner_user_id", fields.ownerUserId)
          .eq("status", "pending");
        if (countError) throw new Error(countError.message);
        if ((count ?? 0) >= VENUE_SUBMISSION_MAX_PENDING_PER_ACCOUNT) {
          return { status: "too_many_pending" as const };
        }
        const { data, error } = await admin()
          .from(TABLE)
          .insert({
            owner_user_id: fields.ownerUserId,
            name: fields.name,
            address: fields.address,
            postcode: fields.postcode,
            latitude: fields.latitude,
            longitude: fields.longitude,
            website: fields.website,
            menu_url: fields.menuUrl,
            opening_hours: fields.openingHours,
            note: fields.note,
            prices: fields.prices,
            created_at: new Date(now).toISOString(),
          })
          .select(SELECT_WITH_FILES)
          .single();
        if (error) throw new Error(error.message);
        const submission = fromRow(data as Record<string, unknown>);
        if (!submission) throw new Error("venue submission insert returned an unreadable row");
        return { status: "created" as const, submission };
      },
    });
  },

  async listForOwner(ownerUserId) {
    return guard({
      context: "list-owner",
      onSchemaMiss: () => memoryVenueSubmissionStore.listForOwner(ownerUserId),
      onError: async () => ({ status: "degraded" as const, submissions: [] }),
      message: "owner list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(SELECT_WITH_FILES)
          .eq("owner_user_id", ownerUserId)
          .order("created_at", { ascending: false })
          .limit(MAX_OWNER_ROWS);
        if (error) throw new Error(error.message);
        return { status: "ready" as const, submissions: rows(data) };
      },
    });
  },

  async getPendingForOwner(ownerUserId, id) {
    return guard({
      context: "get-owner",
      onSchemaMiss: () => memoryVenueSubmissionStore.getPendingForOwner(ownerUserId, id),
      onError: async () => null,
      message: "owner read failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(SELECT_WITH_FILES)
          .eq("id", id)
          .eq("owner_user_id", ownerUserId)
          .eq("status", "pending")
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? fromRow(data as Record<string, unknown>) : null;
      },
    });
  },

  async addFile(file, now = Date.now()) {
    return guard({
      context: "add-file",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "venue-submissions",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryVenueSubmissionStore.addFile(file, now),
        }),
      run: async () => {
        const { count, error: countError } = await admin()
          .from(FILES_TABLE)
          .select("id", { count: "exact", head: true })
          .eq("submission_id", file.submissionId)
          .eq("owner_user_id", file.ownerUserId);
        if (countError) throw new Error(countError.message);
        if ((count ?? 0) >= VENUE_SUBMISSION_MAX_FILES) return { status: "too_many_files" as const };
        const { data, error } = await admin()
          .from(FILES_TABLE)
          .insert({
            id: file.id,
            submission_id: file.submissionId,
            owner_user_id: file.ownerUserId,
            object_key: file.objectKey,
            kind: file.kind,
            content_type: file.contentType,
            byte_size: file.byteSize,
            sha256: file.sha256,
            created_at: new Date(now).toISOString(),
          })
          .select("*")
          .single();
        // 23503: the submission went (its owner deleted it or the account) between read and write.
        if (error?.code === "23503") return { status: "not_found" as const };
        if (error) throw new Error(error.message);
        const stored = fileFromRow(data as Record<string, unknown>);
        if (!stored) throw new Error("venue submission file insert returned an unreadable row");
        return { status: "added" as const, file: stored };
      },
    });
  },

  async listForReview(status) {
    return guard({
      context: "list-review",
      onSchemaMiss: () => memoryVenueSubmissionStore.listForReview(status),
      onError: async () => [],
      message: "review list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(SELECT_WITH_FILES)
          .eq("status", status)
          .order("created_at", { ascending: false })
          .limit(MAX_REVIEW_ROWS);
        if (error) throw new Error(error.message);
        return rows(data);
      },
    });
  },

  async getById(id) {
    return guard({
      context: "get",
      onSchemaMiss: () => memoryVenueSubmissionStore.getById(id),
      onError: async () => null,
      message: "read failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(SELECT_WITH_FILES)
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? fromRow(data as Record<string, unknown>) : null;
      },
    });
  },

  async decide(id, decision, now = Date.now()) {
    return guard({
      context: "decide",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "venue-submissions",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryVenueSubmissionStore.decide(id, decision, now),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            status: decision.status,
            duplicate_of_venue_id: decision.status === "duplicate" ? decision.duplicateOfVenueId : null,
            reviewer_note: decision.note,
            reviewed_at: new Date(now).toISOString(),
          })
          .eq("id", id)
          // Only a pending row moves: a second moderator's tap on a decided one is a no-op.
          .eq("status", "pending")
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },
};

export const venueSubmissionStore = createDualBackendStore(
  memoryVenueSubmissionStore,
  supabaseVenueSubmissionStore,
);

/** Test-only: clear the in-memory submissions between cases. */
export function __resetVenueSubmissions(): void {
  byId.clear();
}
