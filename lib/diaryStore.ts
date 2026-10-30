// Diary store - dual backend (process-memory + Supabase public.diary_entries).
// Private to the owning account (its auth user id). Service-role writes; RLS
// lets the owner SELECT their own rows and nothing else (migration 0174).

import "server-only";

import { randomUUID } from "node:crypto";

import {
  compareDiaryEntries,
  type DiaryEntry,
  type DiaryEntryDTO,
  type DiaryEntryFields,
  type DiaryEntryPatch,
} from "@/lib/diary";
import { parseRating } from "@/lib/ratings";
import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  isUniqueViolation,
  onMissingDurableWrite,
} from "@/lib/storeBackend";

const TABLE = "diary_entries";
const MIGRATION_HINT = "apply migration 0174";

/** A second log of the same pub on the same London day is refused, never merged. */
type DiaryCreateResult =
  | { status: "created"; entry: DiaryEntryDTO }
  | { status: "duplicate" };

/** A correction can collide with another entry for the same pub and day. */
type DiaryUpdateResult =
  | { status: "updated"; entry: DiaryEntryDTO }
  | { status: "duplicate" }
  | { status: "not_found" };

type DiaryListResult = {
  status: "ready" | "degraded";
  entries: DiaryEntryDTO[];
};

export type DiaryStore = {
  create(fields: DiaryEntryFields, now?: number): Promise<DiaryCreateResult>;
  listForOwner(ownerUserId: string): Promise<DiaryListResult>;
  /** The owner's own entry, corrected in place. Never another account's. */
  update(ownerUserId: string, id: string, patch: DiaryEntryPatch): Promise<DiaryUpdateResult>;
  /** The owner's own entry, removed. False when it is not theirs or is gone. */
  delete(ownerUserId: string, id: string): Promise<boolean>;
};

function toDTO(row: DiaryEntry): DiaryEntryDTO {
  return { ...row };
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, DiaryEntry>();

export const memoryDiaryStore: DiaryStore = {
  async create(fields, now = Date.now()) {
    for (const row of byId.values()) {
      if (
        row.ownerUserId === fields.ownerUserId
        && row.venueId === fields.venueId
        && row.visitedOn === fields.visitedOn
      ) {
        return { status: "duplicate" };
      }
    }
    const entry: DiaryEntry = {
      id: randomUUID(),
      ...fields,
      usualDrink: fields.usualDrink ?? "",
      createdAt: new Date(now).toISOString(),
    };
    byId.set(entry.id, entry);
    return { status: "created", entry: toDTO(entry) };
  },

  async update(ownerUserId, id, patch) {
    const hit = byId.get(id);
    if (!hit || hit.ownerUserId !== ownerUserId) return { status: "not_found" };
    const visitedOn = patch.visitedOn ?? hit.visitedOn;
    for (const row of byId.values()) {
      if (
        row.id !== id
        && row.ownerUserId === ownerUserId
        && row.venueId === hit.venueId
        && row.visitedOn === visitedOn
      ) {
        return { status: "duplicate" };
      }
    }
    hit.visitedOn = visitedOn;
    if (patch.rating !== undefined) hit.rating = patch.rating;
    if (patch.review !== undefined) hit.review = patch.review;
    if (patch.usualDrink !== undefined) hit.usualDrink = patch.usualDrink;
    return { status: "updated", entry: toDTO(hit) };
  },

  async delete(ownerUserId, id) {
    const hit = byId.get(id);
    if (!hit || hit.ownerUserId !== ownerUserId) return false;
    byId.delete(id);
    return true;
  },

  async listForOwner(ownerUserId) {
    const entries = Array.from(byId.values())
      .filter((row) => row.ownerUserId === ownerUserId)
      .sort(compareDiaryEntries)
      .map(toDTO);
    return { status: "ready", entries };
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard } = createFailSoftGuard({
  tag: "diary",
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

/** PostgREST's answer for a column 0197 has not added yet. */
function isMissingUsualDrinkColumn(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? "";
  return (error.code === "42703" || error.code === "PGRST204") && /usual_drink/.test(message);
}

function fromRow(row: Record<string, unknown>): DiaryEntry | null {
  const id = typeof row.id === "string" ? row.id : "";
  const ownerUserId = typeof row.owner_user_id === "string" ? row.owner_user_id : "";
  const venueId = typeof row.venue_id === "string" ? row.venue_id : "";
  const visitedOn = typeof row.visited_on === "string" ? row.visited_on.slice(0, 10) : "";
  if (!id || !ownerUserId || !venueId || !visitedOn) return null;
  // numeric(2,1) comes back as a number or a string such as "4.5".
  const rating = row.rating === null || row.rating === undefined
    ? null
    : parseRating(Number(row.rating));
  return {
    id,
    ownerUserId,
    venueId,
    venueName: typeof row.venue_name === "string" ? row.venue_name : "",
    visitedOn,
    rating,
    review: typeof row.review === "string" ? row.review : "",
    // Absent until the captain applies 0197: an entry with no usual.
    usualDrink: typeof row.usual_drink === "string" ? row.usual_drink : "",
    visibility: "private",
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
  };
}

const supabaseDiaryStore: DiaryStore = {
  async create(fields, now = Date.now()) {
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "diary",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryDiaryStore.create(fields, now),
        }),
      run: async () => {
        const row: Record<string, unknown> = {
          owner_user_id: fields.ownerUserId,
          venue_id: fields.venueId,
          venue_name: fields.venueName,
          visited_on: fields.visitedOn,
          rating: fields.rating,
          review: fields.review,
          visibility: fields.visibility,
          created_at: new Date(now).toISOString(),
        };
        if (fields.usualDrink) row.usual_drink = fields.usualDrink;
        const insert = (values: Record<string, unknown>) =>
          admin().from(TABLE).insert(values).select("*").single();
        let { data, error } = await insert(row);
        // A deploy ahead of 0197 keeps the visit and loses the usual, the
        // 0153 receipt-photo rule: a visit is worth more than its footnote.
        if (error && "usual_drink" in row && isMissingUsualDrinkColumn(error)) {
          delete row.usual_drink;
          ({ data, error } = await insert(row));
        }
        if (isUniqueViolation(error)) return { status: "duplicate" as const };
        if (error) throw new Error(error.message);
        const entry = fromRow(data as Record<string, unknown>);
        if (!entry) throw new Error("diary insert returned an unreadable row");
        return { status: "created" as const, entry: toDTO(entry) };
      },
    });
  },

  async update(ownerUserId, id, patch) {
    return guard({
      context: "update",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "diary",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryDiaryStore.update(ownerUserId, id, patch),
        }),
      run: async () => {
        const columns: Record<string, unknown> = {};
        if (patch.visitedOn !== undefined) columns.visited_on = patch.visitedOn;
        if (patch.rating !== undefined) columns.rating = patch.rating;
        if (patch.review !== undefined) columns.review = patch.review;
        if (patch.usualDrink !== undefined) columns.usual_drink = patch.usualDrink;
        const { data, error } = await admin()
          .from(TABLE)
          .update(columns)
          .eq("id", id)
          .eq("owner_user_id", ownerUserId)
          .select("*")
          .maybeSingle();
        if (isUniqueViolation(error)) return { status: "duplicate" as const };
        if (error) throw new Error(error.message);
        if (!data) return { status: "not_found" as const };
        const entry = fromRow(data as Record<string, unknown>);
        if (!entry) throw new Error("diary update returned an unreadable row");
        return { status: "updated" as const, entry: toDTO(entry) };
      },
    });
  },

  async delete(ownerUserId, id) {
    return guard({
      context: "delete",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "diary",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryDiaryStore.delete(ownerUserId, id),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .delete()
          .eq("id", id)
          .eq("owner_user_id", ownerUserId)
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },

  async listForOwner(ownerUserId) {
    return guard({
      context: "list",
      onSchemaMiss: async () => memoryDiaryStore.listForOwner(ownerUserId),
      onError: async () => ({ status: "degraded" as const, entries: [] }),
      message: "list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("owner_user_id", ownerUserId)
          .order("visited_on", { ascending: false })
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        const entries = (data ?? [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((row): row is DiaryEntry => row !== null)
          .sort(compareDiaryEntries)
          .map(toDTO);
        return { status: "ready" as const, entries };
      },
    });
  },
};

export const diaryStore = createDualBackendStore(memoryDiaryStore, supabaseDiaryStore);

/** Test-only: clear the in-memory diary rows between cases. */
export function __resetDiary(): void {
  byId.clear();
}
