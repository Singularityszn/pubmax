// The Round store. ONE store interface, TWO implementations (process-memory +
// Supabase public.rounds/round_members/round_stops), the exact dual-backend seam
// as notificationsStore / reactionsStore: Supabase when env keys exist, process-
// memory otherwise, chosen at the single roundsStore() seam.
//
// The domain rules the store enforces (mirrored in BOTH backends so the contract
// can't drift):
//   • create      — mints a unique short code, retries on the rare collision.
//   • getByCode    — resolve a Round + its members + stops by its canonical code.
//   • join         — idempotent: unique(round_id, handle). Re-joining is a no-op.
//                    A CLOSED Round can't be joined.
//   • addStop      — idempotent on venue: unique(round_id, venue_id). The same pub
//                    isn't a second stop. A CLOSED Round can't gain stops. Only a
//                    MEMBER can add a stop (you have to be out on the crawl).
//   • close        — marks closed_at. Only the creator can close. Idempotent.
//
// Reads are fail-soft (a store error → null / empty), so a Round outage renders as
// "not found" / an empty route, never a 500. Writes return a typed result the
// route maps to a status code, rather than throwing across the boundary.

import {
  cleanNewRound,
  cleanNewStop,
  generateRoundCode,
  normalizeRoundCode,
  type NewRound,
  type NewStop,
  type RoundDTO,
  type RoundMemberDTO,
  type RoundState,
  type RoundStopDTO,
} from "@/lib/rounds";
import { normalizeHandle } from "@/lib/profiles";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

// How many times to retry a code collision before giving up. A 6-char code over a
// 28-symbol alphabet collides so rarely that one retry would do; a handful is
// belt-and-braces and still bounded.
const CODE_MINT_ATTEMPTS = 6;

// The typed outcomes a write can produce. The route maps these to HTTP:
//   ok → 200/201, not_found → 404, closed → 409, invalid → 400, forbidden → 403.
export type RoundWriteError = "not_found" | "closed" | "invalid" | "forbidden" | "error";

export type CreateResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type JoinResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type AddStopResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type CloseResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type RoundsStore = {
  create(input: { title?: unknown; createdByHandle?: unknown }): Promise<CreateResult>;
  getByCode(code: string): Promise<RoundState | null>;
  join(code: string, handle: string): Promise<JoinResult>;
  addStop(
    code: string,
    input: { venueId?: unknown; venueName?: unknown; addedByHandle?: unknown; dropRef?: unknown },
  ): Promise<AddStopResult>;
  close(code: string, handle: string): Promise<CloseResult>;
};

const ROUNDS = "rounds";
const MEMBERS = "round_members";
const STOPS = "round_stops";

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase not configured.");
  return client;
}

// ── Row → DTO mappers (Supabase) ─────────────────────────────────────────────
function roundFromRow(row: Record<string, unknown>): RoundDTO {
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    title: String(row.title ?? ""),
    createdByHandle: String(row.created_by_handle ?? ""),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
    closedAt: row.closed_at != null ? String(row.closed_at) : null,
  };
}

function memberFromRow(row: Record<string, unknown>): RoundMemberDTO {
  return {
    handle: String(row.handle ?? ""),
    joinedAt: String(row.joined_at ?? new Date(0).toISOString()),
  };
}

function stopFromRow(row: Record<string, unknown>): RoundStopDTO {
  return {
    id: String(row.id),
    venueId: String(row.venue_id ?? ""),
    venueName: String(row.venue_name ?? ""),
    addedByHandle: String(row.added_by_handle ?? ""),
    ...(row.drop_ref != null ? { dropRef: String(row.drop_ref) } : {}),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
  };
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseRoundsStore: RoundsStore = {
  async create(input) {
    const clean = cleanNewRound(input);
    if (!clean) return { ok: false, error: "invalid" };
    try {
      // Mint a unique code, retrying on the (rare) unique-violation collision.
      for (let attempt = 0; attempt < CODE_MINT_ATTEMPTS; attempt += 1) {
        const code = generateRoundCode();
        const { data, error } = await admin()
          .from(ROUNDS)
          .insert({ code, title: clean.title, created_by_handle: clean.createdByHandle })
          .select("id, code, title, created_by_handle, created_at, closed_at")
          .single();
        if (!error && data) {
          // The creator is the first member of their own Round.
          await admin()
            .from(MEMBERS)
            .insert({ round_id: (data as { id: string }).id, handle: clean.createdByHandle });
          const state = await this.getByCode(code);
          return state ? { ok: true, state } : { ok: false, error: "error" };
        }
        // 23505 = unique_violation → a code collision; retry with a new code.
        if (error && (error as { code?: string }).code !== "23505") {
          throw new Error(error.message);
        }
      }
      return { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] create failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },

  async getByCode(code) {
    const key = normalizeRoundCode(code);
    if (!key) return null;
    try {
      const { data: roundRow, error } = await admin()
        .from(ROUNDS)
        .select("id, code, title, created_by_handle, created_at, closed_at")
        .eq("code", key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!roundRow) return null;
      const round = roundFromRow(roundRow as Record<string, unknown>);

      const [{ data: memberRows }, { data: stopRows }] = await Promise.all([
        admin().from(MEMBERS).select("handle, joined_at").eq("round_id", round.id).order("joined_at", { ascending: true }),
        admin().from(STOPS).select("id, venue_id, venue_name, added_by_handle, drop_ref, created_at").eq("round_id", round.id).order("created_at", { ascending: true }),
      ]);
      return {
        round,
        members: (memberRows ?? []).map((r) => memberFromRow(r as Record<string, unknown>)),
        stops: (stopRows ?? []).map((r) => stopFromRow(r as Record<string, unknown>)),
      };
    } catch (err) {
      console.error("[rounds] getByCode failed:", err instanceof Error ? err.message : err);
      return null;
    }
  },

  async join(code, handle) {
    const h = normalizeHandle(handle);
    if (!h) return { ok: false, error: "invalid" };
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      if (state.round.closedAt) return { ok: false, error: "closed" };
      // Idempotent: unique(round_id, handle) makes a re-join a no-op. upsert with
      // ignoreDuplicates so re-joining never errors.
      const { error } = await admin()
        .from(MEMBERS)
        .upsert({ round_id: state.round.id, handle: h }, { onConflict: "round_id,handle", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      const next = await this.getByCode(code);
      return next ? { ok: true, state: next } : { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] join failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },

  async addStop(code, input) {
    const clean = cleanNewStop(input);
    if (!clean) return { ok: false, error: "invalid" };
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      if (state.round.closedAt) return { ok: false, error: "closed" };
      // Only a member can add a stop — you have to be out on the crawl.
      if (!state.members.some((m) => m.handle === clean.addedByHandle)) {
        return { ok: false, error: "forbidden" };
      }
      // Idempotent on venue: unique(round_id, venue_id). The same pub isn't a
      // second stop — a re-add is silently ignored (the route re-reads state).
      const { error } = await admin()
        .from(STOPS)
        .upsert(
          {
            round_id: state.round.id,
            venue_id: clean.venueId,
            venue_name: clean.venueName,
            added_by_handle: clean.addedByHandle,
            drop_ref: clean.dropRef ?? null,
          },
          { onConflict: "round_id,venue_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
      const next = await this.getByCode(code);
      return next ? { ok: true, state: next } : { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] addStop failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },

  async close(code, handle) {
    const h = normalizeHandle(handle);
    if (!h) return { ok: false, error: "invalid" };
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      // Only the creator can close. Idempotent — closing a closed Round is fine.
      if (state.round.createdByHandle !== h) return { ok: false, error: "forbidden" };
      if (!state.round.closedAt) {
        const { error } = await admin()
          .from(ROUNDS)
          .update({ closed_at: new Date().toISOString() })
          .eq("id", state.round.id);
        if (error) throw new Error(error.message);
      }
      const next = await this.getByCode(code);
      return next ? { ok: true, state: next } : { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] close failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Keyed by canonical code, resets on restart — right for dev/demo/test.
type MemoryRound = {
  id: string;
  code: string;
  title: string;
  createdByHandle: string;
  createdAt: string;
  closedAt: string | null;
  members: RoundMemberDTO[];
  stops: RoundStopDTO[];
};

const memoryRounds = new Map<string, MemoryRound>();
let memorySeq = 0;

function stamp(): string {
  // Distinct, monotonic timestamps so insert-order sorting is stable even when
  // two writes land in the same millisecond.
  return new Date(Date.now() + memorySeq).toISOString();
}

function stateFrom(round: MemoryRound): RoundState {
  return {
    round: {
      id: round.id,
      code: round.code,
      title: round.title,
      createdByHandle: round.createdByHandle,
      createdAt: round.createdAt,
      closedAt: round.closedAt,
    },
    members: round.members.slice().sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    stops: round.stops.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

export const memoryRoundsStore: RoundsStore = {
  async create(input) {
    const clean = cleanNewRound(input);
    if (!clean) return { ok: false, error: "invalid" };
    let code = generateRoundCode();
    for (let attempt = 0; memoryRounds.has(code) && attempt < CODE_MINT_ATTEMPTS; attempt += 1) {
      code = generateRoundCode();
    }
    if (memoryRounds.has(code)) return { ok: false, error: "error" };
    memorySeq += 1;
    const round: MemoryRound = {
      id: `r${memorySeq}`,
      code,
      title: clean.title,
      createdByHandle: clean.createdByHandle,
      createdAt: stamp(),
      closedAt: null,
      // The creator is the first member of their own Round.
      members: [{ handle: clean.createdByHandle, joinedAt: stamp() }],
      stops: [],
    };
    memoryRounds.set(code, round);
    return { ok: true, state: stateFrom(round) };
  },

  async getByCode(code) {
    const key = normalizeRoundCode(code);
    if (!key) return null;
    const round = memoryRounds.get(key);
    return round ? stateFrom(round) : null;
  },

  async join(code, handle) {
    const h = normalizeHandle(handle);
    if (!h) return { ok: false, error: "invalid" };
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (round.closedAt) return { ok: false, error: "closed" };
    if (!round.members.some((m) => m.handle === h)) {
      memorySeq += 1;
      round.members.push({ handle: h, joinedAt: stamp() });
    }
    return { ok: true, state: stateFrom(round) };
  },

  async addStop(code, input) {
    const clean = cleanNewStop(input);
    if (!clean) return { ok: false, error: "invalid" };
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (round.closedAt) return { ok: false, error: "closed" };
    if (!round.members.some((m) => m.handle === clean.addedByHandle)) {
      return { ok: false, error: "forbidden" };
    }
    // Idempotent on venue — the same pub isn't a second stop.
    if (!round.stops.some((s) => s.venueId === clean.venueId)) {
      memorySeq += 1;
      round.stops.push({
        id: `s${memorySeq}`,
        venueId: clean.venueId,
        venueName: clean.venueName,
        addedByHandle: clean.addedByHandle,
        ...(clean.dropRef ? { dropRef: clean.dropRef } : {}),
        createdAt: stamp(),
      });
    }
    return { ok: true, state: stateFrom(round) };
  },

  async close(code, handle) {
    const h = normalizeHandle(handle);
    if (!h) return { ok: false, error: "invalid" };
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (round.createdByHandle !== h) return { ok: false, error: "forbidden" };
    if (!round.closedAt) round.closedAt = stamp();
    return { ok: true, state: stateFrom(round) };
  },
};

/** The single backend selection point (mirrors the other stores). */
export function roundsStore(): RoundsStore {
  return isSupabaseConfigured() ? supabaseRoundsStore : memoryRoundsStore;
}

/** Test-only: clear the in-memory Round map between cases. */
export function __resetMemoryRounds(): void {
  memoryRounds.clear();
  memorySeq = 0;
}
