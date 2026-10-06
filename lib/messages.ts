// Messaging model — the shared vocabulary + PURE helpers for 1:1 messages between
// handles (PRD E4). Types + validation live here (no store import) so a route can
// import the model without pulling a storage backend into scope until it's used.
// Everything here is pure and `now`-injected so it unit-tests without a DOM, a
// network, a clock, or a database.
//
// ─────────────────────────────────────────────────────────────────────────────
// COURTESY-CURTAIN, NOT PRIVACY. Identity is a self-asserted `handle` (no auth
// yet — same trust boundary as the rest of the social layer). A "private" message
// is only as private as the honesty of whoever claims a handle; the server route
// mediates every read with a participant check, but that check trusts the handle.
// Keep content low-sensitivity by design. See supabase/migrations/0019_messages.sql.
// ─────────────────────────────────────────────────────────────────────────────

import type { MessageAttachment } from "@/lib/messageAttachments";
import {
  groupThreadName,
  isGroupMember,
  type ConversationKind,
} from "@/lib/messageGroupThread";
import { normalizeHandle } from "@/lib/profiles";
import { cleanText } from "@/lib/textClean";

export type { ConversationKind };

// Message bodies are capped here AND by the messages_body_len_chk constraint in
// migration 0019. Keep the two in lockstep.
export const MAX_MESSAGE_BODY = 1000;

// A normalised, ordered handle pair. handleA < handleB (lexicographic) so an
// unordered pair maps to exactly one conversation regardless of who opened it —
// mirrors the conversations unique (handle_a, handle_b) + order check.
export type HandlePair = { handleA: string; handleB: string };

/**
 * Normalise two untrusted handles into an ordered pair, or null when the pair is
 * invalid: a missing/blank handle either side, or a self-pair (you can't DM
 * yourself — rejected here so no store/route needs to special-case it). Both
 * handles run through normalizeHandle (lowercase, strip leading @, handle
 * alphabet), then sorted so handleA < handleB.
 */
export function normalizePair(a: string, b: string): HandlePair | null {
  const ha = normalizeHandle(a);
  const hb = normalizeHandle(b);
  if (!ha || !hb) return null;
  if (ha === hb) return null; // no self-conversations
  return ha < hb ? { handleA: ha, handleB: hb } : { handleA: hb, handleB: ha };
}

/**
 * True when `handle` is one of the pair — the courtesy participant check the read
 * side leans on. Both sides are normalised so "@Ken" matches a stored "ken".
 */
export function isParticipant(pair: HandlePair, handle: string): boolean {
  const h = normalizeHandle(handle);
  if (!h) return false;
  return h === pair.handleA || h === pair.handleB;
}

/**
 * WHO IS IN A CONVERSATION, whatever kind it is.
 *
 * This is what replaced `HandlePair` at every seam that asked "who is in this"
 * (docs/adr/0015-group-message-threads.md). The pair survives as what it always
 * was — the ordered IDENTITY of a direct row, and the only thing `normalizePair`
 * mints — while everything above the store reads a membership, so a caller can
 * never be written against an assumption of two.
 *
 * `handles` is normalised and holds LIVE members only: somebody who left a
 * group is not in it, and their words stay in the thread exactly as a departed
 * account's words do.
 */
export type ConversationMembership = Readonly<{
  kind: ConversationKind;
  handles: readonly string[];
  /** A group's own name, when it was given one. Always null on a direct row. */
  title: string | null;
}>;

/** The membership of a direct conversation: its pair, in pair order. */
export function membershipFromPair(pair: HandlePair): ConversationMembership {
  return { kind: "direct", handles: [pair.handleA, pair.handleB], title: null };
}

/**
 * True when `handle` is in this conversation — the courtesy check every read
 * side leans on, widened past two. Both sides normalise, so "@Ken" matches a
 * stored "ken" exactly as the pair check does.
 */
export function isMember(
  membership: ConversationMembership,
  handle: string,
): boolean {
  return isGroupMember(membership.handles, handle);
}

/** Everybody but the viewer. The people an inbox row is about. */
export function otherMembers(
  membership: ConversationMembership,
  viewer: string,
): string[] {
  const me = normalizeHandle(viewer);
  return membership.handles.filter((handle) => handle !== me);
}

/**
 * Clean + validate an untrusted message body. Reuses the cleanText trust boundary
 * (strip angle brackets / control chars, collapse whitespace, trim, cap). Returns
 * the cleaned body, or null when nothing survives (empty / whitespace-only) — a
 * route turns null into a 400 so a blank message never reaches the store.
 */
export function cleanBody(input: unknown): string | null {
  const cleaned = cleanText(input, MAX_MESSAGE_BODY);
  return cleaned ? cleaned : null;
}

/**
 * The same cleaning for a body that rides WITH an attachment, where empty is a
 * real answer rather than a reject: a photo sent without a caption is a message,
 * and refusing it would make the words the point of a picture. Returns "" when
 * nothing survives, never null — the caller has already decided there is
 * something else in the message.
 */
export function cleanAttachedBody(input: unknown): string {
  return cleanText(input, MAX_MESSAGE_BODY);
}

// The public message DTO the thread renders. `mine` is resolved per-viewer at the
// store/route boundary (not stored) so bubbles align left/right. `flagged` is the
// abuse-report marker — surfaced so a reporter sees their own report landed.
//
// `attachment` is at most one photo or one pub (lib/messageAttachments.ts). It is
// absent on a FLAGGED message by design: a report is the only lane that takes a
// message photo down, and in a conversation of two people the person who
// objected is the whole audience. The row and its provenance stay; the picture
// stops travelling.
export type MessageDTO = {
  id: string;
  conversationId: string;
  senderHandle: string;
  body: string;
  createdAt: string;
  read: boolean;
  flagged: boolean;
  attachment?: MessageAttachment;
};

// The inbox row: one per conversation, with the OTHER participant + a preview of
// the last message + how many are unread FOR THE VIEWER.
export type ConversationDTO = {
  id: string;
  /**
   * WHO THE ROW IS ABOUT, in one field every existing surface already reads.
   *
   * On a direct row it is the other person. On a GROUP row it is the first
   * other member, so the avatar and the monogram still have a handle to draw
   * from; what the row is CALLED comes from `conversationRowName` instead,
   * because a group is its title or its people and never one of them.
   */
  otherHandle: string;
  /** The other participant's face, when the read carries one. Optional by
   *  design: the inbox draws a monogram without it. */
  otherAvatarUrl?: string;
  /** The other participant's public display name, when they set one. Direct
   *  rows only: a group is named by its title or its people. */
  otherDisplayName?: string;
  /** `direct` when absent, so a pre-group body reads correctly. */
  kind?: ConversationKind;
  /** A group's own name, when it was given one. Absent on a direct row. */
  title?: string;
  /** Every live member, viewer included. Absent on a direct row. */
  memberHandles?: readonly string[];
  lastBody?: string;
  lastAt: string;
  lastFromMe: boolean;
  /** How many messages the viewer has waiting. ABSENT means the count could not
   *  be run, which is not the same as none: a surface reads it as unknown and
   *  the inbox read's own `status` says so. Never coerce it to 0 in a store. */
  unread?: number;
};

/**
 * What ONE inbox row is CALLED.
 *
 * A direct row is the other person, printed as a handle exactly as it always
 * was. A group row is its title, or the people in it, through the one naming
 * rule in `lib/messageGroupThread.ts` — so the inbox, the thread header and any
 * future surface cannot each invent a different name for one thread.
 */
export function conversationRowName(
  conversation: ConversationDTO,
  viewer: string,
): string {
  if ((conversation.kind ?? "direct") !== "group") {
    return conversation.otherDisplayName?.trim() || `@${conversation.otherHandle}`;
  }
  return groupThreadName(
    conversation.title ?? null,
    conversation.memberHandles ?? [],
    viewer,
  );
}

/**
 * The handle printed UNDER a name, so a person with a display name is still
 * known by the handle they are found by. Null when the name line already IS the
 * handle (no display name) and for a group, which has no single handle.
 */
export function conversationRowHandle(conversation: ConversationDTO): string | null {
  if ((conversation.kind ?? "direct") === "group") return null;
  return conversation.otherDisplayName?.trim() && conversation.otherHandle
    ? `@${conversation.otherHandle}`
    : null;
}

/** What a thread header knows after a thread read or an inbox fallback. */
export type ThreadIdentity = {
  kind: ConversationKind;
  members: readonly string[];
  title: string | null;
};

/** The kind on the wire; absent or unknown means direct. */
function wireConversationKind(kind: unknown): ConversationKind {
  return kind === "group" ? "group" : "direct";
}

/**
 * Membership from GET /api/messages/[id] `conversation`. Null when the read
 * carried no members, so a caller may fall back to the inbox row or a message.
 */
export function threadIdentityFromWire(
  conversation:
    | { kind?: unknown; members?: unknown; title?: unknown }
    | undefined
    | null,
): ThreadIdentity | null {
  if (!conversation) return null;
  const members = Array.isArray(conversation.members)
    ? conversation.members.filter((member): member is string => typeof member === "string")
    : [];
  if (members.length === 0) return null;
  return {
    kind: wireConversationKind(conversation.kind),
    members,
    title: typeof conversation.title === "string" ? conversation.title : null,
  };
}

/** Group identity from an inbox row when the thread read named no membership. */
export function threadIdentityFromInboxRow(row: ConversationDTO): ThreadIdentity | null {
  if ((row.kind ?? "direct") !== "group") return null;
  const members = [...(row.memberHandles ?? [])];
  if (members.length === 0) return null;
  return {
    kind: "group",
    members,
    title: row.title ?? null,
  };
}

/** The other participant's handle for the thread avatar on a direct or group row. */
export function otherHandleFromThreadIdentity(
  identity: ThreadIdentity,
  viewer: string,
): string {
  const me = normalizeHandle(viewer);
  return identity.members.find((handle) => normalizeHandle(handle) !== me) ?? "";
}

/**
 * The primary line under the thread back control. Null means the neutral
 * "Conversation" fallback until a name is known.
 */
export function threadHeaderPrimaryLine(
  identity: ThreadIdentity | null,
  otherHandle: string,
  viewer: string,
  displayName?: string | null,
): string | null {
  if (identity?.kind === "group") {
    return groupThreadName(identity.title, identity.members, viewer);
  }
  const handle = normalizeHandle(otherHandle);
  if (!handle) return null;
  return displayName?.trim() || `@${handle}`;
}

/** Whose public card a thread header wears: the other person, never a group. */
export function threadCardHandle(
  identity: ThreadIdentity | null,
  otherHandle: string,
): string | null {
  return identity?.kind === "group" ? null : otherHandle || null;
}

/** The handle under a direct thread's name, when the name is not the handle. */
export function threadHeaderSecondaryLine(
  identity: ThreadIdentity | null,
  otherHandle: string,
  displayName?: string | null,
): string | null {
  if (identity?.kind === "group") return null;
  const handle = normalizeHandle(otherHandle);
  return handle && displayName?.trim() ? `@${handle}` : null;
}

/**
 * Count messages unread BY `viewer`: a message is unread-for-viewer when it has
 * no read_at AND the viewer did not send it (you never have unread messages from
 * yourself). Pure over a list of {senderHandle, read} rows.
 */
export function unreadForViewer(
  rows: ReadonlyArray<{ senderHandle: string; read: boolean }>,
  viewer: string,
): number {
  const v = normalizeHandle(viewer);
  if (!v) return 0;
  let n = 0;
  for (const r of rows) {
    if (r.read) continue;
    if (normalizeHandle(r.senderHandle) === v) continue; // your own message
    n += 1;
  }
  return n;
}

// ── @-mention linkify (light) ────────────────────────────────────────────────
// A message body segment: either plain text or an @handle mention. The render
// side maps a mention to a <Link href="/u/handle">. Pure + tested; NO
// notification is emitted for a mention in v1 — that's the documented seam (a
// future emitNotification({kind:"mention"}) hooks in at the send path).

export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "mention"; handle: string; raw: string };

// Match @handle where handle is the profile alphabet [a-z0-9_], case-insensitive
// so "@Ken" linkifies. A leading boundary (start or non-word char) keeps
// "email@host" from matching the "@host" fragment. The captured group is the
// handle sans "@"; we re-normalise it for the href so the link target is canonical.
const MENTION_RE = /(^|[^a-zA-Z0-9_@])@([a-zA-Z0-9_]{1,30})/g;

/**
 * Split a message body into text + mention segments for rendering. Pure: the
 * caller decides how to render each segment (text as-is, mention as a link to
 * /u/<normalised handle>). A mention whose handle normalises to empty is left as
 * plain text (never a broken link). Order + all characters are preserved so
 * concatenating the segment text reproduces the input.
 */
export function linkifyMentions(body: string): MessageSegment[] {
  if (typeof body !== "string" || body === "") return [];
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(body)) !== null) {
    const [full, boundary, rawHandle] = match;
    const handle = normalizeHandle(rawHandle);
    // Emit the text BEFORE the mention, including the boundary char the regex ate.
    const start = match.index;
    const prefix = body.slice(lastIndex, start) + boundary;
    if (prefix) segments.push({ type: "text", text: prefix });
    if (handle) {
      segments.push({ type: "mention", handle, raw: `@${rawHandle}` });
    } else {
      // Un-normalisable → keep the literal "@rawHandle" as text, never a link.
      segments.push({ type: "text", text: `@${rawHandle}` });
    }
    lastIndex = start + full.length;
  }
  const tail = body.slice(lastIndex);
  if (tail) segments.push({ type: "text", text: tail });
  return segments;
}
