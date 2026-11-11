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
// must not silently vanish). Failed thread reads raise MessageReadUnavailableError;
// healthy empty threads return []. Inbox failures carry a degraded status.

import {
  isMessageAttachmentKind,
  isMessagePhotoServingKey,
  messageAttachmentPreview,
  messagePhotoServePath,
  messagePhotoServingKey,
  type MessageAttachment,
  type MessageAttachmentKind,
  type MessageAttachmentWrite,
} from "@/lib/messageAttachments";
import {
  GROUP_MAX_MEMBERS,
  GROUP_MIN_MEMBERS,
  type GroupMemberRole,
} from "@/lib/messageGroupThread";
import {
  pollResults,
  readStoredPollOptions,
  type MessagePollView,
} from "@/lib/messagePoll";
import { MESSAGE_UNSENT_LINE } from "@/lib/messageRemovals";
import {
  cleanAttachedBody,
  cleanBody,
  isMember,
  membershipFromPair,
  normalizePair,
  otherMembers,
  unreadForViewer,
  type ConversationDTO,
  type ConversationKind,
  type ConversationMembership,
  type HandlePair,
  type MessageDTO,
} from "@/lib/messages";
import { normalizeHandle } from "@/lib/profiles";
import {
  admin,
  errorMessage,
  missingTables,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requiresSupabaseStore } from "@/lib/supabase";

// Hard caps so one busy handle can't return an unbounded payload.
const MAX_CONVERSATIONS = 100;
export const MAX_MESSAGES = 200;
// The inbox read's two windows (see listConversations): how many unread rows
// one inbox is counted over, and how many recent rows per conversation the
// newest-first window fetches to find each conversation's last message.
export const INBOX_UNREAD_SCAN_CAP = 1_000;
export const INBOX_LAST_MESSAGE_WINDOW = 4;

/**
 * What a send is worth to its caller: the stored row, and the MEMBERSHIP the
 * write had to load anyway to prove the sender belongs in this conversation.
 *
 * It used to be a `HandlePair`, which said 1:1 in the type itself. It is a
 * membership now (docs/adr/0015-group-message-threads.md), so the caller can
 * name every participant's inbox topic off the write rather than a second read,
 * whether the thread holds two people or twelve.
 */
type MessageSendResult = Readonly<{
  message: MessageDTO;
  membership: ConversationMembership;
}>;

/** What opening a group answered. `unavailable` is a read we could not run. */
type GroupOpenOutcome =
  | { status: "opened"; conversationId: string }
  | { status: "invalid" }
  | { status: "unavailable" };

/**
 * What leaving a group answered. There is no floor: a small group is not a
 * trap, so the last few may leave like anybody else. A second leave by the
 * same person answers `left` again.
 */
type GroupLeaveOutcome = "left" | "not-member" | "unavailable";

/**
 * What unsending one message answered (lib/messageRemovals.ts). `not-found`
 * covers an unknown id, an outsider and somebody else's message alike, so the
 * refusal says nothing about which it was. `photoObjectKey` names the bytes
 * the caller must now delete; it is null when there are none to delete, which
 * includes a reported photo kept for the moderator.
 */
type UnsendOutcome =
  | {
      status: "unsent";
      membership: ConversationMembership;
      photoObjectKey: string | null;
    }
  | { status: "not-found" }
  | { status: "unavailable" };

/** What deleting a chat for one person answered. */
type ChatDeleteOutcome = "deleted" | "not-member" | "unavailable";

/**
 * `clientMessageId` is the id the SENDER minted for this attempt, before the
 * request left the browser. It is the idempotency key: a connection reset after
 * the row committed used to leave the message stored, the optimistic bubble
 * removed and the text back in the field, so the drinker sent it again and
 * there were two. With a key, the retry finds the row it already wrote and is
 * handed that one back. A caller that omits the key receives no duplicate
 * protection.
 */
type MessageSendOptions = Readonly<{
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
type InboxReadStatus = "ready" | "degraded";

export type InboxRead = Readonly<{
  conversations: ConversationDTO[];
  status: InboxReadStatus;
}>;

export class MessageReadUnavailableError extends Error {
  constructor() {
    super("Messages are unavailable right now.");
    this.name = "MessageReadUnavailableError";
  }
}

export type MessagesStore = {
  /** Find-or-create the DIRECT conversation for an unordered pair. Returns the
   *  conversation id, or null when the pair is invalid (blank / self-pair).
   *
   *  A direct conversation's membership is its own PAIR COLUMNS, which is why
   *  this stays keyed on a pair and why nothing is written to the members
   *  table for one: one authority per kind, so the two cannot drift. */
  openConversation(a: string, b: string): Promise<string | null>;
  /** The id of the DIRECT conversation an unordered pair already has, or null
   *  when there is none (or the pair is invalid). Never creates one. Throws
   *  when the store cannot answer, so a caller can refuse rather than guess.
   *  The mates-only rule asks it, because only a NEW conversation needs mates
   *  (lib/messageSafety.ts). */
  findConversation(a: string, b: string): Promise<string | null>;
  /** Open a GROUP thread with its members named up front. A group is opened
   *  whole; adding somebody later is deliberately not in this vocabulary
   *  (docs/adr/0015-group-message-threads.md).
   *
   *  `members` must already be normalised and capped by
   *  `normalizeGroupMembers` — the store re-checks the caps rather than
   *  trusting the caller, but it does not re-derive who is in the list. */
  openGroupConversation(
    creator: string,
    members: readonly string[],
    title: string | null,
  ): Promise<GroupOpenOutcome>;
  /** Leave a group. A direct conversation cannot be left: it is two people's
   *  record of talking to each other, and half of it is not the leaver's to
   *  take away. */
  leaveGroupConversation(
    conversationId: string,
    handle: string,
  ): Promise<GroupLeaveOutcome>;
  /** Unsend ONE message, for everybody. Only its sender, while still in the
   *  conversation, may do it. The row stays as a tombstone that reads as
   *  `unsent`; its words, attachment and poll answers go, unless it was
   *  reported, when the content stays for the moderator and no reader is ever
   *  shown it again. A second unsend answers `unsent` again. */
  unsendMessage(
    conversationId: string,
    messageId: string,
    handle: string,
  ): Promise<UnsendOutcome>;
  /** Delete a whole conversation from ONE member's inbox. Everybody else
   *  keeps it. A message sent later brings it back for this member, holding
   *  only what was said after the delete. */
  deleteConversationForViewer(
    conversationId: string,
    handle: string,
  ): Promise<ChatDeleteOutcome>;
  /** Append a message. `sender` must be a participant of the conversation and
   *  the message must carry SOMETHING: a body that survives cleaning, an
   *  attachment, or both. Returns the stored row TOGETHER WITH the pair, or
   *  null on any reject (unknown conversation, non-participant sender, nothing
   *  to send).
   *
   *  THE MEMBERSHIP RIDES BACK because the write already proved it: both
   *  implementations load the conversation to run the participant check, and
   *  the caller needs the same handles to name the inbox topics its send
   *  signal goes to. Asking `membership` again afterwards was a second round
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
  /** Record ONE answer to a poll. The voter must be a participant and the
   *  option must be one the message really carries; anything else answers null
   *  and nothing is written. Returns the poll as that voter now reads it, so
   *  the composer never has to refetch a thread to show its own answer.
   *
   *  Re-answering REPLACES, because one person is one vote. */
  votePoll(
    conversationId: string,
    messageId: string,
    handle: string,
    optionIndex: number,
  ): Promise<MessagePollView | null>;
  /** A conversation's thread, oldest-first, ONLY IF `handle` is a participant.
   *  A non-participant (or unknown conversation) gets null — the caller turns
   *  that into a 404 so a thread never leaks. A READ and nothing else: marking
   *  what the viewer received as read is `markRead`, asked by the thread route
   *  alone, so a photo send or a report (which read the thread to prove
   *  participation) cannot mark anything read. Failed durable reads throw
   *  MessageReadUnavailableError; a healthy empty thread returns []. */
  listMessages(conversationId: string, handle: string): Promise<MessageDTO[] | null>;
  /** Mark the viewer's RECEIVED unread messages read. Returns how many rows
   *  changed, so the route can tell the sender's thread only when something did.
   *  A non-participant marks nothing and gets 0. Never throws. */
  markRead(conversationId: string, handle: string): Promise<number>;
  /** Who is in a conversation, or null when it is unknown or the read failed.
   *  For naming who a send signal is for, and for a header that has to say
   *  what a thread is called; never a participant check on its own. */
  membership(conversationId: string): Promise<ConversationMembership | null>;
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
const CONVERSATION_MEMBERS = "conversation_members";
const MESSAGES = "messages";
const POLL_VOTES = "message_poll_votes";
const CONVERSATION_DELETIONS = "conversation_deletions";
const memoryFallbackWarnings = new Set<string>();

// ONE column list behind every message read, so a lane that forgot the
// attachment columns cannot quietly serve a photo message as a bare line of
// text — the same reason the public profile has one projection.
const MESSAGE_COLUMNS_BASE =
  "id, conversation_id, sender_handle, body, created_at, read_at, flagged_at, " +
  "attachment_kind, attachment_object_key, attachment_width, attachment_height, attachment_venue_id";

/** The columns migration 0156 adds. Named once, so the rollout guard below and
 *  the read list cannot name different sets. */
const WIDE_ATTACHMENT_COLUMNS = [
  "attachment_contact_handle",
  "attachment_plan_id",
  "attachment_poll_question",
  "attachment_poll_options",
] as const;

const MESSAGE_COLUMNS_WIDE = `${MESSAGE_COLUMNS_BASE}, ${WIDE_ATTACHMENT_COLUMNS.join(", ")}`;

/**
 * ADDITIVE-ROLLOUT LATCH for migration 0156, in the shape lib/pintDropsStore.ts
 * uses for every other additive column. A deploy that lands ahead of the
 * migration must still serve threads: the first read that 42703s on one of the
 * new columns drops the process to the pre-0156 list, and a message a drinker
 * sent is never lost to a column that is not there.
 *
 * A WRITE of one of the new kinds is REFUSED rather than downgraded. Saving a
 * contact card as a bare line of text is the half-pint defect wearing a
 * different hat: the attachment would be silently gone and nobody told.
 */
let wideAttachmentColumns = true;

function messageColumns(): string {
  const columns = wideAttachmentColumns ? MESSAGE_COLUMNS_WIDE : MESSAGE_COLUMNS_BASE;
  return `${columns}, unsent_at`;
}

function isMissingWideAttachmentColumn(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code !== "42703" && code !== "PGRST204") return false;
  const message = (error.message ?? "").toLowerCase();
  return WIDE_ATTACHMENT_COLUMNS.some((column) => message.includes(column));
}

/** Latch the process down to the pre-0156 list. Returns true when it moved. */
function dropToBaseAttachmentColumns(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!wideAttachmentColumns || !isMissingWideAttachmentColumn(error)) return false;
  wideAttachmentColumns = false;
  console.warn(
    "[messages] attachment columns missing — serving the pre-0156 attachment set (apply migration 0156)",
  );
  return true;
}

const isMissingGroupSchema = missingTables(CONVERSATION_MEMBERS);
const isMissingPollSchema = missingTables(POLL_VOTES);
const isMissingDeletionSchema = missingTables(CONVERSATION_DELETIONS);

/** The columns a conversation row is read through, everywhere. */
const CONVERSATION_COLUMNS = "id, handle_a, handle_b, last_message_at, kind, title";
const CONVERSATION_COLUMNS_BASE = "id, handle_a, handle_b, last_message_at";

/** The same latch, for migration 0155's own columns. */
let groupConversationColumns = true;

function conversationColumns(): string {
  return groupConversationColumns ? CONVERSATION_COLUMNS : CONVERSATION_COLUMNS_BASE;
}

function isMissingGroupColumn(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code !== "42703" && code !== "PGRST204") return false;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("kind") || message.includes("title");
}

function dropToBaseConversationColumns(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!groupConversationColumns || !isMissingGroupColumn(error)) return false;
  groupConversationColumns = false;
  console.warn(
    "[messages] conversation kind missing — every thread reads as direct (apply migration 0155)",
  );
  return true;
}

/**
 * The inbox preview for one last message. Words when there are words; otherwise
 * the noun for what it carried, because a blank row reads as a message that did
 * not arrive.
 */
function previewBody(row: Record<string, unknown>): string {
  if (row.unsent_at != null) return MESSAGE_UNSENT_LINE;
  const body = String(row.body ?? "");
  if (body) return body;
  const kind = row.attachment_kind;
  return isMessageAttachmentKind(kind) ? messageAttachmentPreview(kind) : "";
}

/**
 * A Postgres timestamp to the microsecond, so a stored `created_at` and a
 * delete mark compare exactly. `Date.parse` stops at the millisecond, and a
 * message 400 microseconds after a delete must not read as before it.
 */
function stampMicros(stamp: string): number {
  const fraction = /\.(\d+)/.exec(stamp)?.[1] ?? "";
  const millis = Date.parse(stamp.replace(/\.\d+/, ""));
  if (!Number.isFinite(millis)) return Number.NaN;
  return millis * 1000 + Number(`${fraction}000000`.slice(0, 6));
}

/**
 * True when `createdAt` is after a delete mark, or there is no mark. A stamp
 * that will not parse is shown: hiding it could hide a message nobody deleted.
 */
function afterDeleteMark(createdAt: unknown, mark: string | undefined): boolean {
  if (!mark) return true;
  const at = stampMicros(String(createdAt ?? ""));
  const cut = stampMicros(mark);
  if (!Number.isFinite(at) || !Number.isFinite(cut)) return true;
  return at > cut;
}

/** The later of now and the newest message, as the delete mark to store. */
function deleteMarkFor(newestCreatedAt: string | null): string {
  const now = new Date().toISOString();
  if (!newestCreatedAt) return now;
  return stampMicros(newestCreatedAt) > stampMicros(now) ? newestCreatedAt : now;
}

/**
 * The insert half of the same list. A message with no attachment writes nulls,
 * and every kind writes ONLY its own columns — the shape CHECK in migration
 * 0156 refuses anything else, so the two say one sentence.
 */
function attachmentColumns(
  attachment: MessageAttachmentWrite | undefined,
): Record<string, unknown> {
  if (!attachment) return {};
  switch (attachment.kind) {
    case "venue":
      return { attachment_kind: "venue", attachment_venue_id: attachment.venueId };
    case "contact":
      return { attachment_kind: "contact", attachment_contact_handle: attachment.handle };
    case "event":
      return { attachment_kind: "event", attachment_plan_id: attachment.planId };
    case "poll":
      return {
        attachment_kind: "poll",
        attachment_poll_question: attachment.question,
        attachment_poll_options: [...attachment.options],
      };
    case "photo":
    default:
      return {
        id: attachment.messageId,
        attachment_kind: "photo",
        attachment_object_key: attachment.objectKey,
        attachment_width: attachment.width,
        attachment_height: attachment.height,
      };
  }
}

/**
 * Which kinds need a column migration 0156 added. A write of one of these
 * against a pre-0156 database is refused rather than downgraded (see the latch
 * above), because a contact card saved as a blank line is an attachment nobody
 * was told had gone.
 */
function needsWideAttachmentColumns(
  attachment: MessageAttachmentWrite | undefined,
): boolean {
  if (!attachment) return false;
  return (
    attachment.kind === "contact" ||
    attachment.kind === "event" ||
    attachment.kind === "poll"
  );
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
function rowToAttachment(
  row: Record<string, unknown>,
  polls?: PollReadContext,
): MessageAttachment | undefined {
  if (row.flagged_at != null) return undefined;
  const kind = row.attachment_kind;
  if (kind === "venue") {
    const venueId = typeof row.attachment_venue_id === "string" ? row.attachment_venue_id : "";
    return venueId ? { kind: "venue", venueId, card: null } : undefined;
  }
  if (kind === "contact") {
    const handle = normalizeHandle(String(row.attachment_contact_handle ?? ""));
    return handle ? { kind: "contact", handle, card: null } : undefined;
  }
  if (kind === "event") {
    const planId =
      typeof row.attachment_plan_id === "string" ? row.attachment_plan_id : "";
    return planId ? { kind: "event", planId, card: null } : undefined;
  }
  if (kind === "poll") {
    const question =
      typeof row.attachment_poll_question === "string" ? row.attachment_poll_question : "";
    const options = readStoredPollOptions(row.attachment_poll_options);
    // A ballot that no longer parses is not rendered as an empty poll: the
    // message keeps its words and the attachment is simply absent, the same
    // answer a photo whose key does not match its row gets.
    if (!question || !options) return undefined;
    const messageId = String(row.id ?? "");
    return {
      kind: "poll",
      poll: pollResults(
        question,
        options,
        polls?.votesByMessage.get(messageId) ?? EMPTY_VOTES,
        polls?.viewer ?? "",
      ),
    };
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

/**
 * What a thread read knows about its polls: every vote on it, and WHO is
 * reading. The votes are folded into counts by `pollResults` and the handles
 * never leave this module — a reader is told the totals and their OWN answer,
 * and that is the whole of it (lib/messagePoll.ts rule 2).
 */
type PollReadContext = {
  viewer: string;
  votesByMessage: ReadonlyMap<string, ReadonlyMap<string, number>>;
};

const EMPTY_VOTES: ReadonlyMap<string, number> = new Map();
const EMPTY_POLL_VOTES: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map();

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

/**
 * A WRITE that met a missing table answers from process memory only off
 * production. In production it is refused through the store's own failure
 * value: a message or a report held in one instance's memory is lost on the
 * next cold start while the sender was told it was saved.
 */
function memoryWriteOffProduction<T>(
  context: string,
  refused: T,
  fallback: () => Promise<T>,
): Promise<T> {
  return onMissingDurableWrite({
    storeTag: "messages",
    migrationHint: `apply the messages migrations before ${context}`,
    fallback,
    onProduction: async (error) => {
      console.error(error.message);
      return refused;
    },
  });
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
/** Each conversation this viewer deleted, and the mark it was deleted at. */
type InboxDeletions = { byConversation: Map<string, string>; degraded: boolean };
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
 * rows in whatever order the index gave - under 0143's partial index that is
 * conversation_id order, so the lowest-sorting ids ate the budget and every
 * conversation after them reported a confident `unread: 0` (F-9). Ordering
 * makes the truncation KNOWABLE: when the window filled, every conversation the
 * scan reached except the last one it saw is complete, and the rest are re-asked
 * one by one with their own bounded count.
 *
 * A scan that could not run at all reports `degraded` and counts nothing, so no
 * caller can read a failed count as an empty one.
 */
async function readInboxUnread(
  ids: readonly string[],
  me: string,
  deletionsRead: Promise<InboxDeletions>,
): Promise<InboxUnread> {
  const byConversation = new Map<string, number>();
  let rows: Array<Record<string, unknown>>;
  try {
    const { data, error } = await admin()
      .from(MESSAGES)
      .select("conversation_id, created_at")
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
  // A message from before this viewer deleted the chat is not waiting for
  // them: they put it away.
  const deletions = (await deletionsRead).byConversation;
  for (const row of rows) {
    const id = String(row.conversation_id);
    if (!afterDeleteMark(row.created_at, deletions.get(id))) continue;
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
        const mark = deletions.get(id);
        const query = admin()
          .from(MESSAGES)
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", id)
          .neq("sender_handle", me)
          .is("read_at", null);
        const { count, error } = await (mark ? query.gt("created_at", mark) : query);
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

function inboxLastColumns(): string {
  const columns = "conversation_id, sender_handle, body, attachment_kind, created_at";
  return `${columns}, unsent_at`;
}

/** Every chat this viewer deleted, among the inbox's conversations. */
async function readInboxDeletions(ids: readonly string[], me: string): Promise<InboxDeletions> {
  const byConversation = new Map<string, string>();
  try {
    const { data, error } = await admin()
      .from(CONVERSATION_DELETIONS)
      .select("conversation_id, deleted_at")
      .eq("handle", me)
      .in("conversation_id", [...ids]);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.conversation_id ?? "");
      if (id && row.deleted_at) byConversation.set(id, String(row.deleted_at));
    }
    return { byConversation, degraded: false };
  } catch (err) {
    // Before the apply nobody has deleted a chat, which is a whole answer.
    if (isMissingDeletionSchema(err)) return { byConversation, degraded: false };
    console.error(
      "[messages] inbox deletions read failed:",
      err instanceof Error ? err.message : err,
    );
    return { byConversation, degraded: true };
  }
}

/** The newest-first window that holds each conversation's last message. */
async function readInboxRecent(ids: readonly string[]): Promise<InboxRecent> {
  const lastByConversation = new Map<string, Record<string, unknown>>();
  const window = ids.length * INBOX_LAST_MESSAGE_WINDOW;
  let rows: Array<Record<string, unknown>>;
  try {
    const { data, error } = await admin()
      .from(MESSAGES)
      .select(inboxLastColumns())
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(window);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
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
        // A memory id would also send every later write down the memory fast
        // path in `send`, past that method's own guard, so this door refuses too.
        return memoryWriteOffProduction("openConversation", null, () =>
          memoryMessagesStore.openConversation(a, b),
        );
      }
      console.error(
        "[messages] openConversation failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },

  async findConversation(a, b) {
    const pair = normalizePair(a, b);
    if (!pair) return null;
    try {
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
        warnMemoryFallback("findConversation", err);
        return memoryMessagesStore.findConversation(a, b);
      }
      throw err;
    }
  },

  async openGroupConversation(creator, members, title) {
    const owner = normalizeHandle(creator);
    const handles = members.map((member) => normalizeHandle(member)).filter(Boolean);
    // The caps are re-checked here rather than trusted off the caller: the
    // store is the last door in front of a durable row.
    if (
      !owner ||
      !handles.includes(owner) ||
      handles.length < GROUP_MIN_MEMBERS ||
      handles.length > GROUP_MAX_MEMBERS ||
      new Set(handles).size !== handles.length
    ) {
      return { status: "invalid" };
    }
    try {
      const { data, error } = await admin()
        .from(CONVERSATIONS)
        .insert({ kind: "group", title, created_by_handle: owner })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const conversationId = String((data as { id: unknown }).id);
      const rows = handles.map((handle) => ({
        conversation_id: conversationId,
        handle,
        role: (handle === owner ? "owner" : "member") satisfies GroupMemberRole,
      }));
      const { error: memberError } = await admin().from(CONVERSATION_MEMBERS).insert(rows);
      if (memberError) {
        // A group with no members is a row nobody can reach, so the
        // conversation goes with the failed membership rather than being left
        // behind as an orphan somebody's inbox could never show.
        await admin().from(CONVERSATIONS).delete().eq("id", conversationId);
        throw new Error(memberError.message);
      }
      return { status: "opened", conversationId };
    } catch (err) {
      if (isMissingMessagesSchema(err) || isMissingGroupSchema(err)) {
        warnMemoryFallback("openGroupConversation", err);
        return memoryWriteOffProduction<GroupOpenOutcome>(
          "openGroupConversation",
          { status: "unavailable" },
          () => memoryMessagesStore.openGroupConversation(owner, handles, title),
        );
      }
      console.error(
        "[messages] openGroupConversation failed:",
        err instanceof Error ? err.message : err,
      );
      return { status: "unavailable" };
    }
  },

  async leaveGroupConversation(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return "not-member";
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.leaveGroupConversation(conversationId, me);
    }
    try {
      // ONE WRITE, AND IT IS ITS OWN ANSWER. Only a group has member rows, so a
      // direct conversation (which cannot be left: half of two people's record
      // of talking to each other is not the leaver's to take away) and an
      // outsider both match nothing. A seat already left keeps its first
      // `left_at` and answers `left` again.
      const { data, error } = await admin()
        .from(CONVERSATION_MEMBERS)
        .update({ left_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("handle", me)
        .is("left_at", null)
        .select("handle");
      if (error) throw new Error(error.message);
      if (Array.isArray(data) && data.length > 0) return "left";
      const { data: seat, error: seatError } = await admin()
        .from(CONVERSATION_MEMBERS)
        .select("handle")
        .eq("conversation_id", conversationId)
        .eq("handle", me)
        .not("left_at", "is", null)
        .limit(1)
        .maybeSingle();
      if (seatError) throw new Error(seatError.message);
      return seat ? "left" : "not-member";
    } catch (err) {
      if (isMissingMessagesSchema(err) || isMissingGroupSchema(err)) {
        warnMemoryFallback("leaveGroupConversation", err);
        return memoryWriteOffProduction<GroupLeaveOutcome>("leaveGroupConversation", "unavailable", () =>
          memoryMessagesStore.leaveGroupConversation(conversationId, me),
        );
      }
      console.error(
        "[messages] leaveGroupConversation failed:",
        err instanceof Error ? err.message : err,
      );
      return "unavailable";
    }
  },

  async unsendMessage(conversationId, messageId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !messageId || !me) return UNSEND_NOT_FOUND;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.unsendMessage(conversationId, messageId, me);
    }
    // A durable message id is a uuid. Anything else names nothing, and asking
    // Postgres would turn a typo into an outage answer.
    const id = readClientMessageId(messageId);
    if (!id) return UNSEND_NOT_FOUND;
    try {
      const membership = await loadMembership(conversationId);
      if (!membership || !isMember(membership, me)) return UNSEND_NOT_FOUND;
      const read = await admin()
        .from(MESSAGES)
        .select("id, sender_handle, attachment_kind, unsent_at")
        .eq("conversation_id", conversationId)
        .eq("id", id)
        .limit(1)
        .maybeSingle();
      if (read.error) throw new Error(read.error.message);
      const row = read.data as Record<string, unknown> | null;
      // ONLY THE SENDER, and the refusal is the one an unknown id gets.
      if (!row || normalizeHandle(String(row.sender_handle ?? "")) !== me) {
        return UNSEND_NOT_FOUND;
      }
      if (row.unsent_at != null) {
        return { status: "unsent", membership, photoObjectKey: null };
      }
      const unsentAt = new Date().toISOString();
      // The words, the attachment and the ballot go, but only while nobody has
      // reported it: the guard is in the same statement, so a report landing
      // a moment earlier cannot be wiped out from under the moderator.
      const wiped = await admin()
        .from(MESSAGES)
        .update({ unsent_at: unsentAt, body: "", ...emptyAttachmentColumns() })
        .eq("conversation_id", conversationId)
        .eq("id", id)
        .eq("sender_handle", String(row.sender_handle))
        .is("unsent_at", null)
        .is("flagged_at", null)
        .select("id");
      if (wiped.error) throw new Error(wiped.error.message);
      if (Array.isArray(wiped.data) && wiped.data.length > 0) {
        if (row.attachment_kind === "poll") await deletePollVotes(id);
        return {
          status: "unsent",
          membership,
          photoObjectKey:
            row.attachment_kind === "photo" ? messagePhotoServingKey(conversationId, id) : null,
        };
      }
      // Reported: the content stays for the moderator, and the mark alone
      // takes it off every reader's screen.
      const kept = await admin()
        .from(MESSAGES)
        .update({ unsent_at: unsentAt })
        .eq("conversation_id", conversationId)
        .eq("id", id)
        .eq("sender_handle", String(row.sender_handle))
        .is("unsent_at", null)
        .select("id");
      if (kept.error) throw new Error(kept.error.message);
      return { status: "unsent", membership, photoObjectKey: null };
    } catch (err) {
      console.error(
        "[messages] unsendMessage failed:",
        err instanceof Error ? err.message : err,
      );
      return { status: "unavailable" };
    }
  },

  async deleteConversationForViewer(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return "not-member";
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.deleteConversationForViewer(conversationId, me);
    }
    try {
      const [membership, newest] = await Promise.all([
        loadMembership(conversationId),
        admin()
          .from(MESSAGES)
          .select("created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!membership || !isMember(membership, me)) return "not-member";
      if (newest.error) throw new Error(newest.error.message);
      // THE MARK IS NEVER BEFORE THE NEWEST MESSAGE, so a clock a little behind
      // the database cannot leave the last line of a deleted chat behind.
      const newestAt = (newest.data as { created_at?: unknown } | null)?.created_at;
      const deletedAt = deleteMarkFor(typeof newestAt === "string" ? newestAt : null);
      const { error } = await admin().rpc("delete_conversation_for_viewer", {
        p_conversation_id: conversationId,
        p_handle: me,
        p_deleted_at: deletedAt,
      });
      if (error) throw new Error(error.message);
      return "deleted";
    } catch (err) {
      console.error(
        isMissingDeletionSchema(err)
          ? "[messages] deleteConversationForViewer: conversation_deletions missing (apply migration 0230)"
          : "[messages] deleteConversationForViewer failed:",
        err instanceof Error ? err.message : err,
      );
      return "unavailable";
    }
  },

  async send(conversationId, sender, body, attachment, options) {
    const senderHandle = normalizeHandle(sender);
    const clean = attachment ? cleanAttachedBody(body) : cleanBody(body);
    if (!conversationId || !senderHandle || clean === null) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.send(conversationId, senderHandle, clean, attachment, options);
    }
    // A kind whose column is not there yet is REFUSED rather than downgraded
    // to a bare line of text, so an attachment is never silently dropped.
    if (!wideAttachmentColumns && needsWideAttachmentColumns(attachment)) return null;
    const clientMessageId = readClientMessageId(options?.clientMessageId);
    try {
      const membership = await loadMembership(conversationId);
      if (!membership || !isMember(membership, senderHandle)) return null;
      const row = {
        conversation_id: conversationId,
        sender_handle: senderHandle,
        body: clean,
        ...attachmentColumns(attachment),
      };
      const insertRow = () =>
        clientMessageId
          ? admin()
              .from(MESSAGES)
              .insert({ ...row, client_message_id: clientMessageId })
              .select(messageColumns())
              .single()
          : admin().from(MESSAGES).insert(row).select(messageColumns()).single();

      let inserted = await insertRow();

      while (dropToBaseAttachmentColumns(inserted.error)) {
        inserted = await insertRow();
      }

      if (clientMessageId && isMissingClientMessageIdColumn(inserted.error)) {
        // Migration 0149 has not landed yet. A message a drinker sent must not
        // be lost to a column that is not there; the retry writes the row
        // without the key and simply is not idempotent until the deploy
        // catches up (the same additive-rollout rule as vibe_tags / measure).
        inserted = await admin().from(MESSAGES).insert(row).select(messageColumns()).single();
      } else if (clientMessageId && isDuplicateClientMessageId(inserted.error)) {
        // THIS EXACT ATTEMPT IS ALREADY STORED. The first request committed and
        // its answer never reached the sender, so hand back the row it wrote
        // rather than a second copy of the same message.
        const replayed = await loadByClientMessageId(conversationId, clientMessageId);
        if (replayed) return { message: replayed, membership };
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
        message: rowToMessageDTO(inserted.data as unknown as Record<string, unknown>, {
          viewer: senderHandle,
          votesByMessage: EMPTY_POLL_VOTES,
        }),
        membership,
      };
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("send", err);
        return memoryWriteOffProduction("send", null, () =>
          memoryMessagesStore.send(conversationId, senderHandle, clean, attachment, options),
        );
      }
      console.error("[messages] send failed:", err instanceof Error ? err.message : err);
      return null;
    }
  },

  async votePoll(conversationId, messageId, handle, optionIndex) {
    const me = normalizeHandle(handle);
    if (!conversationId || !messageId || !me) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.votePoll(conversationId, messageId, me, optionIndex);
    }
    try {
      const membership = await loadMembership(conversationId);
      if (!membership || !isMember(membership, me)) return null;
      let selected = await admin()
        .from(MESSAGES)
        .select(messageColumns())
        .eq("conversation_id", conversationId)
        .eq("id", messageId)
        .limit(1)
        .maybeSingle();
      if (dropToBaseAttachmentColumns(selected.error)) {
        selected = await admin()
          .from(MESSAGES)
          .select(messageColumns())
          .eq("conversation_id", conversationId)
          .eq("id", messageId)
          .limit(1)
          .maybeSingle();
      }
      if (selected.error) throw new Error(selected.error.message);
      if (!selected.data) return null;
      const row = selected.data as unknown as Record<string, unknown>;
      // The BALLOT decides which options exist, so a vote for an option the
      // message does not carry is refused rather than counted as nothing.
      const attachment = rowToAttachment(row);
      if (attachment?.kind !== "poll") return null;
      if (
        !Number.isInteger(optionIndex) ||
        optionIndex < 0 ||
        optionIndex >= attachment.poll.options.length
      ) {
        return null;
      }
      const now = new Date().toISOString();
      const { error } = await admin()
        .from(POLL_VOTES)
        .upsert(
          {
            message_id: messageId,
            voter_handle: me,
            option_index: optionIndex,
            updated_at: now,
          },
          { onConflict: "message_id,voter_handle" },
        );
      if (error) throw new Error(error.message);
      const votes = await loadPollVotes([messageId]);
      const reread = rowToAttachment(row, {
        viewer: me,
        votesByMessage: votes,
      });
      return reread?.kind === "poll" ? reread.poll : null;
    } catch (err) {
      if (isMissingMessagesSchema(err) || isMissingPollSchema(err)) {
        warnMemoryFallback("votePoll", err);
        return memoryWriteOffProduction("votePoll", null, () =>
          memoryMessagesStore.votePoll(conversationId, messageId, me, optionIndex),
        );
      }
      console.error("[messages] votePoll failed:", err instanceof Error ? err.message : err);
      return null;
    }
  },

  async listConversations(handle) {
    const me = normalizeHandle(handle);
    if (!me) return READY_EMPTY_INBOX;
    let rows: Array<Record<string, unknown>>;
    let groupMembership = new Map<string, ConversationMembership>();
    let lanesDegraded = false;
    try {
      // Conversation-row and deletion-marker reads establish what can be shown.
      // Their failures may empty the inbox. Individual latest-message failures
      // follow visibleConversationRows. Unread and preview failures are caught
      // by their own helpers.
      //
      // TWO LANES, because a conversation's kind names its membership
      // authority: the pair columns find every DM, and the members table finds
      // every group this handle is live in. They are read in parallel and
      // merged, so one inbox is one sorted list whatever a row's kind is.
      const [direct, groupIds] = await Promise.all([
        readDirectConversationRows(me),
        readGroupConversationIds(me),
      ]);
      const groups = await readGroupConversationRows(groupIds, me);
      lanesDegraded = direct.degraded || groups.degraded;
      groupMembership = await readGroupMembershipBatch(groups.rows);
      // DEDUPED BY ID, because two lanes read one table: a row that somehow
      // answered both must be ONE inbox row, or a reader meets the same thread
      // twice and the unread counts are asked for it twice.
      const byId = new Map<string, Record<string, unknown>>();
      for (const row of [...direct.rows, ...groups.rows]) {
        const id = String(row.id ?? "");
        if (id && !byId.has(id)) byId.set(id, row);
      }
      rows = newestFirst([...byId.values()]).slice(0, MAX_CONVERSATIONS);
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("listConversations", err);
        return memoryMessagesStore.listConversations(me);
      }
      console.error(
        "[messages] listConversations failed - inbox unreadable:",
        err instanceof Error ? err.message : err,
      );
      return { conversations: [], status: "degraded" };
    }
    if (rows.length === 0) return READY_EMPTY_INBOX;

    const ids = rows.map((row) => String(row.id));
    const deletionsRead = readInboxDeletions(ids, me);
    // Batch unread messages, recent previews and deletion marks for the inbox.
    // Each bounded message window queries conversations it did not reach
    // separately, so a busy thread cannot hide a quiet one.
    const [unread, recent, deletions] = await Promise.all([
      readInboxUnread(ids, me, deletionsRead),
      readInboxRecent(ids),
      deletionsRead,
    ]);

    if (deletions.degraded) return { conversations: [], status: "degraded" };

    const lastByConversation = recent.lastByConversation;
    if (recent.windowFull) {
      const missing = ids.filter((id) => !lastByConversation.has(id));
      await Promise.all(
        missing.map(async (id) => {
          try {
            const { data: one, error } = await admin()
              .from(MESSAGES)
              .select(inboxLastColumns())
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
      const newest = lastByConversation.get(id);
      // A chat kept by a failed restored-chat read may hold only deleted history.
      const last = newest && afterDeleteMark(newest.created_at, deletions.byConversation.get(id))
        ? newest
        : undefined;
      const counted = unread.byConversation.get(id);
      return {
        id,
        ...conversationRowIdentity(row, groupMembership.get(id) ?? null, me),
        ...(last ? { lastBody: previewBody(last) } : {}),
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
      status: unread.degraded || recent.degraded || lanesDegraded ? "degraded" : "ready",
    };
  },

  async listMessages(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.listMessages(conversationId, me);
    }
    try {
      // The membership and the rows are asked for TOGETHER, keyed on the same
      // id, so a thread open is one round trip's wait rather than two in a row.
      // The rows are still only RETURNED behind the courtesy check below.
      const readRows = () =>
        admin()
          .from(MESSAGES)
          .select(messageColumns())
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(MAX_MESSAGES);
      const [membership, firstRead, deleteMark] = await Promise.all([
        loadMembership(conversationId),
        readRows(),
        loadDeleteMark(conversationId, me),
      ]);
      // COURTESY CHECK: a non-participant (or unknown conversation) gets null →
      // the route turns that into a 404. Never return another thread.
      if (!membership || !isMember(membership, me)) return null;
      const selected = dropToBaseAttachmentColumns(firstRead.error)
        ? await readRows()
        : firstRead;
      if (selected.error) throw new Error(selected.error.message);
      // What this reader deleted stays deleted for them, and only for them.
      const rows = ((selected.data ?? []) as unknown as Array<Record<string, unknown>>)
        .filter((row) => afterDeleteMark(row.created_at, deleteMark ?? undefined))
        .reverse();
      // A thread with no poll in it costs no second read.
      const votesByMessage = await loadPollVotes(pollMessageIds(rows));
      const polls: PollReadContext = { viewer: me, votesByMessage };
      return rows.map((r) => rowToMessageDTO(r, polls));
    } catch (err) {
      if (isMissingMessagesSchema(err) && !requiresSupabaseStore()) {
        warnMemoryFallback("listMessages", err);
        return memoryMessagesStore.listMessages(conversationId, me);
      }
      console.error(
        "[messages] listMessages failed:",
        err instanceof Error ? err.message : err,
      );
      throw new MessageReadUnavailableError();
    }
  },

  async markRead(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return 0;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.markRead(conversationId, me);
    }
    try {
      const membership = await loadMembership(conversationId);
      if (!membership || !isMember(membership, me)) return 0;
      const deleteMark = await loadDeleteMark(conversationId, me);
      let query = admin()
        .from(MESSAGES)
        .update({ read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .neq("sender_handle", me)
        .is("read_at", null);
      if (deleteMark) query = query.gt("created_at", deleteMark);
      const { data, error } = await query.select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data.length : 0;
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("markRead", err);
        return memoryWriteOffProduction("markRead", 0, () =>
          memoryMessagesStore.markRead(conversationId, me),
        );
      }
      console.error("[messages] markRead failed:", err instanceof Error ? err.message : err);
      return 0;
    }
  },

  async membership(conversationId) {
    if (!conversationId) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.membership(conversationId);
    }
    try {
      return await loadMembership(conversationId);
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("membership", err);
        return memoryMessagesStore.membership(conversationId);
      }
      console.error(
        "[messages] membership failed:",
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
        return memoryWriteOffProduction("report", false, () =>
          memoryMessagesStore.report(conversationId, messageId, reporter),
        );
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
      const membership = await loadMembership(conversationId);
      // COURTESY CHECK, the same one the thread read makes. A non-participant
      // never learns whether the id exists.
      if (!membership || !isMember(membership, me)) return null;
      const readRow = () =>
        admin()
          .from(MESSAGES)
          .select(messageColumns())
          .eq("conversation_id", conversationId)
          .eq("id", messageId)
          .limit(1)
          .maybeSingle();
      const first = await readRow();
      const { data, error } = dropToBaseAttachmentColumns(first.error)
        ? await readRow()
        : first;
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

const UNSEND_NOT_FOUND: UnsendOutcome = { status: "not-found" };

/** Every attachment column, emptied, for the columns this database has. */
function emptyAttachmentColumns(): Record<string, null> {
  const columns: Record<string, null> = {
    attachment_kind: null,
    attachment_object_key: null,
    attachment_width: null,
    attachment_height: null,
    attachment_venue_id: null,
  };
  if (wideAttachmentColumns) {
    for (const column of WIDE_ATTACHMENT_COLUMNS) columns[column] = null;
  }
  return columns;
}

/** An unsent poll's answers go with its ballot. A failure leaves only counts
 *  nobody can read any more, so it is logged rather than undoing the unsend. */
async function deletePollVotes(messageId: string): Promise<void> {
  try {
    const { error } = await admin().from(POLL_VOTES).delete().eq("message_id", messageId);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isMissingPollSchema(err)) return;
    console.error(
      "[messages] unsent poll votes delete failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * When this reader deleted this chat, or null when they never did. A read we
 * could not run THROWS: answering "never" would put back on their screen
 * every line they deleted.
 */
async function loadDeleteMark(conversationId: string, me: string): Promise<string | null> {
  try {
    const { data, error } = await admin()
      .from(CONVERSATION_DELETIONS)
      .select("deleted_at")
      .eq("conversation_id", conversationId)
      .eq("handle", me)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const mark = (data as { deleted_at?: unknown } | null)?.deleted_at;
    return typeof mark === "string" && mark ? mark : null;
  } catch (err) {
    // Before the apply nobody has deleted a chat.
    if (isMissingDeletionSchema(err)) return null;
    throw err;
  }
}

// The serving key a row is allowed to hand out, through the SAME attachment
// projection the thread reads — so a reported photo, a text message and a
// mismatched key are one answer here exactly as they are there.
function photoKeyFromRow(row: Record<string, unknown>): string | null {
  const attachment = rowToAttachment(row);
  if (!attachment || attachment.kind !== "photo") return null;
  return messagePhotoServingKey(String(row.conversation_id ?? ""), String(row.id ?? ""));
}

/**
 * WHO IS IN ONE CONVERSATION, through the single reader every courtesy check
 * asks. The kind chooses the authority (docs/adr/0015-group-message-threads.md):
 * a direct row's membership is its own pair columns and a group row's is the
 * members table, so the two can never drift into disagreeing about a 1:1.
 *
 * Returns null on any miss. Kept private to the Supabase path.
 */
async function loadMembership(
  conversationId: string,
): Promise<ConversationMembership | null> {
  let selected = await admin()
    .from(CONVERSATIONS)
    .select(conversationColumns())
    .eq("id", conversationId)
    .limit(1)
    .maybeSingle();
  if (dropToBaseConversationColumns(selected.error)) {
    selected = await admin()
      .from(CONVERSATIONS)
      .select(conversationColumns())
      .eq("id", conversationId)
      .limit(1)
      .maybeSingle();
  }
  if (selected.error) throw new Error(selected.error.message);
  if (!selected.data) return null;
  return membershipForRow(selected.data as unknown as Record<string, unknown>);
}

async function membershipForRow(
  row: Record<string, unknown>,
): Promise<ConversationMembership | null> {
  if (row.kind !== "group") {
    const pair = normalizePair(String(row.handle_a ?? ""), String(row.handle_b ?? ""));
    return pair ? membershipFromPair(pair) : null;
  }
  const handles = await loadGroupMembers(String(row.id ?? ""));
  if (handles === null) return null;
  return {
    kind: "group",
    handles,
    title: typeof row.title === "string" && row.title ? row.title : null,
  };
}

/** Inbox rows from one lane, and whether a read that judged them failed. */
type InboxLane = { rows: Array<Record<string, unknown>>; degraded: boolean };

function newestFirst(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.sort((a, b) =>
    String(b.last_message_at ?? "").localeCompare(String(a.last_message_at ?? "")),
  );
}

/** Every DIRECT conversation this handle is in. The pair columns find them. */
async function readDirectConversationRows(me: string): Promise<InboxLane> {
  const visible: Array<Record<string, unknown>> = [];
  let degraded = false;
  for (let offset = 0; visible.length < MAX_CONVERSATIONS; offset += MAX_CONVERSATIONS) {
    const read = () =>
      admin()
        .from(CONVERSATIONS)
        .select(conversationColumns())
        .or(`handle_a.eq.${me},handle_b.eq.${me}`)
        .order("last_message_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + MAX_CONVERSATIONS - 1);
    const first = await read();
    const { data, error } = dropToBaseConversationColumns(first.error) ? await read() : first;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const page = await visibleConversationRows(rows.filter((row) => row.kind !== "group"), me);
    degraded ||= page.degraded;
    visible.push(...page.rows);
    if (rows.length < MAX_CONVERSATIONS) break;
  }
  return { rows: newestFirst(visible).slice(0, MAX_CONVERSATIONS), degraded };
}

/**
 * Every GROUP this handle is LIVE in. A read we could not run answers an empty
 * list rather than throwing: a groups table that is not there yet, or one read
 * that failed, may not empty an inbox full of DMs (the F-10 rule).
 */
async function readGroupConversationIds(me: string): Promise<string[]> {
  try {
    const ids: string[] = [];
    for (let offset = 0; ; offset += MAX_CONVERSATIONS) {
      const { data, error } = await admin()
        .from(CONVERSATION_MEMBERS)
        .select("conversation_id")
        .eq("handle", me)
        .is("left_at", null)
        .order("conversation_id", { ascending: true })
        .range(offset, offset + MAX_CONVERSATIONS - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      ids.push(...rows.map((row) => String(row.conversation_id ?? "")).filter(Boolean));
      if (rows.length < MAX_CONVERSATIONS) return ids;
    }
  } catch (err) {
    if (!isMissingGroupSchema(err)) {
      console.error(
        "[messages] inbox group lane failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return [];
  }
}

/**
 * A successful latest-message read replaces the denormalised timestamp with
 * created_at for a restored row. A failed read keeps its row and degrades the
 * lane, so healthy chats survive. The inbox preview must still apply the
 * deletion mark because retaining the row does not prove it has new messages.
 */
async function visibleConversationRows(
  rows: Array<Record<string, unknown>>,
  me: string,
): Promise<InboxLane> {
  if (rows.length === 0) return { rows, degraded: false };
  const deletions = await readInboxDeletions(rows.map((row) => String(row.id)), me);
  if (deletions.degraded) throw new MessageReadUnavailableError();
  let degraded = false;
  const judged = await Promise.all(rows.map(async (row) => {
    const id = String(row.id);
    const mark = deletions.byConversation.get(id);
    if (!mark) return row;
    try {
      const { data, error } = await admin()
        .from(MESSAGES)
        .select("created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data === null || !afterDeleteMark(data.created_at, mark)) return null;
      return { ...row, last_message_at: data.created_at };
    } catch (err) {
      degraded = true;
      console.error(
        "[messages] inbox restored-chat read failed:",
        err instanceof Error ? err.message : err,
      );
      return row;
    }
  }));
  return { rows: judged.filter((row) => row !== null), degraded };
}

async function readGroupConversationRows(
  ids: readonly string[],
  me: string,
): Promise<InboxLane> {
  const visible: Array<Record<string, unknown>> = [];
  let degraded = false;
  for (let offset = 0; offset < ids.length; offset += MAX_CONVERSATIONS) {
    let rows: Array<Record<string, unknown>>;
    try {
      const { data, error } = await admin()
        .from(CONVERSATIONS)
        .select(conversationColumns())
        .in("id", ids.slice(offset, offset + MAX_CONVERSATIONS))
        .order("last_message_at", { ascending: false });
      if (error) throw new Error(error.message);
      rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    } catch (err) {
      console.error("[messages] inbox group rows failed:", err instanceof Error ? err.message : err);
      return { rows: [], degraded: false };
    }
    const chunk = await visibleConversationRows(rows, me);
    degraded ||= chunk.degraded;
    visible.push(...chunk.rows);
  }
  return { rows: newestFirst(visible).slice(0, MAX_CONVERSATIONS), degraded };
}

/** Every group row's live membership, in ONE read rather than one per row. */
async function readGroupMembershipBatch(
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<Map<string, ConversationMembership>> {
  const byConversation = new Map<string, ConversationMembership>();
  const ids = rows.map((row) => String(row.id ?? "")).filter((id) => id.length > 0);
  if (ids.length === 0) return byConversation;
  const handles = new Map<string, string[]>();
  try {
    const { data, error } = await admin()
      .from(CONVERSATION_MEMBERS)
      .select("conversation_id, handle, joined_at")
      .in("conversation_id", ids)
      .is("left_at", null)
      .order("joined_at", { ascending: true });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.conversation_id ?? "");
      const handle = normalizeHandle(String(row.handle ?? ""));
      if (!id || !handle) continue;
      const list = handles.get(id) ?? [];
      list.push(handle);
      handles.set(id, list);
    }
  } catch (err) {
    console.error(
      "[messages] inbox group membership failed:",
      err instanceof Error ? err.message : err,
    );
  }
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    byConversation.set(id, {
      kind: "group",
      handles: handles.get(id) ?? [],
      title: typeof row.title === "string" && row.title ? row.title : null,
    });
  }
  return byConversation;
}

/**
 * The identity half of ONE inbox row: who it is with, what kind it is, and (for
 * a group) its name and its people.
 *
 * `otherHandle` is filled for BOTH kinds, because every surface reading the
 * inbox already draws a face from it. On a group it is the first other member,
 * so the monogram has a handle; what the row is CALLED is
 * `conversationRowName`, which reads the title or the people.
 */
function conversationRowIdentity(
  row: Record<string, unknown>,
  membership: ConversationMembership | null,
  me: string,
): Pick<ConversationDTO, "otherHandle"> & Partial<ConversationDTO> {
  if (row.kind !== "group" || !membership) {
    const other =
      normalizeHandle(String(row.handle_a ?? "")) === me
        ? String(row.handle_b ?? "")
        : String(row.handle_a ?? "");
    return { otherHandle: normalizeHandle(other) };
  }
  const others = otherMembers(membership, me);
  return {
    otherHandle: others[0] ?? "",
    kind: "group",
    memberHandles: membership.handles,
    ...(membership.title ? { title: membership.title } : {}),
  };
}

/** The LIVE members of one group, in join order. Null when the read failed. */
async function loadGroupMembers(conversationId: string): Promise<string[] | null> {
  if (!conversationId) return null;
  const { data, error } = await admin()
    .from(CONVERSATION_MEMBERS)
    .select("handle, joined_at")
    .eq("conversation_id", conversationId)
    .is("left_at", null)
    .order("joined_at", { ascending: true })
    .limit(GROUP_MAX_MEMBERS);
  if (error) throw new Error(error.message);
  const handles = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => normalizeHandle(String(row.handle ?? "")))
    .filter((handle) => handle.length > 0);
  return handles;
}

/**
 * Every vote on the polls in one thread, keyed by message. ONE read for the
 * whole thread rather than one per poll, the same shape the inbox's batched
 * reads take. A read that could not run answers an empty map, so a poll shows
 * its ballot with no counts rather than the thread failing over a tally.
 */
async function loadPollVotes(
  messageIds: readonly string[],
): Promise<Map<string, Map<string, number>>> {
  const byMessage = new Map<string, Map<string, number>>();
  if (messageIds.length === 0) return byMessage;
  try {
    const { data, error } = await admin()
      .from(POLL_VOTES)
      .select("message_id, voter_handle, option_index")
      .in("message_id", [...messageIds]);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const messageId = String(row.message_id ?? "");
      const voter = normalizeHandle(String(row.voter_handle ?? ""));
      const index = Number(row.option_index);
      if (!messageId || !voter || !Number.isInteger(index)) continue;
      const votes = byMessage.get(messageId) ?? new Map<string, number>();
      votes.set(voter, index);
      byMessage.set(messageId, votes);
    }
  } catch (err) {
    if (!isMissingPollSchema(err)) {
      console.error(
        "[messages] poll votes read failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return byMessage;
}

/** The poll ids in a thread, so a thread with no poll costs no second read. */
function pollMessageIds(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.attachment_kind === "poll" && row.flagged_at == null) {
      ids.push(String(row.id ?? ""));
    }
  }
  return ids.filter((id) => id.length > 0);
}

// The row ONE send attempt already wrote, found by the sender's own key. Only
// ever asked after a duplicate-key conflict, so a null here means the conflict
// was about something else and the caller must still fail loudly.
async function loadByClientMessageId(
  conversationId: string,
  clientMessageId: string,
): Promise<MessageDTO | null> {
  const read = () =>
    admin()
      .from(MESSAGES)
      .select(messageColumns())
      .eq("conversation_id", conversationId)
      .eq("client_message_id", clientMessageId)
      .limit(1)
      .maybeSingle();
  const first = await read();
  const { data, error } = dropToBaseAttachmentColumns(first.error) ? await read() : first;
  if (error) throw new Error(error.message);
  return data ? rowToMessageDTO(data as unknown as Record<string, unknown>) : null;
}

function rowToMessageDTO(
  row: Record<string, unknown>,
  polls?: PollReadContext,
): MessageDTO {
  // AN UNSENT MESSAGE IS A LINE, NOT ITS CONTENT. A reported one still holds
  // its words for the moderator, so the mark decides, never what is left.
  if (row.unsent_at != null) {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id ?? ""),
      senderHandle: normalizeHandle(String(row.sender_handle ?? "")),
      body: "",
      createdAt: String(row.created_at ?? new Date(0).toISOString()),
      read: row.read_at != null,
      flagged: row.flagged_at != null,
      unsent: true,
    };
  }
  const attachment = rowToAttachment(row, polls);
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
  kind: ConversationKind;
  /** Direct only. A group carries no pair, exactly as the table does not. */
  handleA: string | null;
  handleB: string | null;
  title: string | null;
  /** Group only. Live members, in join order; a leaver is spliced out. */
  members: string[];
  /** Group only. Who left, so a second leave answers like the first. */
  leftMembers: string[];
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
  attachmentKind: MessageAttachmentKind | null;
  attachmentObjectKey: string | null;
  attachmentWidth: number | null;
  attachmentHeight: number | null;
  attachmentVenueId: string | null;
  attachmentContactHandle: string | null;
  attachmentPlanId: string | null;
  attachmentPollQuestion: string | null;
  attachmentPollOptions: string[] | null;
  /** voter handle → option index. One person is one vote, so it is a map. */
  pollVotes: Map<string, number>;
  /** The sender's own id for the attempt that wrote this row, when it sent one. */
  clientMessageId: string | null;
  unsentAt: string | null;
};

const memConversations = new Map<string, MemoryConversation>();
const memPairIndex = new Map<string, string>(); // "handleA|handleB" → conversation id
const memMessages = new Map<string, MemoryMessage[]>(); // conversation id → messages
const memDeletions = new Map<string, Map<string, string>>(); // conversation id → handle → mark
let memConvSeq = 0;
let memMsgSeq = 0;

function pairKey(pair: HandlePair): string {
  return `${pair.handleA}|${pair.handleB}`;
}

/** The ONE reader, exactly as the durable path has one: the kind picks. */
function memMembership(conv: MemoryConversation): ConversationMembership | null {
  if (conv.kind === "group") {
    return { kind: "group", handles: [...conv.members], title: conv.title };
  }
  const pair = normalizePair(conv.handleA ?? "", conv.handleB ?? "");
  return pair ? membershipFromPair(pair) : null;
}

/** This reader's view of one conversation: everything after their delete. */
function memVisibleMessages(conversationId: string, me: string): MemoryMessage[] {
  const mark = memDeletions.get(conversationId)?.get(me);
  return (memMessages.get(conversationId) ?? []).filter((m) =>
    afterDeleteMark(m.createdAt, mark),
  );
}

function memConversationDTO(conv: MemoryConversation, me: string): ConversationDTO {
  const membership = memMembership(conv);
  const others = membership ? otherMembers(membership, me) : [];
  const list = memVisibleMessages(conv.id, me)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest-first
  const last = list[0];
  return {
    id: conv.id,
    otherHandle: others[0] ?? "",
    ...(conv.kind === "group"
      ? {
          kind: "group" as const,
          memberHandles: [...conv.members],
          ...(conv.title ? { title: conv.title } : {}),
        }
      : {}),
    ...(last
      ? {
          lastBody: previewBody({
            body: last.body,
            attachment_kind: last.attachmentKind,
            unsent_at: last.unsentAt,
          }),
        }
      : {}),
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
function memMessageDTO(m: MemoryMessage, viewer = ""): MessageDTO {
  return rowToMessageDTO(
    {
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
      attachment_contact_handle: m.attachmentContactHandle,
      attachment_plan_id: m.attachmentPlanId,
      attachment_poll_question: m.attachmentPollQuestion,
      attachment_poll_options: m.attachmentPollOptions,
      unsent_at: m.unsentAt,
    },
    { viewer, votesByMessage: new Map([[m.id, m.pollVotes]]) },
  );
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
      kind: "direct",
      handleA: pair.handleA,
      handleB: pair.handleB,
      title: null,
      members: [],
      leftMembers: [],
      lastMessageAt: now,
    });
    memPairIndex.set(key, id);
    memMessages.set(id, []);
    return id;
  },

  async findConversation(a, b) {
    const pair = normalizePair(a, b);
    if (!pair) return null;
    return memPairIndex.get(pairKey(pair)) ?? null;
  },

  async openGroupConversation(creator, members, title) {
    const owner = normalizeHandle(creator);
    const handles = members.map((member) => normalizeHandle(member)).filter(Boolean);
    if (
      !owner ||
      !handles.includes(owner) ||
      handles.length < GROUP_MIN_MEMBERS ||
      handles.length > GROUP_MAX_MEMBERS ||
      new Set(handles).size !== handles.length
    ) {
      return { status: "invalid" };
    }
    const id = `c${++memConvSeq}`;
    const now = new Date(Date.now() + memConvSeq).toISOString();
    memConversations.set(id, {
      id,
      kind: "group",
      handleA: null,
      handleB: null,
      title,
      // The owner first, so the join order the durable path reads back is the
      // order this one keeps.
      members: [owner, ...handles.filter((handle) => handle !== owner)],
      leftMembers: [],
      lastMessageAt: now,
    });
    memMessages.set(id, []);
    return { status: "opened", conversationId: id };
  },

  async leaveGroupConversation(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return "not-member";
    const conv = memConversations.get(conversationId);
    if (!conv || conv.kind !== "group") return "not-member";
    if (conv.leftMembers.includes(me)) return "left";
    if (!conv.members.includes(me)) return "not-member";
    conv.members = conv.members.filter((member) => member !== me);
    conv.leftMembers.push(me);
    return "left";
  },

  async unsendMessage(conversationId, messageId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !messageId || !me) return UNSEND_NOT_FOUND;
    const conv = memConversations.get(conversationId);
    const membership = conv ? memMembership(conv) : null;
    if (!membership || !isMember(membership, me)) return UNSEND_NOT_FOUND;
    const hit = (memMessages.get(conversationId) ?? []).find((m) => m.id === messageId);
    if (!hit || hit.senderHandle !== me) return UNSEND_NOT_FOUND;
    if (hit.unsentAt != null) return { status: "unsent", membership, photoObjectKey: null };
    hit.unsentAt = new Date().toISOString();
    // A reported message keeps its content for the moderator.
    if (hit.flaggedAt != null) return { status: "unsent", membership, photoObjectKey: null };
    const photoObjectKey =
      hit.attachmentKind === "photo" ? messagePhotoServingKey(conversationId, hit.id) : null;
    hit.body = "";
    hit.attachmentKind = null;
    hit.attachmentObjectKey = null;
    hit.attachmentWidth = null;
    hit.attachmentHeight = null;
    hit.attachmentVenueId = null;
    hit.attachmentContactHandle = null;
    hit.attachmentPlanId = null;
    hit.attachmentPollQuestion = null;
    hit.attachmentPollOptions = null;
    hit.pollVotes.clear();
    return { status: "unsent", membership, photoObjectKey };
  },

  async deleteConversationForViewer(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return "not-member";
    const conv = memConversations.get(conversationId);
    const membership = conv ? memMembership(conv) : null;
    if (!membership || !isMember(membership, me)) return "not-member";
    const newest = (memMessages.get(conversationId) ?? []).reduce<string | null>(
      (latest, m) => (latest === null || m.createdAt > latest ? m.createdAt : latest),
      null,
    );
    const marks = memDeletions.get(conversationId) ?? new Map<string, string>();
    const next = deleteMarkFor(newest);
    const previous = marks.get(me);
    marks.set(me, previous && !afterDeleteMark(next, previous) ? previous : next);
    memDeletions.set(conversationId, marks);
    return "deleted";
  },

  async send(conversationId, sender, body, attachment, options) {
    const senderHandle = normalizeHandle(sender);
    const clean = attachment ? cleanAttachedBody(body) : cleanBody(body);
    if (!conversationId || !senderHandle || clean === null) return null;
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    const membership = memMembership(conv);
    if (!membership || !isMember(membership, senderHandle)) return null;
    // The same idempotency the durable backend gets from 0149's unique index,
    // so a retry behaves alike on a keyless dev server and in production.
    const clientMessageId = readClientMessageId(options?.clientMessageId);
    if (clientMessageId) {
      const already = (memMessages.get(conversationId) ?? []).find(
        (candidate) => candidate.clientMessageId === clientMessageId,
      );
      if (already) {
        return { message: memMessageDTO(already, senderHandle), membership };
      }
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
      attachmentContactHandle: attachment?.kind === "contact" ? attachment.handle : null,
      attachmentPlanId: attachment?.kind === "event" ? attachment.planId : null,
      attachmentPollQuestion: attachment?.kind === "poll" ? attachment.question : null,
      attachmentPollOptions: attachment?.kind === "poll" ? [...attachment.options] : null,
      pollVotes: new Map<string, number>(),
      clientMessageId,
      unsentAt: null,
    };
    const list = memMessages.get(conversationId) ?? [];
    list.push(row);
    memMessages.set(conversationId, list);
    conv.lastMessageAt = createdAt;
    return { message: memMessageDTO(row, senderHandle), membership };
  },

  async votePoll(conversationId, messageId, handle, optionIndex) {
    const me = normalizeHandle(handle);
    if (!conversationId || !messageId || !me) return null;
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    const membership = memMembership(conv);
    if (!membership || !isMember(membership, me)) return null;
    const hit = (memMessages.get(conversationId) ?? []).find((m) => m.id === messageId);
    if (!hit || hit.flaggedAt != null) return null;
    const options = hit.attachmentPollOptions;
    if (hit.attachmentKind !== "poll" || !options) return null;
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
      return null;
    }
    hit.pollVotes.set(me, optionIndex);
    const attachment = memMessageDTO(hit, me).attachment;
    return attachment?.kind === "poll" ? attachment.poll : null;
  },

  async listConversations(handle) {
    const me = normalizeHandle(handle);
    if (!me) return READY_EMPTY_INBOX;
    return {
      conversations: [...memConversations.values()]
        .filter((c) => {
          const membership = memMembership(c);
          if (membership === null || !isMember(membership, me)) return false;
          // A deleted chat comes back only with something said after it.
          return !memDeletions.get(c.id)?.has(me) || memVisibleMessages(c.id, me).length > 0;
        })
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
    const membership = memMembership(conv);
    // COURTESY CHECK — non-participant gets null (route → 404).
    if (!membership || !isMember(membership, me)) return null;
    const list = memVisibleMessages(conversationId, me)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) // newest-first cap
      .slice(0, MAX_MESSAGES)
      .reverse(); // oldest-first display
    return list.map((m) => memMessageDTO(m, me));
  },

  async markRead(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return 0;
    const conv = memConversations.get(conversationId);
    if (!conv) return 0;
    const membership = memMembership(conv);
    if (!membership || !isMember(membership, me)) return 0;
    const now = new Date().toISOString();
    let marked = 0;
    for (const m of memVisibleMessages(conversationId, me)) {
      if (m.readAt == null && m.senderHandle !== me) {
        m.readAt = now;
        marked += 1;
      }
    }
    return marked;
  },

  async membership(conversationId) {
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    return memMembership(conv);
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
    const membership = memMembership(conv);
    if (!membership || !isMember(membership, me)) return null;
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
  memDeletions.clear();
  memConvSeq = 0;
  memMsgSeq = 0;
}
