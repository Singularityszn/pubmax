// Comments on Pint Drops — "stories continue after the night" (cc_plan2 §4).
//
// ONE store interface, TWO implementations, same seam pattern as the other
// stores (reactions/pint drops): Supabase (public.pint_drop_comments) when
// env keys exist, process-memory otherwise. Every handler talks to the
// interface via commentsStore() so the backend is chosen in exactly one place.
//
// A comment is attributed to an `actor_hash` — the salted hash of the viewer's
// request IP (lib/supabase.ts hashIp), never a raw IP and never a real user id.
// The actor_hash is stored for rate-limiting / future moderation but is NEVER
// part of the public DTO: a CommentDTO exposes ONLY { id, handle, body,
// createdAt }. The moderation `status` column is likewise never surfaced —
// public reads return status='visible' rows only, so a hidden/pending comment
// simply does not exist for readers.
//
// Reads are fail-soft: a store error on listComments returns [] so a comments
// hiccup can never break feed rendering (the feed treats "no comments" and "the
// comments service is down" identically — the story just isn't shown).

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

// The only shape a reader ever sees. Deliberately minimal: no actor_hash, no
// status, no raw DB columns.
export type CommentDTO = {
  id: string;
  handle: string;
  body: string;
  createdAt: string;
};

// The write payload. actorHash is derived server-side from the request IP; the
// client never supplies it.
export type NewComment = {
  pintDropId: string;
  handle: string;
  body: string;
  actorHash: string;
};

export type CommentsStore = {
  /** Public read: visible-only, oldest-first, hard-capped. Never throws. */
  listComments(pintDropId: string): Promise<CommentDTO[]>;
  /** Create a visible comment; returns its public DTO. Throws on a store error. */
  addComment(input: NewComment): Promise<CommentDTO>;
};

// ── Trust boundary ───────────────────────────────────────────────────────────
// The body is untrusted. Mirror lib/pintDrops.ts clean(): strip anything that
// could be inline HTML, drop control chars, collapse whitespace, cap length.
export const MAX_BODY = 500;
export const MAX_HANDLE = 40;
// Public reads are hard-capped so one busy drop can't return an unbounded thread.
export const MAX_COMMENTS = 100;

function clean(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "") // no inline user HTML
    .replace(/[\u0000-\u001f\u007f]/g, " ") // strip control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

export type CleanResult =
  | { ok: true; handle: string; body: string }
  | { ok: false; error: string };

/**
 * Validate + normalise an untrusted comment. A comment needs a handle and a
 * non-empty body; both are cleaned (HTML/control chars stripped, capped). An
 * empty body (or one that cleans down to empty, e.g. only "<>") is rejected.
 */
export function cleanComment(handle: unknown, body: unknown): CleanResult {
  const cleanHandle = clean(handle, MAX_HANDLE);
  if (!cleanHandle) return { ok: false, error: "Add a handle." };
  const cleanBody = clean(body, MAX_BODY);
  if (!cleanBody) return { ok: false, error: "Comment can't be empty." };
  return { ok: true, handle: cleanHandle, body: cleanBody };
}

const TABLE = "pint_drop_comments";

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase not configured.");
  return client;
}

// Map a raw DB row to the public DTO — the single choke point that guarantees
// actor_hash and status never leave the server.
function toDTO(row: { id: string; handle: string; body: string; created_at: string }): CommentDTO {
  return { id: row.id, handle: row.handle, body: row.body, createdAt: row.created_at };
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseCommentsStore: CommentsStore = {
  async listComments(pintDropId) {
    if (!pintDropId) return [];
    try {
      const { data, error } = await admin()
        .from(TABLE)
        // Select ONLY the public columns — actor_hash/status are never fetched
        // into the DTO path.
        .select("id, handle, body, created_at")
        .eq("pint_drop_id", pintDropId)
        .eq("status", "visible") // public reads: visible only
        .order("created_at", { ascending: true }) // oldest-first
        .limit(MAX_COMMENTS);
      if (error) {
        console.error("[comments] list failed — returning empty thread:", error.message);
        return [];
      }
      return (data ?? []).map((row) =>
        toDTO(row as { id: string; handle: string; body: string; created_at: string }),
      );
    } catch (err) {
      // Fail-soft: a comments outage must never break feed rendering.
      console.error(
        "[comments] list threw — returning empty thread:",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  },

  async addComment({ pintDropId, handle, body, actorHash }) {
    const { data, error } = await admin()
      .from(TABLE)
      .insert({
        pint_drop_id: pintDropId,
        actor_hash: actorHash,
        handle,
        body,
        status: "visible",
      })
      .select("id, handle, body, created_at")
      .single();
    if (error) throw new Error(error.message);
    return toDTO(data as { id: string; handle: string; body: string; created_at: string });
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Map<pintDropId, Comment[]>, resets on restart — right for the prototype demo.
// Rows carry actor_hash + status internally so the memory path exercises the
// same "never leak these" guarantee, but only visible rows are ever mapped to a
// DTO and actor_hash/status never reach toDTO's output shape.
type MemoryRow = {
  id: string;
  handle: string;
  body: string;
  actor_hash: string;
  status: "visible" | "hidden" | "pending";
  created_at: string;
};

const memoryRows = new Map<string, MemoryRow[]>();

// Monotonic id source for the memory store (no DB to mint uuids). Kept simple —
// uniqueness within a process is all the demo needs.
let memorySeq = 0;

export const memoryCommentsStore: CommentsStore = {
  async listComments(pintDropId) {
    if (!pintDropId) return [];
    const rows = memoryRows.get(pintDropId) ?? [];
    return rows
      .filter((r) => r.status === "visible") // hidden/pending never returned
      .sort((a, b) => a.created_at.localeCompare(b.created_at)) // oldest-first
      .slice(0, MAX_COMMENTS)
      .map(toDTO);
  },

  async addComment({ pintDropId, handle, body, actorHash }) {
    const row: MemoryRow = {
      id: `c${++memorySeq}`,
      handle,
      body,
      actor_hash: actorHash,
      status: "visible",
      // Distinct, monotonic timestamps so oldest-first ordering is stable even
      // when two comments land in the same millisecond.
      created_at: new Date(Date.now() + memorySeq).toISOString(),
    };
    const list = memoryRows.get(pintDropId) ?? [];
    list.push(row);
    memoryRows.set(pintDropId, list);
    return toDTO(row);
  },
};

/** The single backend selection point (mirrors the other stores). */
export function commentsStore(): CommentsStore {
  return isSupabaseConfigured() ? supabaseCommentsStore : memoryCommentsStore;
}

/** Test-only: seed a hidden/pending row so tests can assert it's never listed. */
export function __addMemoryCommentForTest(
  pintDropId: string,
  row: { handle: string; body: string; actorHash: string; status: "visible" | "hidden" | "pending" },
): void {
  const stored: MemoryRow = {
    id: `c${++memorySeq}`,
    handle: row.handle,
    body: row.body,
    actor_hash: row.actorHash,
    status: row.status,
    created_at: new Date(Date.now() + memorySeq).toISOString(),
  };
  const list = memoryRows.get(pintDropId) ?? [];
  list.push(stored);
  memoryRows.set(pintDropId, list);
}

/** Test-only: clear the in-memory comment map between cases. */
export function __resetMemoryComments(): void {
  memoryRows.clear();
  memorySeq = 0;
}
