import "server-only";

// "I'm here tonight" presence (PRD §1.5 / §5.1 — the tonight loop). ONE seam,
// TWO backends: Supabase (public.pub_presence, migration 0007) when env keys
// exist, process-memory otherwise — the same Supabase-or-memory pattern as
// lib/reactionsStore / lib/pintDropsStore, chosen at ONE factory
// (presenceStore()).
//
// A presence row is opt-in and ephemeral: the viewer taps "I'm here" at a
// selected venue. See markPresence below for replacement and expiry rules.
// There is NO auto-tracking and NO GPS — the only signal is the deliberate tap.
//
// Trust boundary: the public DTO carries the pub NAME + a "/map?sel=…" link
// (resolved server-side via lib/venueIndex, so no raw content-hashed venue id
// leaks), the handle, and a timestamp — never the actor_hash. Every read is
// fail-soft: an outage yields [] so the "Live tonight" strip degrades to nothing
// rather than a broken band.

import { HANDLE_MAX } from "@/lib/handleNormalize";
import { ambientPresenceRows } from "@/lib/ambientPresence";
import { requireSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { selectStore, whereVenueIdIn } from "@/lib/storeBackend";
import { storedVenueIds } from "@/lib/venueAliases";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";
import { PRESENCE_TTL_MS, type PresenceDTO, type PresenceInput } from "@/lib/presence";

export { PRESENCE_TTL_MS, type PresenceDTO, type PresenceInput } from "@/lib/presence";

// How many rows one presence read returns — the strip is a glance, not a list.
const MAX_PRESENCE = 40;

const MAX_VENUE_ID = 64;

const TABLE = "pub_presence";

// The friendly label a card shows when an id has no resolvable pub name — kept
// in step with lib/pintDrops route VENUE_FALLBACK_LABEL / venueIndex.venueLabel.
const VENUE_FALLBACK_LABEL = "A London pub";

// Same clean() family as lib/pintDrops: strip inline HTML/control chars,
// collapse whitespace, cap. The route validates first; this is the store's own
// last line of defence so markPresence is safe to call directly (tests, future
// callers).
function clean(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

type PresenceStore = {
  mark(input: PresenceInput, now?: number): Promise<void>;
  recent(venueId?: string, now?: number, handles?: readonly string[]): Promise<PresenceDTO[]>;
};

// Enrich a raw (handle, venueId, at) row into a public DTO with the pub name +
// map link. Batched against the one memoized venue index (a single Map read per
// row). Never surfaces the raw id: an unresolved id falls back to a friendly
// label, matching the feed/permalink cards.
async function enrich(
  rows: { handle: string; venueId: string; at: string }[],
): Promise<PresenceDTO[]> {
  const index = await getVenueIndex();
  return rows.map((row) => ({
    handle: row.handle,
    venueId: row.venueId,
    venueName: index.get(row.venueId)?.name ?? VENUE_FALLBACK_LABEL,
    venueMapUrl: venueMapUrl(row.venueId),
    at: row.at,
  }));
}

// ── In-memory backend ────────────────────────────────────────────────────────
// One row per actor — a Map keyed on actor_hash, so a re-mark refreshes and a
// mark at another pub moves the person there. Resets on restart (test/dev/demo).
// The injectable clock lets tests drive expiry deterministically.
type MemoryRow = { handle: string; venueId: string; actorHash: string; expiresAt: number };
const memoryRows = new Map<string, MemoryRow>();

function memoryMark(input: PresenceInput, now: number): void {
  const handle = clean(input.handle, HANDLE_MAX);
  const venueId = clean(input.venueId, MAX_VENUE_ID);
  if (!handle || !venueId || !input.actorHash) return;
  for (const [actorHash, row] of memoryRows) {
    if (row.handle === handle && actorHash !== input.actorHash) memoryRows.delete(actorHash);
  }
  // One row per actor: re-marking is a refresh (new expiry, latest handle), and
  // a mark at another pub replaces the old one. Nobody is at two pubs at once.
  memoryRows.set(input.actorHash, {
    handle,
    venueId,
    actorHash: input.actorHash,
    expiresAt: now + PRESENCE_TTL_MS,
  });
}

// Non-expired rows (server-filtered `expiresAt > now`), newest-first, capped.
// Optionally scoped to one venue. Returns the raw pre-enrichment rows; enrich()
// adds the pub name + map link.
function memoryRecent(
  venueIds: readonly string[] | undefined,
  now: number,
  handles?: readonly string[],
): { handle: string; venueId: string; at: string }[] {
  const live: { handle: string; venueId: string; expiresAt: number }[] = [];
  for (const row of memoryRows.values()) {
    if (row.expiresAt <= now) continue;
    if (venueIds && !venueIds.includes(row.venueId)) continue;
    if (handles && !handles.includes(row.handle)) continue;
    live.push({ handle: row.handle, venueId: row.venueId, expiresAt: row.expiresAt });
  }
  // Newest-first: a fresher mark has a later expiry (created_at + fixed TTL), so
  // ordering by expiry is equivalent to ordering by mark time.
  live.sort((a, b) => b.expiresAt - a.expiresAt);
  return live
    .slice(0, MAX_PRESENCE)
    .map((row) => ({
      handle: row.handle,
      venueId: row.venueId,
      at: new Date(row.expiresAt - PRESENCE_TTL_MS).toISOString(),
    }));
}

const memoryPresenceStore: PresenceStore = {
  async mark(input, now = Date.now()) {
    memoryMark(input, now);
  },
  async recent(venueId, now = Date.now(), handles) {
    const scoped = venueId ? clean(venueId, MAX_VENUE_ID) : undefined;
    try {
      return await enrich(
        memoryRecent(scoped ? await storedVenueIds(scoped) : undefined, now, handles),
      );
    } catch (err) {
      console.warn(
        "[presence] read failed (strip degrades to empty):",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  },
};

const supabasePresenceStore: PresenceStore = {
  async mark(input, now = Date.now()) {
    const handle = clean(input.handle, HANDLE_MAX);
    const venueId = clean(input.venueId, MAX_VENUE_ID);
    if (!handle || !venueId || !input.actorHash) return;
    const at = new Date(now).toISOString();
    const expiresAt = new Date(now + PRESENCE_TTL_MS).toISOString();
    const admin = requireSupabaseAdmin();
    const reconciled = await admin.from(TABLE).delete().eq("handle", handle).neq("actor_hash", input.actorHash);
    if (reconciled.error) throw new Error(reconciled.error.message);
    // One pub per person: leave any other pub first (0229 makes it a unique key).
    const left = await admin.from(TABLE).delete().eq("actor_hash", input.actorHash).neq("venue_id", venueId);
    if (left.error) throw new Error(left.error.message);
    // onConflict on the (actor_hash, venue_id) unique index → refresh in place.
    const { error } = await admin
      .from(TABLE)
      .upsert(
        {
          handle,
          venue_id: venueId,
          actor_hash: input.actorHash,
          created_at: at,
          expires_at: expiresAt,
        },
        { onConflict: "actor_hash,venue_id" },
      );
    // A tap that did not land is told so: the route answers 503, never ok.
    if (error) throw new Error(error.message);
  },

  async recent(venueId, now = Date.now(), handles) {
    if (handles?.length === 0) return [];
    const scoped = venueId ? clean(venueId, MAX_VENUE_ID) : undefined;
    try {
      // Store read: non-expired only (mirrors the RLS `expires_at > now()`),
      // newest-first by created_at, capped.
      let query = requireSupabaseAdmin()
        .from(TABLE)
        .select("handle, venue_id, created_at")
        .gt("expires_at", new Date(now).toISOString())
        .order("created_at", { ascending: false })
        .limit(MAX_PRESENCE);
      if (scoped) query = whereVenueIdIn(query, await storedVenueIds(scoped));
      if (handles) query = query.in("handle", [...handles]);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as { handle: string; venue_id: string; created_at: string }[]).map(
        (row) => ({ handle: row.handle, venueId: row.venue_id, at: row.created_at }),
      );
      return await enrich(rows);
    } catch (err) {
      // Fail-soft: the strip renders nothing rather than a broken band.
      console.warn(
        "[presence] read failed (strip degrades to empty):",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  },
};

/** The single backend selection point (mirrors the other stores). */
function presenceStore(): PresenceStore {
  return selectStore(memoryPresenceStore, supabasePresenceStore);
}

// ── Compatibility wrappers (route + tests keep calling these) ────────────────

/**
 * Mark the viewer present at a venue: one row per person. It sets the handle,
 * stamps created_at=now, expires_at=now+2h — a re-mark REFRESHES the row, and a
 * mark at another pub moves the person there. Supabase when configured, memory
 * otherwise. The `now` clock is injectable for the memory path. THROWS when the
 * write fails, so the tap is never told it landed when it did not.
 */
export async function markPresence(input: PresenceInput, now = Date.now()): Promise<void> {
  await presenceStore().mark(input, now);
}

/**
 * Recent, non-expired presence — newest-first, capped, optionally scoped to one
 * venue. Each row is enriched with the pub NAME + a "/map?sel=…" link; the public
 * DTO carries NO actor_hash. Fail-soft: any error (or an unconfigured/unreadable
 * backend) resolves to [] so the "Live tonight" strip degrades to nothing.
 * `handles` filters real rows before the cap. An empty list allows no real rows.
 * Omitting it disables audience filtering, so HTTP callers must supply the
 * authorised list.
 */
export async function recentPresence(
  venueId?: string,
  now = Date.now(),
  handles?: readonly string[],
): Promise<PresenceDTO[]> {
  return presenceStore().recent(venueId, now, handles);
}

/**
 * GET /api/presence reads recent presence plus the deterministic ambient demo
 * layer. The audience argument follows recentPresence. Demo rows remain outside
 * the audience filter. Two hard rules:
 *
 * - Supabase configured → REAL presence only, byte-for-byte recentPresence().
 *   Ambient demo rows never mix into (or override) live data.
 * - Fallback (memory/demo) → real in-process taps first, then enabled ambient
 *   rows from lib/ambientPresence (see lib/demoContent for the opt-in), each tagged
 *   provenance:"demo" so the strip renders the honest Demo chip. A real tap at
 *   the same (handle, venue) wins over its ambient twin. Capped at MAX_PRESENCE.
 */
export async function recentPresenceWithAmbient(
  venueId?: string,
  now = Date.now(),
  handles?: readonly string[],
): Promise<PresenceDTO[]> {
  const real = await recentPresence(venueId, now, handles);
  if (isSupabaseConfigured()) return real;

  try {
    const scoped = venueId ? clean(venueId, MAX_VENUE_ID) : undefined;
    const seen = new Set(real.map((row) => `${row.handle}|${row.venueId}`));
    const ambient = (await enrich(ambientPresenceRows(new Date(now), scoped)))
      .filter((row) => !seen.has(`${row.handle}|${row.venueId}`))
      .map((row): PresenceDTO => ({ ...row, provenance: "demo" }));
    return [...real, ...ambient].slice(0, MAX_PRESENCE);
  } catch (err) {
    // Fail-soft like every other presence read: an ambient hiccup must never
    // break the real rows.
    console.warn(
      "[presence] ambient layer failed (real rows only):",
      err instanceof Error ? err.message : err,
    );
    return real;
  }
}

/** Test-only: clear the in-memory presence rows between cases. */
export function __resetPresence(): void {
  memoryRows.clear();
}
