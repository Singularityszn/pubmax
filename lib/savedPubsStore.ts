// Durable saved-pub LISTS (cc_plan2 §5). ONE store interface, TWO implementations
// (process-memory + Supabase public.saved_pubs), same seam pattern as the other
// stores (reactions/comments/profiles): Supabase when env keys exist,
// process-memory otherwise. Every handler talks to the interface via
// savedPubsStore() so the backend is chosen in exactly one place.
//
// KEYING — the applied saved_pubs schema (migration 0006) has NO actor_hash
// column: it keys saves by `profile_id` (a FK to public.profiles) with a unique
// index on (profile_id, venue_id, list_type). Identity is still the self-asserted
// `handle` (no auth yet), so a handle's saves are made retrievable by bootstrapping
// a profile row for that handle (profileStore.ensure → profile_id) exactly the way
// the follow graph resolves a handle to a profile id. The `actorHash` a caller may
// pass is accepted for parity with the reactions/comments actor model and used as
// the memory-store partition key, but the durable path keys strictly by the
// handle's profile id — no invented columns.
//
// A DTO carries the resolved venue NAME + "open on the map" url (via lib/venueIndex,
// SERVER-side) so the profile never renders a raw "venue-…" id. Every method is
// FAIL-SOFT: a store error yields an empty list / an unchanged toggle rather than
// throwing to the caller, so a saved-pubs outage can never break the profile page.

import { normalizeHandle } from "@/lib/profiles";
import { supabaseProfileStore, type ProfileStore } from "@/lib/profileStore";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { cleanText } from "@/lib/textClean";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";

// The default list types a pub can be filed under. Ordered — the profile renders
// groups in this order. Kept in lockstep with lib/savedPubs.ts LIST_TYPES; this
// module is server-only (touches fs via venueIndex), so it owns the server-side
// copy the API validates against, avoiding a client<-server import of savedPubs.
export const LIST_TYPES = [
  "Want to Visit",
  "Cheap Pint",
  "Coding Pint",
  "Historic",
  "Date Night",
  "Crawl Stop",
  "Local Legend",
] as const;

export type ListType = (typeof LIST_TYPES)[number];

const LIST_TYPE_SET: ReadonlySet<string> = new Set(LIST_TYPES);

/** Server trust boundary: is `value` an allow-listed list type? Anything else is
 *  rejected by the route (never stored) — the client mirrors this list for UX. */
export function isListType(value: unknown): value is ListType {
  return typeof value === "string" && LIST_TYPE_SET.has(value);
}

// Cap the note like every other free-text field (mirrors lib/pintDrops clean()).
const MAX_NOTE = 280;

/** Strip inline HTML / control chars, collapse whitespace, cap length. Returns ""
 *  for a non-string or empty note. Delegates to the shared cleanText so the note
 *  trust boundary matches every other write path. */
export function cleanNote(value: unknown): string {
  return cleanText(value, MAX_NOTE);
}

// The public shape the profile renders. Carries the resolved venue NAME + map url
// so no consumer ever needs the raw id as a label. `venueName` falls back to a
// friendly string for an id the dataset no longer carries — never the raw id.
export type SavedPubDTO = {
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  listType: ListType;
  note?: string;
  savedAt: string;
};

// The write payload for a toggle. `handle` is the identity; `actorHash` is the
// optional device-parity key (used only by the memory partition). `venueId` +
// `listType` are the uniqueness key.
export type SaveInput = {
  handle: string;
  actorHash?: string;
  venueId: string;
  listType: ListType;
  note?: string;
};

// A saved row as the store holds it, before DTO enrichment.
type SavedRow = {
  venueId: string;
  listType: ListType;
  note?: string;
  savedAt: string;
};

export type SavedPubsStore = {
  /** All of a handle's saves, newest-first, as enriched DTOs. Never throws. */
  listSaved(input: { handle?: string; actorHash?: string }): Promise<SavedPubDTO[]>;
  /** Toggle a save (insert-or-delete on (owner, venue, list)); returns the fresh
   *  full list as DTOs. Never throws — a store error yields the current list. */
  toggleSaved(input: SaveInput): Promise<SavedPubDTO[]>;
};

// ── DTO enrichment (server-side venue-name resolution) ───────────────────────
// Fold raw rows into DTOs, resolving each venue id to its real pub name + map url
// through the bundled index. An id the dataset no longer carries falls back to a
// friendly label — never the raw "venue-…" id. Newest save first.
async function enrich(rows: SavedRow[]): Promise<SavedPubDTO[]> {
  const index = await getVenueIndex();
  return rows
    .map((row) => ({
      venueId: row.venueId,
      venueName: index.get(row.venueId)?.name ?? "A London pub",
      venueMapUrl: venueMapUrl(row.venueId),
      listType: row.listType,
      ...(row.note ? { note: row.note } : {}),
      savedAt: row.savedAt,
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

// ── Supabase implementation ──────────────────────────────────────────────────
const TABLE = "saved_pubs";

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase not configured.");
  return client;
}

// Resolve a handle to its profile id, bootstrapping a row on first save (mirrors
// how the follow graph resolves a handle → profile). Reads never create — only a
// toggle bootstraps, so a read for a handle that has saved nothing is a cheap miss.
async function profileIdForHandle(
  profiles: ProfileStore,
  handle: string,
  create: boolean,
): Promise<string | null> {
  const key = normalizeHandle(handle);
  if (!key) return null;
  if (create) return (await profiles.ensure(key)).id;
  const row = await profiles.getByHandle(key);
  return row?.id ?? null;
}

function rowFrom(raw: Record<string, unknown>): SavedRow | null {
  const venueId = typeof raw.venue_id === "string" ? raw.venue_id : "";
  const listType = raw.list_type;
  if (!venueId || !isListType(listType)) return null;
  return {
    venueId,
    listType,
    note: typeof raw.note === "string" && raw.note ? raw.note : undefined,
    savedAt: typeof raw.created_at === "string" ? raw.created_at : new Date(0).toISOString(),
  };
}

export const supabaseSavedPubsStore: SavedPubsStore = {
  async listSaved({ handle }) {
    try {
      const profileId = await profileIdForHandle(supabaseProfileStore, handle ?? "", false);
      if (!profileId) return [];
      const { data, error } = await admin()
        .from(TABLE)
        .select("venue_id, list_type, note, created_at")
        .eq("profile_id", profileId);
      if (error) throw new Error(error.message);
      const rows = (data ?? [])
        .map((r) => rowFrom(r as Record<string, unknown>))
        .filter((r): r is SavedRow => r !== null);
      return await enrich(rows);
    } catch {
      // Fail-soft: an outage renders as "no saves", never a 500 on the profile.
      return [];
    }
  },

  async toggleSaved(input) {
    const listType = input.listType;
    const venueId = input.venueId;
    try {
      const profileId = await profileIdForHandle(supabaseProfileStore, input.handle, true);
      if (!profileId || !venueId || !isListType(listType)) {
        return this.listSaved({ handle: input.handle });
      }

      // Is (profile, venue, list) already saved? A select decides insert vs delete.
      const { data: existing, error: readError } = await admin()
        .from(TABLE)
        .select("id")
        .eq("profile_id", profileId)
        .eq("venue_id", venueId)
        .eq("list_type", listType)
        .limit(1);
      if (readError) throw new Error(readError.message);

      if ((existing ?? []).length > 0) {
        const { error } = await admin()
          .from(TABLE)
          .delete()
          .eq("profile_id", profileId)
          .eq("venue_id", venueId)
          .eq("list_type", listType);
        if (error) throw new Error(error.message);
      } else {
        const note = cleanNote(input.note);
        const { error } = await admin().from(TABLE).insert({
          profile_id: profileId,
          venue_id: venueId,
          list_type: listType,
          note: note || null,
        });
        if (error) throw new Error(error.message);
      }

      return this.listSaved({ handle: input.handle });
    } catch {
      // A write failure is non-critical — return the current list unchanged so the
      // client can keep its localStorage fallback in play.
      return this.listSaved({ handle: input.handle });
    }
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Rows partitioned by an owner key derived from the handle (falling back to the
// actorHash), then keyed within a partition by (venueId, listType) so uniqueness
// matches the durable unique index. Resets on restart — right for dev/demo/test.
const memoryRows = new Map<string, Map<string, SavedRow>>();

// The partition key: a handle when present (identity), else the actorHash (device
// parity), else a shared "anon" bucket. Mirrors the durable "one owner = one
// profile" partitioning without a real profile id in memory.
function ownerKey(handle?: string, actorHash?: string): string {
  const h = normalizeHandle(handle ?? "");
  if (h) return `h:${h}`;
  if (actorHash && actorHash.trim()) return `a:${actorHash.trim()}`;
  return "anon";
}

function rowKey(venueId: string, listType: string): string {
  return `${venueId} ${listType}`;
}

export const memorySavedPubsStore: SavedPubsStore = {
  async listSaved({ handle, actorHash }) {
    const partition = memoryRows.get(ownerKey(handle, actorHash));
    return enrich(partition ? [...partition.values()] : []);
  },

  async toggleSaved(input) {
    const owner = ownerKey(input.handle, input.actorHash);
    if (!input.venueId || !isListType(input.listType)) {
      return this.listSaved({ handle: input.handle, actorHash: input.actorHash });
    }
    const partition = memoryRows.get(owner) ?? new Map<string, SavedRow>();
    const key = rowKey(input.venueId, input.listType);
    if (partition.has(key)) {
      partition.delete(key);
    } else {
      const note = cleanNote(input.note);
      partition.set(key, {
        venueId: input.venueId,
        listType: input.listType,
        ...(note ? { note } : {}),
        savedAt: new Date().toISOString(),
      });
    }
    memoryRows.set(owner, partition);
    return this.listSaved({ handle: input.handle, actorHash: input.actorHash });
  },
};

// The single seam: Supabase when configured, process-memory otherwise. Note the
// memory store uses the in-memory profile store implicitly (no profile id needed),
// so dev/demo/test never touch the network.
export function savedPubsStore(): SavedPubsStore {
  return isSupabaseConfigured() ? supabaseSavedPubsStore : memorySavedPubsStore;
}

/** Test-only: clear the in-memory saved-pub partitions between cases. */
export function __resetMemorySavedPubs(): void {
  memoryRows.clear();
}
