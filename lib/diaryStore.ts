// Diary store - dual backend (process-memory + Supabase public.diary_entries).
// Private to the owner actor. Service-role writes; RLS lets the owner SELECT
// their own rows and nothing else (migration 0174).

import "server-only";

import { randomUUID } from "node:crypto";

import {
  compareDiaryEntries,
  type DiaryEntry,
  type DiaryEntryDTO,
  type DiaryEntryFields,
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
export type DiaryCreateResult =
  | { status: "created"; entry: DiaryEntryDTO }
  | { status: "duplicate" };

export type DiaryListResult = {
  status: "ready" | "degraded";
  entries: DiaryEntryDTO[];
};

export type DiaryStore = {
  create(fields: DiaryEntryFields, now?: number): Promise<DiaryCreateResult>;
  listForOwner(ownerActor: string): Promise<DiaryListResult>;
};

function toDTO(row: DiaryEntry): DiaryEntryDTO {
  return { ...row };
}

function profileIdOf(ownerActor: string): string {
  return ownerActor.startsWith("profile:") ? ownerActor.slice("profile:".length) : "";
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, DiaryEntry>();

export const memoryDiaryStore: DiaryStore = {
  async create(fields, now = Date.now()) {
    for (const row of byId.values()) {
      if (
        row.ownerActor === fields.ownerActor
        && row.venueId === fields.venueId
        && row.visitedOn === fields.visitedOn
      ) {
        return { status: "duplicate" };
      }
    }
    const entry: DiaryEntry = {
      id: randomUUID(),
      ...fields,
      createdAt: new Date(now).toISOString(),
    };
    byId.set(entry.id, entry);
    return { status: "created", entry: toDTO(entry) };
  },

  async listForOwner(ownerActor) {
    const entries = Array.from(byId.values())
      .filter((row) => row.ownerActor === ownerActor)
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

function fromRow(row: Record<string, unknown>): DiaryEntry | null {
  const id = typeof row.id === "string" ? row.id : "";
  const profileId = typeof row.owner_profile_id === "string" ? row.owner_profile_id : "";
  const venueId = typeof row.venue_id === "string" ? row.venue_id : "";
  const visitedOn = typeof row.visited_on === "string" ? row.visited_on.slice(0, 10) : "";
  if (!id || !profileId || !venueId || !visitedOn) return null;
  // numeric(2,1) comes back as a number or a string such as "4.5".
  const rating = row.rating === null || row.rating === undefined
    ? null
    : parseRating(Number(row.rating));
  return {
    id,
    ownerActor: `profile:${profileId}`,
    venueId,
    venueName: typeof row.venue_name === "string" ? row.venue_name : "",
    visitedOn,
    rating,
    review: typeof row.review === "string" ? row.review : "",
    visibility: "private",
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
  };
}

const supabaseDiaryStore: DiaryStore = {
  async create(fields, now = Date.now()) {
    const profileId = profileIdOf(fields.ownerActor);
    if (!profileId) throw new Error("diary owner is not a profile actor");
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "diary",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryDiaryStore.create(fields, now),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .insert({
            owner_profile_id: profileId,
            venue_id: fields.venueId,
            venue_name: fields.venueName,
            visited_on: fields.visitedOn,
            rating: fields.rating,
            review: fields.review,
            visibility: fields.visibility,
            created_at: new Date(now).toISOString(),
          })
          .select("*")
          .single();
        if (isUniqueViolation(error)) return { status: "duplicate" as const };
        if (error) throw new Error(error.message);
        const entry = fromRow(data as Record<string, unknown>);
        if (!entry) throw new Error("diary insert returned an unreadable row");
        return { status: "created" as const, entry: toDTO(entry) };
      },
    });
  },

  async listForOwner(ownerActor) {
    const profileId = profileIdOf(ownerActor);
    if (!profileId) return { status: "ready", entries: [] };
    return guard({
      context: "list",
      onSchemaMiss: async () => memoryDiaryStore.listForOwner(ownerActor),
      onError: async () => ({ status: "degraded" as const, entries: [] }),
      message: "list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("owner_profile_id", profileId)
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
