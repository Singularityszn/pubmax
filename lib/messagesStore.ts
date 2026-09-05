import "server-only";

// Durable 1:1 messaging store. ONE store interface, TWO implementations
// (process-memory + Supabase public.conversations/messages), the same dual-backend
// seam as notifications/reactions/comments: Supabase when env keys exist,
// process-memory otherwise, chosen at the single messagesStore() seam.
//
// ─────────────────────────────────────────────────────────────────────────────
// COURTESY-CURTAIN, NOT PRIVACY. Identity is a self-asserted `handle` (no auth).
// The store enforces the participant check on reads (a non-participant gets
// nothing back), but that check trusts the asserted handle — it is a courtesy
// curtain, not cryptographic privacy. Reads are DENY-ALL at the DB (RLS on, no
// policy — migration 0019); ALL access goes through the service-role admin client
// here. Keep content low-sensitivity by design; `report` is the abuse seam.
// ─────────────────────────────────────────────────────────────────────────────
//
// The WRITE path (send) surfaces real failures to the route (a dropped message
// must not silently vanish). The READ path (list/messages) is fail-soft: an
// outage renders as an empty inbox / empty thread, never a 500.

import {
  isMessagePhotoServingKey,
  MESSAGE_ATTACHMENT_KINDS,
  messageAttachmentPreview,
  messagePhotoServePath,
  messagePhotoServingKey,
  type MessageAttachment,
  type MessageAttachmentKind,
  type MessageAttachmentWrite,
} from "@/lib/messageAttachments";
import {
  cleanAttachedBody,
  cleanBody,
  isParticipant,
  normalizePair,
  unreadForViewer,
  type ConversationDTO,
  type HandlePair,
  type MessageDTO,
} from "@/lib/messages";
import { normalizeHandle } from "@/lib/profiles";
import { admin, errorMessage, missingTables, selectStore } from "@/lib/storeBackend";

// Hard caps so one busy handle can't return an unbounded payload.
export const MAX_CONVERSATIONS = 100;
export const MAX_MESSAGES = 200;
// The inbox read's two windows (see listConversations): how many unread rows
// one inbox is counted over, and how many recent rows per conversation the
// newest-first window fetches to find each conversation's last message.
export const INBOX_UNREAD_SCAN_CAP = 1_000;
export const INBOX_LAST_MESSAGE_WINDOW = 4;

/**
 * What a send is worth to its caller: the stored row, and the pair the write
 * had to load anyway to prove the sender belongs in this conversation.
 */
export type MessageSendResult = Readonly<{
  message: MessageDTO;
  pair: HandlePair;
}>;

/**
 * `clientMessageId` is the id the SENDER minted for this attempt, before the
 * request left the browser. It is the idempotency key: a connection reset after
 * the row committed used to leave the message stored, the optimistic bubble
 * removed and the text back in the field, so the drinker sent it again and
 * there were two. With a key, the retry finds the row it already wrote and is
 * handed that one back. A caller that does not send one keeps the old
 * behaviour, which is what the memory backend and the legacy lanes rely on.
 */
export type MessageSendOptions = Readonly<{
  clientMessageId?: string;
}>;

/**
 * How well an inbox read went, kept APART from what it returned.
 *
 * `degraded` is not "no conversations": it says a read this answer depends on
 * could not be run, so a count or a preview may be missing or the whole list
 * may be. A failure that reads as absence is the one thing this codebase
 * refuses everywhere else (picksState, whatsOn readStatus), and the batched
 * inbox read had turned one statement timeout into an empty inbox served 200.
 */
export type InboxReadStatus = "ready" | "degraded";

export type InboxRead = Readonly<{
  conversations: ConversationDTO[];
  status: InboxReadStatus;
}>;

export type MessagesStore = {
  /** Find-or-create the conversation for an unordered pair. Returns the
   *  conversation id, or null when the pair is invalid (blank / self-pair). */
  openConversation(a: string, b: string): Promise<string | null>;
  /** Append a message. `sender` must be a participant of the conversation and
   *  the message must carry SOMETHING: a body that survives cleaning, an
   *  attachment, or both. Returns the stored row TOGETHER WITH the pair, or
   *  null on any reject (unknown conversation, non-participant sender, nothing
   *  to send).
   *
   *  THE PAIR RIDES BACK because the write already proved it: both
   *  implementations load the conversation to run the participant check, and
   *  the caller needs the same two handles to name the inbox topics its send
   *  signal goes to. Asking `participants` again afterwards was a second round
   *  trip for an answer this call had in its hand.
   *
   *  A PHOTO attachment brings its own id, minted by the writer BEFORE the bytes
   *  were staged, because the storage key is built from it. Passing it
   *  explicitly is what keeps the row and its object in agreement: deriving one
   *  from the other would let a write drift into a row whose serve route 404s.
   *
   *  `clientMessageId` is the sender's own id for this attempt (see
   *  MessageSendOptions). */
  send(
    conversationId: string,
    sender: string,
    body: string,
    attachment?: MessageAttachmentWrite,
    options?: MessageSendOptions,
  ): Promise<MessageSendResult | null>;
  /** A handle's inbox: newest-first conversations with last-message preview +
   *  per-viewer unread count, AND how well that read went. Never throws. */
  listConversations(handle: string): Promise<InboxRead>;
  /** A conversation's thread, oldest-first, ONLY IF `handle` is a participant.
   *  A non-participant (or unknown conversation) gets null — the caller turns
   *  that into a 404 so a thread never leaks. A READ and nothing else: marking
   *  what the viewer received as read is `markRead`, asked by the thread route
   *  alone, so a photo send or a report (which read the thread to prove
   *  participation) cannot mark anything read. Never throws on a valid
   *  participant read. */
  listMessages(conversationId: string, handle: string): Promise<MessageDTO[] | null>;
  /** Mark the viewer's RECEIVED unread messages read. Returns how many rows
   *  changed, so the route can tell the sender's thread only when something did.
   *  A non-participant marks nothing and gets 0. Never throws. */
  markRead(conversationId: string, handle: string): Promise<number>;
  /** The two handles of a conversation, or null when it is unknown or the read
   *  failed. For naming who a send signal is for; never a participant check on
   *  its own. */
  participants(conversationId: string): Promise<HandlePair | null>;
  /** Flag a message for the admin queue (abuse seam). Returns true when a row was
   *  flagged. Reuses the moderation posture — the message is marked, not deleted. */
  report(
    conversationId: string,
    messageId: string,
    reporterHandle: string,
  ): Promise<boolean>;
  /** The serving key of ONE message photo, only for a participant, and only
   *  while the message is unflagged. Null for everything else — an unknown id,
   *  an outsider, a text message and a reported photo answer alike, so the
   *  refusal says nothing about which of them it was. Reading a photo is NOT
   *  reading the thread, so this never marks anything read. */
  photoObjectKey(
    conversationId: string,
    messageId: string,
    handle: string,
  ): Promise<string | null>;
};

const CONVERSATIONS = "conversations";
const MESSAGES = "messages";
const memoryFallbackWarnings = new Set<string>();

// ONE column list behind every message read, so a lane that forgot the
// attachment columns cannot quietly serve a photo message as a bare line of
// text — the same reason the public profile has one projection.
const MESSAGE_COLUMNS =
  "id, conversation_id, sender_handle, body, created_at, read_at, flagged_at, " +
  "attachment_kind, attachment_object_key, attachment_width, attachment_height, attachment_venue_id";

/**
 * The inbox preview for one last message. Words when there are words; otherwise
 * the noun for what it carried, because a blank row reads as a message that did
 * not arrive.
 */
function previewBody(body: string, kind: unknown): string {
  if (body) return body;
  return MESSAGE_ATTACHMENT_KINDS.includes(kind as MessageAttachmentKind)
    ? messageAttachmentPreview(kind as MessageAttachmentKind)
    : "";
}

/** The insert half of the same list. A message with no attachment writes nulls. */
function attachmentColumns(
  attachment: MessageAttachmentWrite | undefined,
): Record<string, unknown> {
  if (!attachment) return {};
  if (attachment.kind === "venue") {
    return { attachment_kind: "venue", attachment_venue_id: attachment.venueId };
  }
  return {
    id: attachment.messageId,
    attachment_kind: "photo",
    attachment_object_key: attachment.objectKey,
    attachment_width: attachment.width,
    attachment_height: attachment.height,
  };
}

/**
 * The stored columns, read back as the thread's attachment.
 *
 * A FLAGGED message carries none: a report is the lane that takes a message
 * photo down, and the row plus its provenance stay for a moderator while the
 * picture stops travelling. The serving key is rebuilt from the row's own ids
 * rather than trusted off it, so a hand-edited object_key cannot make the serve
 * route read somebody else's object.
 */
function rowToAttachment(row: Record<string, unknown>): MessageAttachment | undefined {
  if (row.flagged_at != null) return undefined;
  const kind = row.attachment_kind;
  if (kind === "venue") {
    const venueId = typeof row.attachment_venue_id === "string" ? row.attachment_venue_id : "";
    return venueId ? { kind: "venue", venueId, card: null } : undefined;
  }
  if (kind !== "photo") return undefined;
  const conversationId = String(row.conversation_id ?? "");
  const messageId = String(row.id ?? "");
  const objectKey = typeof row.attachment_object_key === "string" ? row.attachment_object_key : "";
  if (!isMessagePhotoServingKey(conversationId, messageId, objectKey)) return undefined;
  const width = Number(row.attachment_width);
  const height = Number(row.attachment_height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    kind: "photo",
    url: messagePhotoServePath(conversationId, messageId),
    width,
    height,
  };
}

const isMissingMessagesSchema = missingTables("conversations", "messages");

// A memory-minted conversation id is `c` followed by a decimal sequence number
// and nothing else (see memoryMessagesStore.openConversation). A durable id is a
// Postgres UUID, and `c` is a hex digit, so a bare `startsWith("c")` claimed one
// durable conversation in sixteen for the empty in-memory store. Match the whole
// shape instead: a UUID always carries hyphens, so it can never satisfy this.
const MEMORY_CONVERSATION_ID = /^c\d+$/;

export function isMemoryConversationId(conversationId: string): boolean {
  return MEMORY_CONVERSATION_ID.test(conversationId);
}

function warnMemoryFallback(context: string, err: unknown): void {
  if (memoryFallbackWarnings.has(context)) return;
  memoryFallbackWarnings.add(context);
  console.warn(
    `[messages] ${context} durable table missing — using process-memory fallback (apply migration 0019):`,
    errorMessage(err),
  );
}

// A client message id is the browser's own uuid for one send attempt. It is
// matched as a UUID SHAPE, never trusted as text: the column is `uuid`, so a
// value that is not one would be a 22P02 on the write path of a real message.
const CLIENT_MESSAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readClientMessageId(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return CLIENT_MESSAGE_ID.test(trimmed) ? trimmed.toLowerCase() : null;
}

// Additive-rollout guard for migration 0149, in the shape lib/pintDropsStore.ts
// uses for every other additive column: match ONLY a missing
// `client_message_id`, so a coincidental 42703 on some other column still
// throws rather than silently dropping a drinker's message.
function isMissingClientMessageIdColumn(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    (code === "42703" || code === "PGRST204") && message.includes("client_message_id")
  );
}

// The unique index 0149 adds. A conflict here is never a fault: it is the
// SECOND arrival of one send, which is exactly what the key exists to catch.
function isDuplicateClientMessageId(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === "23505" &&
    (error.message ?? "").toLowerCase().includes("client_message_id")
  );
}

const READY_EMPTY_INBOX: InboxRead = { conversations: [], status: "ready" };

type InboxUnread = { byConversation: Map<string, number>; degraded: boolean };
type InboxRecent = {
  lastByConversation: Map<string, Record<string, unknown>>;
  windowFull: boolean;
  degraded: boolean;
};

/**
 * The viewer's unread count per conversation, in ONE scan over the whole inbox.
 *
 * THE CAP IS A WINDOW, NOT A FILTER, and the order is what makes it one. The
 * scan is bounded at INBOX_UNREAD_SCAN_CAP rows across up to MAX_CONVERSATIONS
 * conversations, so a busy inbox can fill it. With no `order` the plan returned
 * rows in whatever order the index gave — under 0143's partial index that is
 * conversation_id order, so the lowest-sorting ids ate the budget and every
 * conversation after them reported a confident `unread: 0` (F-9). Ordering
 * makes the truncation KNOWABLE: when the window filled, every conversation the
 * scan reached except the last one it saw is complete, and the rest are re-asked
 * one by one with their own bounded count.
 *
 * A scan that could not run at all reports `degraded` and counts nothing, so no
 * caller can read a failed count as an empty one.
 */
async function readInboxUnread(ids: readonly string[], me: string): Promise<InboxUnread> {
  const byConversation = new Map<string, number>();
  let rows: Array<Record<string, unknown>>;
  try {
    const { data, error } = await admin()
      .from(MESSAGES)
      .select("conversation_id")
      .in("conversation_id", ids)
      .neq("sender_handle", me)
      .is("read_at", null)
      .order("conversation_id", { ascending: true })
      .limit(INBOX_UNREAD_SCAN_CAP);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as Array<Record<string, unknown>>;
  } catch (err) {
    console.error(
      "[messages] inbox unread scan failed:",
      err instanceof Error ? err.message : err,
    );
    return { byConversation, degraded: true };
  }
  for (const row of rows) {
    const id = String(row.conversation_id);
    byConversation.set(id, (byConversation.get(id) ?? 0) + 1);
  }
  if (rows.length < INBOX_UNREAD_SCAN_CAP) return { byConversation, degraded: false };

  // The window filled. The conversation the last row belongs to may have been
  // cut mid-count, and every id sorting after it was never reached at all.
  const lastSeen = String(rows[rows.length - 1]?.conversation_id ?? "");
  const unfinished = ids.filter((id) => id >= lastSeen);
  let degraded = false;
  await Promise.all(
    unfinished.map(async (id) => {
      try {
        const { count, error } = await admin()
          .from(MESSAGES)
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", id)
          .neq("sender_handle", me)
          .is("read_at", null);
        if (error) throw new Error(error.message);
        if (typeof count === "number") byConversation.set(id, count);
        else byConversation.delete(id);
      } catch (err) {
        // One conversation's count is unknown rather than wrong.
        byConversation.delete(id);
        degraded = true;
        console.error(
          "[messages] inbox unread re-ask failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );
  return { byConversation, degraded };
}

/** The newest-first window that holds each conversation's last message. */
async function readInboxRecent(ids: readonly string[]): Promise<InboxRecent> {
  const lastByConversation = new Map<string, Record<string, unknown>>();
  const window = ids.length * INBOX_LAST_MESSAGE_WINDOW;
  let rows: Array<Record<string, unknown>>;
  try {
    const { data, error } = await admin()
      .from(MESSAGES)
      .select("conversation_id, sender_handle, body, attachment_kind")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(window);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as Array<Record<string, unknown>>;
  } catch (err) {
    console.error(
      "[messages] inbox recent window failed:",
      err instanceof Error ? err.message : err,
    );
    return { lastByConversation, windowFull: false, degraded: true };
  }
  for (const row of rows) {
    const id = String(row.conversation_id);
    if (!lastByConversation.has(id)) lastByConversation.set(id, row);
  }
  return { lastByConversation, windowFull: rows.length >= window, degraded: false };
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseMessagesStore: MessagesStore = {
  async openConversation(a, b) {
    const pair = normalizePair(a, b);
    if (!pair) return null;
    try {
      // Upsert-then-select: insert the pair, ignore a unique-conflict, then read
      // the (existing or new) row's id. One extra round trip but keeps the id
      // stable across concurrent opens.
      const { error: upErr } = await admin()
        .from(CONVERSATIONS)
        .upsert(
          { handle_a: pair.handleA, handle_b: pair.handleB },
          { onConflict: "handle_a,handle_b", ignoreDuplicates: true },
        );
      if (upErr) throw new Error(upErr.message);
      const { data, error } = await admin()
        .from(CONVERSATIONS)
        .select("id")
        .eq("handle_a", pair.handleA)
        .eq("handle_b", pair.handleB)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? String((data as { id: unknown }).id) : null;
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("openConversation", err);
        return memoryMessagesStore.openConversation(a, b);
      }
      console.error(
        "[messages] openConversation failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },

  async send(conversationId, sender, body, attachment, options) {
    const senderHandle = normalizeHandle(sender);
    const clean = attachment ? cleanAttachedBody(body) : cleanBody(body);
    if (!conversationId || !senderHandle || clean === null) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.send(conversationId, senderHandle, clean, attachment, options);
    }
    const clientMessageId = readClientMessageId(options?.clientMessageId);
    try {
      const pair = await loadPair(conversationId);
      if (!pair || !isParticipant(pair, senderHandle)) return null;
      const row = {
        conversation_id: conversationId,
        sender_handle: senderHandle,
        body: clean,
        ...attachmentColumns(attachment),
      };
      let inserted = clientMessageId
        ? await admin()
            .from(MESSAGES)
            .insert({ ...row, client_message_id: clientMessageId })
            .select(MESSAGE_COLUMNS)
            .single()
        : await admin().from(MESSAGES).insert(row).select(MESSAGE_COLUMNS).single();

      if (clientMessageId && isMissingClientMessageIdColumn(inserted.error)) {
        // Migration 0149 has not landed yet. A message a drinker sent must not
        // be lost to a column that is not there; the retry writes the row
        // without the key and simply is not idempotent until the deploy
        // catches up (the same additive-rollout rule as vibe_tags / measure).
        inserted = await admin().from(MESSAGES).insert(row).select(MESSAGE_COLUMNS).single();
      } else if (clientMessageId && isDuplicateClientMessageId(inserted.error)) {
        // THIS EXACT ATTEMPT IS ALREADY STORED. The first request committed and
        // its answer never reached the sender, so hand back the row it wrote
        // rather than a second copy of the same message.
        const replayed = await loadByClientMessageId(conversationId, clientMessageId);
        if (replayed) return { message: replayed, pair };
        throw new Error(inserted.error?.message ?? "duplicate client_message_id");
      }

      if (inserted.error) throw new Error(inserted.error.message);
      // Bump the denormalised inbox-sort timestamp. Best-effort — the message is
      // already stored; a failed bump only affects ordering.
      await admin()
        .from(CONVERSATIONS)
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
      return {
        message: rowToMessageDTO(inserted.data as unknown as Record<string, unknown>),
        pair,
      };
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("send", err);
        return memoryMessagesStore.send(conversationId, senderHandle, clean, attachment, options);
      }
      console.error("[messages] send failed:", err instanceof Error ? err.message : err);
      return null;
    }
  },

  async listConversations(handle) {
    const me = normalizeHandle(handle);
    if (!me) return READY_EMPTY_INBOX;
    let rows: Array<Record<string, unknown>>;
    try {
      // ONLY THE CONVERSATION ROWS MAY EMPTY THE INBOX. This read is what says
      // which conversations exist; the two below only decorate them, and a
      // failure in either used to throw all the way out here and serve an
      // empty inbox with a 200 (F-10). They are caught where they happen now.
      const { data, error } = await admin()
        .from(CONVERSATIONS)
        .select("id, handle_a, handle_b, last_message_at")
        .or(`handle_a.eq.${me},handle_b.eq.${me}`)
        .order("last_message_at", { ascending: false })
        .limit(MAX_CONVERSATIONS);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as Array<Record<string, unknown>>;
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("listConversations", err);
        return memoryMessagesStore.listConversations(me);
      }
      console.error(
        "[messages] listConversations failed — inbox unreadable:",
        err instanceof Error ? err.message : err,
      );
      return { conversations: [], status: "degraded" };
    }
    if (rows.length === 0) return READY_EMPTY_INBOX;

    const ids = rows.map((row) => String(row.id));
    // TWO reads for the whole inbox, in parallel, where there used to be ONE
    // PER CONVERSATION, each pulling up to 200 rows: the unread rows the
    // viewer has not read (bounded), and a newest-first window of recent
    // messages wide enough to hold the last message of every conversation
    // on an ordinary inbox. A conversation either window did not reach is
    // asked for on its own, so a busy thread cannot hide a quiet one.
    const [unread, recent] = await Promise.all([
      readInboxUnread(ids, me),
      readInboxRecent(ids),
    ]);

    const lastByConversation = recent.lastByConversation;
    if (recent.windowFull) {
      const missing = ids.filter((id) => !lastByConversation.has(id));
      await Promise.all(
        missing.map(async (id) => {
          try {
            const { data: one, error } = await admin()
              .from(MESSAGES)
              .select("conversation_id, sender_handle, body, attachment_kind")
              .eq("conversation_id", id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (error) throw new Error(error.message);
            if (one) lastByConversation.set(id, one as unknown as Record<string, unknown>);
          } catch (err) {
            recent.degraded = true;
            console.error(
              "[messages] inbox last-message re-ask failed:",
              err instanceof Error ? err.message : err,
            );
          }
        }),
      );
    }

    const conversations = rows.map((row) => {
      const id = String(row.id);
      const other =
        normalizeHandle(String(row.handle_a)) === me
          ? String(row.handle_b)
          : String(row.handle_a);
      const last = lastByConversation.get(id);
      const counted = unread.byConversation.get(id);
      return {
        id,
        otherHandle: normalizeHandle(other),
        ...(last
          ? { lastBody: previewBody(String(last.body ?? ""), last.attachment_kind) }
          : {}),
        lastAt: String(row.last_message_at ?? new Date(0).toISOString()),
        lastFromMe: last ? normalizeHandle(String(last.sender_handle)) === me : false,
        // UNCOUNTED IS NOT ZERO. A scan that could not run leaves the field off
        // entirely, and the surface says it could not check rather than
        // printing a confident nothing over a waiting message.
        ...(unread.degraded && counted === undefined ? {} : { unread: counted ?? 0 }),
      };
    });
    return {
      conversations,
      status: unread.degraded || recent.degraded ? "degraded" : "ready",
    };
  },

  async listMessages(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.listMessages(conversationId, me);
    }
    try {
      // The pair and the rows are asked for TOGETHER, keyed on the same id, so
      // a thread open is one round trip's wait rather than two in a row. The
      // rows are still only RETURNED behind the courtesy check below.
      const [pair, selected] = await Promise.all([
        loadPair(conversationId),
        admin()
          .from(MESSAGES)
          .select(MESSAGE_COLUMNS)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(MAX_MESSAGES),
      ]);
      // COURTESY CHECK: a non-participant (or unknown conversation) gets null →
      // the route turns that into a 404. Never return another pair's thread.
      if (!pair || !isParticipant(pair, me)) return null;
      if (selected.error) throw new Error(selected.error.message);
      const rows = ((selected.data ?? []) as unknown as Array<Record<string, unknown>>).reverse();
      return rows.map((r) => rowToMessageDTO(r));
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("listMessages", err);
        return memoryMessagesStore.listMessages(conversationId, me);
      }
      console.error(
        "[messages] listMessages failed:",
        err instanceof Error ? err.message : err,
      );
      // A participant we already verified hitting a transient read error gets an
      // empty thread, not a leak and not a 500.
      return [];
    }
  },

  async markRead(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return 0;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.markRead(conversationId, me);
    }
    try {
      const pair = await loadPair(conversationId);
      if (!pair || !isParticipant(pair, me)) return 0;
      const { data, error } = await admin()
        .from(MESSAGES)
        .update({ read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .neq("sender_handle", me)
        .is("read_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data.length : 0;
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("markRead", err);
        return memoryMessagesStore.markRead(conversationId, me);
      }
      console.error("[messages] markRead failed:", err instanceof Error ? err.message : err);
      return 0;
    }
  },

  async participants(conversationId) {
    if (!conversationId) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.participants(conversationId);
    }
    try {
      return await loadPair(conversationId);
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("participants", err);
        return memoryMessagesStore.participants(conversationId);
      }
      console.error(
        "[messages] participants failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },

  async report(conversationId, messageId, reporterHandle) {
    const reporter = normalizeHandle(reporterHandle);
    if (!conversationId || !messageId || !reporter) return false;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.report(conversationId, messageId, reporter);
    }
    try {
      const { data, error } = await admin()
        .from(MESSAGES)
        .update({ flagged_at: new Date().toISOString(), flagged_by: reporter })
        .eq("conversation_id", conversationId)
        .eq("id", messageId)
        .is("flagged_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("report", err);
        return memoryMessagesStore.report(conversationId, messageId, reporter);
      }
      console.error("[messages] report failed:", err instanceof Error ? err.message : err);
      return false;
    }
  },

  async photoObjectKey(conversationId, messageId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !messageId || !me) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.photoObjectKey(conversationId, messageId, me);
    }
    try {
      const pair = await loadPair(conversationId);
      // COURTESY CHECK, the same one the thread read makes. A non-participant
      // never learns whether the id exists.
      if (!pair || !isParticipant(pair, me)) return null;
      const { data, error } = await admin()
        .from(MESSAGES)
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .eq("id", messageId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return photoKeyFromRow(data as unknown as Record<string, unknown>);
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("photoObjectKey", err);
        return memoryMessagesStore.photoObjectKey(conversationId, messageId, me);
      }
      console.error(
        "[messages] photoObjectKey failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },
};

// The serving key a row is allowed to hand out, through the SAME attachment
// projection the thread reads — so a reported photo, a text message and a
// mismatched key are one answer here exactly as they are there.
function photoKeyFromRow(row: Record<string, unknown>): string | null {
  const attachment = rowToAttachment(row);
  if (!attachment || attachment.kind !== "photo") return null;
  return messagePhotoServingKey(String(row.conversation_id ?? ""), String(row.id ?? ""));
}

// Resolve a conversation's handle pair (for the participant check). Returns null
// on any miss. Kept private to the Supabase path.
async function loadPair(conversationId: string): Promise<HandlePair | null> {
  const { data, error } = await admin()
    .from(CONVERSATIONS)
    .select("handle_a, handle_b")
    .eq("id", conversationId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { handle_a: unknown; handle_b: unknown };
  return normalizePair(String(row.handle_a), String(row.handle_b));
}

// The row ONE send attempt already wrote, found by the sender's own key. Only
// ever asked after a duplicate-key conflict, so a null here means the conflict
// was about something else and the caller must still fail loudly.
async function loadByClientMessageId(
  conversationId: string,
  clientMessageId: string,
): Promise<MessageDTO | null> {
  const { data, error } = await admin()
    .from(MESSAGES)
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("client_message_id", clientMessageId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToMessageDTO(data as unknown as Record<string, unknown>) : null;
}

function rowToMessageDTO(row: Record<string, unknown>): MessageDTO {
  const attachment = rowToAttachment(row);
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id ?? ""),
    senderHandle: normalizeHandle(String(row.sender_handle ?? "")),
    body: String(row.body ?? ""),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
    read: row.read_at != null,
    flagged: row.flagged_at != null,
    ...(attachment ? { attachment } : {}),
  };
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Two flat maps keyed by conversation id, resets on restart — right for
// dev/demo/test. The pair-key index maps "a|b" → conversation id so open is O(1).
type MemoryConversation = {
  id: string;
  handleA: string;
  handleB: string;
  lastMessageAt: string;
};
type MemoryMessage = {
  id: string;
  conversationId: string;
  senderHandle: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  flaggedAt: string | null;
  flaggedBy: string | null;
  attachmentKind: string | null;
  attachmentObjectKey: string | null;
  attachmentWidth: number | null;
  attachmentHeight: number | null;
  attachmentVenueId: string | null;
  /** The sender's own id for the attempt that wrote this row, when it sent one. */
  clientMessageId: string | null;
};

const memConversations = new Map<string, MemoryConversation>();
const memPairIndex = new Map<string, string>(); // "handleA|handleB" → conversation id
const memMessages = new Map<string, MemoryMessage[]>(); // conversation id → messages
let memConvSeq = 0;
let memMsgSeq = 0;

function pairKey(pair: HandlePair): string {
  return `${pair.handleA}|${pair.handleB}`;
}

function memConversationDTO(conv: MemoryConversation, me: string): ConversationDTO {
  const other = conv.handleA === me ? conv.handleB : conv.handleA;
  const list = (memMessages.get(conv.id) ?? [])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest-first
  const last = list[0];
  return {
    id: conv.id,
    otherHandle: other,
    ...(last ? { lastBody: previewBody(last.body, last.attachmentKind) } : {}),
    lastAt: conv.lastMessageAt,
    lastFromMe: last ? last.senderHandle === me : false,
    unread: unreadForViewer(
      list.map((m) => ({ senderHandle: m.senderHandle, read: m.readAt != null })),
      me,
    ),
  };
}

// Through the SAME projection the durable rows take, so the two backends cannot
// answer differently about what a message is carrying.
function memMessageDTO(m: MemoryMessage): MessageDTO {
  return rowToMessageDTO({
    id: m.id,
    conversation_id: m.conversationId,
    sender_handle: m.senderHandle,
    body: m.body,
    created_at: m.createdAt,
    read_at: m.readAt,
    flagged_at: m.flaggedAt,
    attachment_kind: m.attachmentKind,
    attachment_object_key: m.attachmentObjectKey,
    attachment_width: m.attachmentWidth,
    attachment_height: m.attachmentHeight,
    attachment_venue_id: m.attachmentVenueId,
  });
}

export const memoryMessagesStore: MessagesStore = {
  async openConversation(a, b) {
    const pair = normalizePair(a, b);
    if (!pair) return null;
    const key = pairKey(pair);
    const existing = memPairIndex.get(key);
    if (existing) return existing;
    const id = `c${++memConvSeq}`;
    const now = new Date(Date.now() + memConvSeq).toISOString();
    memConversations.set(id, {
      id,
      handleA: pair.handleA,
      handleB: pair.handleB,
      lastMessageAt: now,
    });
    memPairIndex.set(key, id);
    memMessages.set(id, []);
    return id;
  },

  async send(conversationId, sender, body, attachment, options) {
    const senderHandle = normalizeHandle(sender);
    const clean = attachment ? cleanAttachedBody(body) : cleanBody(body);
    if (!conversationId || !senderHandle || clean === null) return null;
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    const pair: HandlePair = { handleA: conv.handleA, handleB: conv.handleB };
    if (!isParticipant(pair, senderHandle)) return null;
    // The same idempotency the durable backend gets from 0149's unique index,
    // so a retry behaves alike on a keyless dev server and in production.
    const clientMessageId = readClientMessageId(options?.clientMessageId);
    if (clientMessageId) {
      const already = (memMessages.get(conversationId) ?? []).find(
        (candidate) => candidate.clientMessageId === clientMessageId,
      );
      if (already) return { message: memMessageDTO(already), pair };
    }
    // A photo's id was minted before its bytes were staged, so the row takes it
    // rather than the sequence: the storage key is built from it.
    const id = attachment?.kind === "photo" ? attachment.messageId : `m${++memMsgSeq}`;
    if (attachment?.kind === "photo") memMsgSeq += 1;
    // Distinct, monotonic timestamps so oldest-first ordering is stable even when
    // two messages land in the same millisecond.
    const createdAt = new Date(Date.now() + memMsgSeq).toISOString();
    const row: MemoryMessage = {
      id,
      conversationId,
      senderHandle,
      body: clean,
      createdAt,
      readAt: null,
      flaggedAt: null,
      flaggedBy: null,
      attachmentKind: attachment?.kind ?? null,
      attachmentObjectKey: attachment?.kind === "photo" ? attachment.objectKey : null,
      attachmentWidth: attachment?.kind === "photo" ? attachment.width : null,
      attachmentHeight: attachment?.kind === "photo" ? attachment.height : null,
      attachmentVenueId: attachment?.kind === "venue" ? attachment.venueId : null,
      clientMessageId,
    };
    const list = memMessages.get(conversationId) ?? [];
    list.push(row);
    memMessages.set(conversationId, list);
    conv.lastMessageAt = createdAt;
    return { message: memMessageDTO(row), pair };
  },

  async listConversations(handle) {
    const me = normalizeHandle(handle);
    if (!me) return READY_EMPTY_INBOX;
    return {
      conversations: [...memConversations.values()]
        .filter((c) => c.handleA === me || c.handleB === me)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
        .slice(0, MAX_CONVERSATIONS)
        .map((c) => memConversationDTO(c, me)),
      status: "ready",
    };
  },

  async listMessages(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return null;
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    const pair: HandlePair = { handleA: conv.handleA, handleB: conv.handleB };
    // COURTESY CHECK — non-participant gets null (route → 404).
    if (!isParticipant(pair, me)) return null;
    const list = (memMessages.get(conversationId) ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) // newest-first cap
      .slice(0, MAX_MESSAGES)
      .reverse(); // oldest-first display
    return list.map(memMessageDTO);
  },

  async markRead(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return 0;
    const conv = memConversations.get(conversationId);
    if (!conv) return 0;
    const pair: HandlePair = { handleA: conv.handleA, handleB: conv.handleB };
    if (!isParticipant(pair, me)) return 0;
    const now = new Date().toISOString();
    let marked = 0;
    for (const m of memMessages.get(conversationId) ?? []) {
      if (m.readAt == null && m.senderHandle !== me) {
        m.readAt = now;
        marked += 1;
      }
    }
    return marked;
  },

  async participants(conversationId) {
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    return { handleA: conv.handleA, handleB: conv.handleB };
  },

  async report(conversationId, messageId, reporterHandle) {
    const reporter = normalizeHandle(reporterHandle);
    if (!conversationId || !messageId || !reporter) return false;
    const list = memMessages.get(conversationId);
    const hit = list?.find((m) => m.id === messageId);
    if (!hit) return false;
    if (hit.flaggedAt != null) return false; // already flagged
    hit.flaggedAt = new Date().toISOString();
    hit.flaggedBy = reporter;
    return true;
  },

  async photoObjectKey(conversationId, messageId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !messageId || !me) return null;
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    const pair: HandlePair = { handleA: conv.handleA, handleB: conv.handleB };
    if (!isParticipant(pair, me)) return null;
    const hit = (memMessages.get(conversationId) ?? []).find((m) => m.id === messageId);
    if (!hit) return null;
    return photoKeyFromRow({
      id: hit.id,
      conversation_id: hit.conversationId,
      flagged_at: hit.flaggedAt,
      attachment_kind: hit.attachmentKind,
      attachment_object_key: hit.attachmentObjectKey,
      attachment_width: hit.attachmentWidth,
      attachment_height: hit.attachmentHeight,
      attachment_venue_id: hit.attachmentVenueId,
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function messagesStore(): MessagesStore {
  return selectStore(memoryMessagesStore, supabaseMessagesStore);
}

/** Test-only: clear the in-memory maps between cases. */
export function __resetMemoryMessages(): void {
  memConversations.clear();
  memPairIndex.clear();
  memMessages.clear();
  memConvSeq = 0;
  memMsgSeq = 0;
}
