// Saved-venue LISTS — a demo, localStorage-backed store with a pure core.
//
// Saving a venue to a named list (Want to Visit, Cheap Pint, ...) is a DEMO
// feature: it lives in the browser's localStorage, not a backend, so it
// survives reloads on one device but nothing more (real per-account saves are a
// later epic). The persistence is a thin SSR-safe wrapper; all the list logic
// (dedupe, uniqueness, idempotent toggles) is pure and lives in
// upsertSaved/removeSaved so it can be unit-tested with no `window`.

import type { Route } from "next";
import { profilePath } from "@/lib/appLink";
import { savedListPath } from "@/lib/savedListUrl";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { isListTypeEligibleForVenue } from "@/lib/savedListPolicy";
import { safeLocalStorage } from "@/lib/safeStorage";
import { cleanText } from "@/lib/textClean";
import type { VenueKind } from "@/lib/venues";
import { authedFetch } from "@/lib/authedFetch";

// A list is now free text (built-in suggestion OR a custom name).
export type ListType = string;

export type SavedPub = {
  venueId: string;
  listType: ListType;
  note?: string;
  // ISO timestamp of when it was saved — lets the UI show newest-first.
  savedAt: string;
};

const STORAGE_KEY = "pubmax:savedPubs:v1";

// ── Pure core (no window, no storage) ────────────────────────────────────────
// A saved entry is unique by (venueId, listType): the same pub can live in many
// lists, but only once per list. This key is the identity used for dedupe.
function savedKey(venueId: string, listType: string): string {
  return `${venueId}.${listType}`;
}

function keyOf(entry: SavedPub): string {
  return savedKey(entry.venueId, entry.listType);
}

// Insert-or-update: returns a NEW list with `entry` present exactly once for its
// (venueId, listType). If an entry with that key already exists it is replaced
// (so re-saving updates the note/timestamp) in place — order is preserved and
// no duplicate is ever introduced. Idempotent given identical input.
export function upsertSaved(list: readonly SavedPub[], entry: SavedPub): SavedPub[] {
  const key = keyOf(entry);
  let replaced = false;
  const next = list.map((e) => {
    if (keyOf(e) === key) {
      replaced = true;
      return entry;
    }
    return e;
  });
  if (!replaced) next.push(entry);
  return next;
}

// Remove the entry matching (venueId, listType). Returns a NEW list; removing a
// missing key is a no-op that still returns a fresh array (idempotent).
export function removeSaved(
  list: readonly SavedPub[],
  venueId: string,
  listType: string,
): SavedPub[] {
  const key = savedKey(venueId, listType);
  return list.filter((e) => keyOf(e) !== key);
}

// Is (venueId, listType) present in the list?
export function isSaved(
  list: readonly SavedPub[],
  venueId: string,
  listType: string,
): boolean {
  const key = savedKey(venueId, listType);
  return list.some((e) => keyOf(e) === key);
}

// Group a flat list into { listType: SavedPub[] }, only including lists that
// have at least one pub. Within a group, newest save first.
export function groupByList(list: readonly SavedPub[]): Partial<Record<ListType, SavedPub[]>> {
  const groups: Partial<Record<ListType, SavedPub[]>> = {};
  for (const entry of list) {
    (groups[entry.listType] ??= []).push(entry);
  }
  for (const key of Object.keys(groups) as ListType[]) {
    groups[key]!.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  return groups;
}

// ── localStorage-backed store (SSR-safe) ─────────────────────────────────────
// Every entry point guards storage, so importing/calling on the server is safe
// (getSaved returns [], writers are no-ops). The store is only meaningful in the
// browser — that's the demo boundary. The localStorage getter itself throws
// SecurityError when site data is blocked, so the check goes through
// safeLocalStorage rather than reading the property bare.
function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

// A list type is now free text (built-in OR custom), so any non-empty, sanely
// bounded string is valid for the localStorage store. This keeps custom lists
// (story 33) round-tripping through the signed-out fallback too.
const MAX_LIST_TYPE = 60;
export function cleanListType(value: unknown): ListType {
  return cleanText(value, MAX_LIST_TYPE);
}

function isListType(value: unknown): value is ListType {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_LIST_TYPE;
}

// Parse defensively: bad JSON, a non-array, or malformed rows never throw —
// they yield a clean, valid list. Unknown list types are dropped.
function parse(raw: string | null): SavedPub[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SavedPub[] = [];
  for (const item of data) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as SavedPub).venueId === "string" &&
      isListType((item as SavedPub).listType)
    ) {
      const row = item as SavedPub;
      out.push({
        venueId: row.venueId,
        listType: row.listType,
        note: typeof row.note === "string" ? row.note : undefined,
        savedAt: typeof row.savedAt === "string" ? row.savedAt : new Date(0).toISOString(),
      });
    }
  }
  return out;
}

export function getSaved(): SavedPub[] {
  if (!hasStorage()) return [];
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function write(list: SavedPub[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full / disabled / private mode — the demo degrades silently.
  }
}

// Toggle a pub in a list: if (venueId, listType) is already saved it is removed;
// otherwise it is added (with an optional note). Returns the new full list so
// callers can update React state from the handler's return value without a
// second read.
function toggleSave(
  venueId: string,
  listType: ListType,
  note?: string,
  venueKind?: VenueKind,
): SavedPub[] {
  const current = getSaved();
  const cleanedListType = cleanListType(listType);
  if (
    !cleanedListType ||
    !isListTypeEligibleForVenue(cleanedListType, venueKind)
  ) {
    return current;
  }
  const next = isSaved(current, venueId, cleanedListType)
    ? removeSaved(current, venueId, cleanedListType)
    : upsertSaved(current, {
        venueId,
        listType: cleanedListType,
        note: note && note.trim() ? note.trim() : undefined,
        savedAt: new Date().toISOString(),
      });
  write(next);
  return next;
}

/**
 * The same saves, each under the id its venue carries now. A venue whose id was
 * merged or superseded keeps one save per list, never two, so the "Saved only"
 * filter, the sheet's toggle and the profile list all see one save for it.
 * Pure: the first save per (venue, list) wins.
 */
export function canonicalizeSaved(
  list: readonly SavedPub[],
  canonical: (venueId: string) => string,
): SavedPub[] {
  let next: SavedPub[] = [];
  for (const entry of list) {
    const venueId = canonical(entry.venueId);
    if (isSaved(next, venueId, entry.listType)) continue;
    next = [...next, venueId === entry.venueId ? entry : { ...entry, venueId }];
  }
  return next;
}

/** Rewrite this device's saves under their venues' current ids. Returns the list held. */
export function canonicalizeStoredSaved(canonical: (venueId: string) => string): SavedPub[] {
  const current = getSaved();
  const next = canonicalizeSaved(current, canonical);
  if (next.length !== current.length || next.some((entry, index) => entry !== current[index])) {
    write(next);
  }
  return next;
}

// Read + group in one call for the profile view.
export function savedByList(): Partial<Record<ListType, SavedPub[]>> {
  return groupByList(getSaved());
}

// ── Durable path (Supabase-backed, via the API) ──────────────────────────────
// A signed-in-by-handle viewer's saves live server-side (public.saved_pubs, keyed
// by the handle's profile id); a signed-out/offline viewer keeps the localStorage
// fallback above. These thin wrappers call /api/saved-pubs when a handle exists,
// degrading to the local store on any failure so the demo never blocks on the
// network. The DTO the API returns carries the resolved venue NAME + map url — the
// profile renders those, never a raw id.

// The public DTO shape the API returns (mirrors lib/savedPubsStore.ts SavedPubDTO).
// Kept here (not imported) so this client module never pulls in the server-only
// store (which touches `fs` via venueIndex).
export type SavedPubDTO = {
  venueId: string;
  venueName: string;
  venueMapUrl: Route;
  listType: ListType;
  note?: string;
  savedAt: string;
};

export type FollowedSavedListDTO = {
  ownerHandle: string;
  ownerProfileUrl: Route;
  listType: ListType;
  listUrl: Route;
  savedCount: number;
  followerCount: number;
  followedAt: string;
};

// Parse an untrusted API payload into clean DTOs. A bad shape yields [] — the
// caller then falls back to localStorage, never renders junk.
function parseDTOs(data: unknown): SavedPubDTO[] {
  if (!data || typeof data !== "object") return [];
  const saved = (data as { saved?: unknown }).saved;
  if (!Array.isArray(saved)) return [];
  const out: SavedPubDTO[] = [];
  for (const item of saved) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as SavedPubDTO).venueId === "string" &&
      isListType((item as SavedPubDTO).listType)
    ) {
      const row = item as SavedPubDTO;
      out.push({
        venueId: row.venueId,
        venueName:
          typeof row.venueName === "string" && row.venueName
            ? row.venueName
            : "A London venue",
        venueMapUrl:
          typeof row.venueMapUrl === "string" && row.venueMapUrl
            ? // The server builds this field with venueMapUrl().
              (row.venueMapUrl as Route)
            : `/map?sel=${encodeURIComponent(row.venueId)}`,
        listType: row.listType,
        note: typeof row.note === "string" ? row.note : undefined,
        savedAt: typeof row.savedAt === "string" ? row.savedAt : new Date(0).toISOString(),
      });
    }
  }
  return out;
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function parseFollowedLists(data: unknown): FollowedSavedListDTO[] {
  if (!data || typeof data !== "object") return [];
  const followedLists = (data as { followedLists?: unknown }).followedLists;
  if (!Array.isArray(followedLists)) return [];

  const out: FollowedSavedListDTO[] = [];
  for (const item of followedLists) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as FollowedSavedListDTO).ownerHandle === "string" &&
      isListType((item as FollowedSavedListDTO).listType)
    ) {
      const row = item as FollowedSavedListDTO;
      const ownerHandle = normalizeHandle(row.ownerHandle);
      const listType = cleanListType(row.listType);
      if (!ownerHandle || !isListType(listType)) continue;
      out.push({
        ownerHandle,
        ownerProfileUrl: profilePath(ownerHandle),
        listType,
        listUrl: savedListPath(ownerHandle, listType),
        savedCount: positiveNumber(row.savedCount),
        followerCount: positiveNumber(row.followerCount),
        followedAt:
          typeof row.followedAt === "string" ? row.followedAt : new Date(0).toISOString(),
      });
    }
  }
  return out;
}

// Group the durable DTOs by list type (newest-first within a group), reusing the
// pure grouping via the DTO's list/savedAt fields.
export function groupDTOsByList(list: readonly SavedPubDTO[]): Partial<Record<ListType, SavedPubDTO[]>> {
  const groups: Partial<Record<ListType, SavedPubDTO[]>> = {};
  for (const entry of list) {
    (groups[entry.listType] ??= []).push(entry);
  }
  for (const key of Object.keys(groups) as ListType[]) {
    groups[key]!.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  return groups;
}

/**
 * Fetch a handle's durable saved pubs (server-resolved venue names). Returns the
 * flat DTO list, or null when there is no handle / the request failed — callers
 * fall back to the localStorage view (savedByList) on null. Never throws.
 */
export async function fetchSavedForHandle(
  handle: string,
  signal?: AbortSignal,
): Promise<SavedPubDTO[] | null> {
  const h = handle.trim();
  if (!h) return null;
  try {
    const res = await authedFetch(
      `/api/saved-pubs?handle=${encodeURIComponent(h)}`,
      { signal },
      { requiresIdentity: true },
    );
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    return parseDTOs(await res.json());
  } catch {
    // Aborted / offline — the caller keeps the local fallback.
    return null;
  }
}

export async function fetchFollowedListsForHandle(
  handle: string,
  signal?: AbortSignal,
): Promise<FollowedSavedListDTO[]> {
  const h = handle.trim();
  if (!h) return [];
  try {
    const res = await authedFetch(
      `/api/saved-pubs/list-follows?follower=${encodeURIComponent(h)}`,
      { signal },
      { requiresIdentity: true },
    );
    if (!res.ok) {
      discardBody(res);
      return [];
    }
    return parseFollowedLists(await res.json());
  } catch {
    return [];
  }
}

/**
 * Durable toggle: POST to the API when a handle exists, mirroring the change into
 * localStorage so a later signed-out read still reflects it, and returning the
 * fresh DTO list. With no handle (or on any failure) it toggles the local store
 * only and returns null. With no handle the caller reads the local view; with a
 * handle, null means the press is unconfirmed. Never throws.
 */
export async function toggleSaveDurable(
  handle: string,
  venueId: string,
  listType: ListType,
  note?: string,
  venueKind?: VenueKind,
): Promise<SavedPubDTO[] | null> {
  const cleanedListType = cleanListType(listType);
  if (
    !cleanedListType ||
    !isListTypeEligibleForVenue(cleanedListType, venueKind)
  ) {
    return null;
  }
  // Always keep the local store in sync so a signed-out reload still shows saves.
  toggleSave(venueId, cleanedListType, note, venueKind);
  const h = handle.trim();
  if (!h) return null;
  try {
    const res = await authedFetch("/api/saved-pubs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: h, venueId, listType: cleanedListType, note }),
    }, { requiresIdentity: true });
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    return parseDTOs(await res.json());
  } catch {
    return null;
  }
}
