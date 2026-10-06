// A single conversation's thread (PRD E4 / Wave I2).
//   GET  ?handle=<handle>                              → { messages: MessageDTO[] }
//   POST { action:"send",   handle, body, venueId? }   → { message }
//   POST multipart { post: <send json>, photo: <file> }→ { message }
//   POST { action:"report", handle, messageId }        → { flagged: boolean }
//
// Wave I2: requires a signed-in linked actor (401 without JWT). Linked-handle
// ownership still collapses 403 → 404 so the endpoint never confirms a private
// thread exists to an outsider.
//
// A message may carry ONE attachment (`lib/messageAttachments.ts`): a photo or
// a pub. The photo takes the whole owned-image journey - staging, EXIF strip,
// advisory scan, Blob write, write-side proof - through
// `lib/messagePhotoMedia.server.ts`, so refused bytes never reach a serving key
// and a mangled write is refused while the sender is still here to be told. The
// pub stores an id and nothing else; its name, area and any figure it is allowed
// to print are resolved on the READ path, because a price frozen into a message
// is an undated claim nobody can correct.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedFormData } from "@/lib/boundedRequest.server";
import { log } from "@/lib/log";
import {
  isMessageVenueId,
  MESSAGE_PHOTO_REFUSED_LINE,
  readMessageContactHandle,
  readMessageEventPlanId,
  type MessageAttachmentWrite,
} from "@/lib/messageAttachments";
import { requireLinkedActor } from "@/lib/messageAuth";
import {
  GROUP_LEFT_LINE,
  GROUP_MEMBER_FLOOR_LINE,
} from "@/lib/messageGroupThread";
import {
  cleanPollOptions,
  cleanPollQuestion,
  POLL_INVALID_LINE,
  POLL_VOTE_FAILED_LINE,
} from "@/lib/messagePoll";
import {
  broadcastMessageSent,
  broadcastMessagesRead,
  deferMessagesSignal,
} from "@/lib/messagesBroadcast.server";
import {
  discardStagedMessagePhoto,
  MESSAGE_PHOTO_MAX_BYTES,
  MessagePhotoError,
  prepareMessagePhoto,
  promoteStagedMessagePhoto,
  signMessagePhotoObject,
  stagePreparedMessagePhoto,
  type StagedMessagePhoto,
} from "@/lib/messagePhotoMedia.server";
import { messagePhotoRouteDeps } from "@/lib/messagePhotoRoute.server";
import { attachMessageAttachmentCards } from "@/lib/messageAttachmentCards.server";
import type { ConversationMembership, MessageDTO } from "@/lib/messages";
import { MessageReadUnavailableError, messagesStore } from "@/lib/messagesStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { scanUploadedImage } from "@/lib/uploadedImageScan.server";

assertServerEnv();

const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;

/** A photo costs a safety scan, which is a paid call anyone with a thread can
 *  spend. So the photo budget is its own, it is tighter than the text budget,
 *  and it fails CLOSED: a limiter we cannot reach refuses rather than handing
 *  the provider bill to whoever asks. */
const PHOTO_LIMIT = 12;
const PHOTO_WINDOW_MS = 60 * 60 * 1000;

/** Answering a poll costs one small write and no paid call, so the budget is
 *  looser than a send's — but it is a budget, because every mutating route
 *  consults `isLimited`. */
const VOTE_LIMIT = 60;
const VOTE_WINDOW_MS = 60_000;

type Ctx = { params: Promise<{ id: string }> };

function photoError(error: unknown): Response {
  if (error instanceof MessagePhotoError) {
    const status =
      error.code === "TOO_LARGE" ? 413 : error.code === "STORAGE_UNAVAILABLE" ? 503 : 400;
    return publicApiError(error.message, error.code, status, {
      retryable: error.code === "STORAGE_UNAVAILABLE",
    });
  }
  return publicApiError("Photo could not be processed.", "PROCESSING_FAILED", 400);
}

/** The multipart body a composer sends: one JSON part and one file. */
async function parsePhotoUpload(
  request: Request,
): Promise<{ input: Record<string, unknown>; photo: File } | null> {
  try {
    const form = await boundedFormData(request, MESSAGE_PHOTO_MAX_BYTES + 64 * 1024);
    if ([...form.keys()].some((key) => key !== "post" && key !== "photo")) return null;
    const postParts = form.getAll("post");
    const photoParts = form.getAll("photo");
    if (postParts.length !== 1 || typeof postParts[0] !== "string") return null;
    if (photoParts.length !== 1 || !(photoParts[0] instanceof File)) return null;
    const parsed: unknown = JSON.parse(postParts[0]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return { input: parsed as Record<string, unknown>, photo: photoParts[0] };
  } catch {
    return null;
  }
}

/**
 * `Server-Timing` for the thread read, so a slow open can be read off the
 * network panel as auth, gate or store rather than guessed at. Durations only;
 * no identity rides in a header.
 */
function serverTiming(marks: Array<[string, number]>): string {
  return marks.map(([name, ms]) => `${name};dur=${Math.max(0, Math.round(ms))}`).join(", ");
}

async function readThread(
  store: ReturnType<typeof messagesStore>,
  id: string,
  handle: string,
): Promise<MessageDTO[] | null | Response> {
  try {
    return await store.listMessages(id, handle);
  } catch (error) {
    if (!(error instanceof MessageReadUnavailableError)) throw error;
    return publicApiError(error.message, "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const started = performance.now();
  const { id } = await params;
  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const actor = await requireLinkedActor(request, asserted);
  if (!actor.ok) {
    return publicApiErrorFromStatus(actor.error, actor.status);
  }
  const handle = actor.handle;
  if (!handle) return publicApiError("Add your handle.", "INVALID_REQUEST", 400);
  const authDone = performance.now();

  // The bearer was verified once above; the gate takes that answer rather than
  // asking the auth server a second time on the same request. A thread read
  // requires the caller's account to own the handle, same as the inbox.
  const ownership = await gateHandleAction(request, handle, actor.userId, {
    requireAccountOwner: true,
  });
  if (!ownership.allowed) {
    if (ownership.status === 403) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }
  const gateDone = performance.now();

  const store = messagesStore();
  // The rows and WHO IS IN THE THREAD together. The header has to be able to
  // name a group by its title or its people, and a thread with no message in it
  // has no row to read a name off — which is why it used to fetch the WHOLE
  // inbox from the browser just to learn one handle.
  const [messages, membership] = await Promise.all([
    readThread(store, id, handle),
    store.membership(id),
  ]);
  if (messages instanceof Response) return messages;
  if (messages === null) {
    return publicApiError("Conversation not found.", "NOT_FOUND", 404);
  }
  // Reading the thread is what marks what was waiting as read, and only when
  // something WAS waiting: the ordinary poll of a quiet thread writes nothing.
  // The sender's thread is then nudged so its "Sent" becomes "Read" now.
  const unreadReceived = messages.some((m) => !m.read && m.senderHandle !== handle);
  if (unreadReceived) {
    const marked = await store.markRead(id, handle);
    if (marked > 0) deferMessagesSignal(() => broadcastMessagesRead(id));
  }
  const readDone = performance.now();
  return jsonNoStore(
    {
      messages: await attachMessageAttachmentCards(messages),
      // A membership we could not read is ABSENT rather than guessed: the
      // header keeps its neutral word instead of naming the wrong thread.
      ...(membership
        ? {
            conversation: {
              id,
              kind: membership.kind,
              members: membership.handles,
              ...(membership.title ? { title: membership.title } : {}),
            },
          }
        : {}),
    },
    {
      status: 200,
      headers: {
        "Server-Timing": serverTiming([
          ["auth", authDone - started],
          ["gate", gateDone - authDone],
          ["read", readDone - gateDone],
        ]),
      },
    },
  );
}

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();
  const multipart = contentType.startsWith("multipart/form-data");

  let body: Record<string, unknown>;
  let photo: File | null = null;
  if (multipart) {
    const submitted = await parsePhotoUpload(request);
    if (!submitted) {
      return publicApiError("Attach one photo and its message.", "INVALID_REQUEST", 400);
    }
    body = submitted.input;
    photo = submitted.photo;
  } else {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
    }
  }

  const action = readString(body.action);
  const actor = await requireLinkedActor(request, readString(body.handle) ?? "");
  if (!actor.ok) {
    return publicApiErrorFromStatus(actor.error, actor.status);
  }
  const handle = actor.handle;
  if (!handle) return publicApiError("Add your handle.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle, actor.userId);
  if (!ownership.allowed) {
    if (ownership.status === 403) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const store = messagesStore();

  if (!multipart && action === "report") {
    const messageId = readString(body.messageId);
    if (!messageId) return publicApiError("Missing message id.", "INVALID_REQUEST", 400);
    const thread = await readThread(store, id, handle);
    if (thread instanceof Response) return thread;
    if (thread === null) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    const flagged = await store.report(id, messageId, handle);
    return jsonNoStore({ flagged }, { status: 200 });
  }

  // ANSWERING A POLL IS NOT SENDING A MESSAGE, and LEAVING A GROUP is not
  // either: a tap on a poll button and a departure both write a row nobody
  // reads as words, so neither takes the send budget or the social freeze.
  // Both are still WRITES, so each takes a limiter of its own.
  if (!multipart && (action === "vote" || action === "leave")) {
    return action === "vote"
      ? voteOnPoll(request, { conversationId: id, handle, body, store })
      : leaveGroup(request, { conversationId: id, handle, store });
  }

  if (action !== "send") {
    return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
  }

  // Solo-operator emergency freeze (U15): sending is a social write. The
  // `report` branch above returns first, so reporting a message stays OPEN.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const key = `msg-send:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) {
    return publicApiError("Too many messages, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const messageBody = readString(body.body) ?? "";

  if (photo) {
    return sendPhoto(request, { conversationId: id, handle, messageBody, photo, store });
  }

  const parsed = readSendAttachment(body);
  if (parsed instanceof Response) return parsed;
  const attachment = parsed;

  if (!messageBody && !attachment) {
    return publicApiError("Write a message.", "INVALID_REQUEST", 400);
  }

  const sent = await store.send(id, handle, messageBody, attachment, {
    clientMessageId: readString(body.clientMessageId) ?? undefined,
  });
  if (!sent) {
    return publicApiError("Conversation not found.", "NOT_FOUND", 404);
  }
  signalSent(id, sent.membership);
  return jsonNoStore(
    { message: (await attachMessageAttachmentCards([sent.message]))[0] },
    { status: 201 },
  );
}

/**
 * WHAT RIDES WITH ONE SEND, read off an untrusted body.
 *
 * EVERY POINTING KIND STORES AN ID AND NOTHING ELSE. No coordinate of any kind
 * rides here (the viewer-coordinate egress law is untouched), no name, no face
 * and no time: the card is resolved on the READ path, so a rename reads
 * correctly in an old thread and a moved plan is never quoted back out of one.
 * A poll points at nothing, so it carries its own ballot.
 *
 * AT MOST ONE, and naming two is a refusal rather than a silent pick: a
 * composer that sends a pub and a poll together has a bug in it, and choosing
 * for it would hide the bug in somebody's thread.
 */
function readSendAttachment(
  body: Record<string, unknown>,
): MessageAttachmentWrite | undefined | Response {
  const named = [body.venueId, body.contactHandle, body.planId, body.poll].filter(
    (value) => value !== undefined && value !== null,
  ).length;
  if (named > 1) {
    return publicApiError("One attachment at a time.", "INVALID_REQUEST", 400);
  }

  const venueId = readString(body.venueId);
  if (venueId !== undefined) {
    if (!isMessageVenueId(venueId)) {
      return publicApiError("Choose a pub.", "INVALID_REQUEST", 400);
    }
    return { kind: "venue", venueId };
  }
  if (body.contactHandle !== undefined && body.contactHandle !== null) {
    const contactHandle = readMessageContactHandle(body.contactHandle);
    if (!contactHandle) {
      return publicApiError("Choose a handle to share.", "INVALID_REQUEST", 400);
    }
    return { kind: "contact", handle: contactHandle };
  }
  if (body.planId !== undefined && body.planId !== null) {
    const planId = readMessageEventPlanId(body.planId);
    if (!planId) {
      return publicApiError("Choose a plan to share.", "INVALID_REQUEST", 400);
    }
    return { kind: "event", planId };
  }
  if (body.poll !== undefined && body.poll !== null) {
    const poll = body.poll as Record<string, unknown>;
    const question = cleanPollQuestion(poll?.question);
    const options = cleanPollOptions(poll?.options);
    if (!question || !options) {
      return publicApiError(POLL_INVALID_LINE, "INVALID_REQUEST", 400);
    }
    return { kind: "poll", question, options };
  }
  return undefined;
}

/**
 * One answer to one poll. ONE refusal covers an unknown conversation, an
 * outsider, a message that is not a poll and an option the ballot does not
 * carry, so it says nothing about which of them it was.
 */
async function voteOnPoll(
  request: Request,
  input: {
    conversationId: string;
    handle: string;
    body: Record<string, unknown>;
    store: ReturnType<typeof messagesStore>;
  },
): Promise<Response> {
  const { conversationId, handle, body, store } = input;
  const messageId = readString(body.messageId);
  if (!messageId) return publicApiError("Missing message id.", "INVALID_REQUEST", 400);
  const key = `msg-vote:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, VOTE_LIMIT, VOTE_WINDOW_MS)) {
    return publicApiError("Too many taps, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  const optionIndex = typeof body.optionIndex === "number" ? body.optionIndex : Number.NaN;
  const poll = await store.votePoll(conversationId, messageId, handle, optionIndex);
  if (!poll) return publicApiError(POLL_VOTE_FAILED_LINE, "NOT_FOUND", 404);
  return jsonNoStore({ poll }, { status: 200 });
}

/**
 * Leaving a group. A DIRECT conversation answers the same 404 an outsider
 * gets: half of two people's record of talking to each other is not the
 * leaver's to take away.
 */
async function leaveGroup(
  request: Request,
  input: {
    conversationId: string;
    handle: string;
    store: ReturnType<typeof messagesStore>;
  },
): Promise<Response> {
  const { conversationId, handle, store } = input;
  const key = `msg-leave:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  const outcome = await store.leaveGroupConversation(conversationId, handle);
  if (outcome === "left") return jsonNoStore({ left: true, line: GROUP_LEFT_LINE });
  if (outcome === "floor") {
    return publicApiError(GROUP_MEMBER_FLOOR_LINE, "GROUP_MEMBER_FLOOR", 409);
  }
  if (outcome === "unavailable") {
    return publicApiError("Couldn't leave that group just now.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return publicApiError("Conversation not found.", "NOT_FOUND", 404);
}

/**
 * The row is stored; tell every open surface. Never a reason to fail the send:
 * a nudge that could not go out leaves the poll fallback to carry it, so this
 * is handed to the platform rather than awaited before the 201. The MEMBERSHIP
 * comes from the write that just proved it, not from a second read of the
 * conversation the send had already loaded — and because it is a membership
 * rather than a pair, a group of nine is nine inbox topics with nothing here
 * changed.
 */
function signalSent(
  conversationId: string,
  membership: ConversationMembership,
): void {
  deferMessagesSignal(() =>
    broadcastMessageSent(conversationId, [...membership.handles]),
  );
}

async function sendPhoto(
  request: Request,
  input: {
    conversationId: string;
    handle: string;
    messageBody: string;
    photo: File;
    store: ReturnType<typeof messagesStore>;
  },
): Promise<Response> {
  const { conversationId, handle, messageBody, photo, store } = input;

  const budgetKey = `msg-photo:${handle}:${hashIp(clientIp(request))}`;
  if (
    await isLimited(budgetKey, budgetKey, PHOTO_LIMIT, PHOTO_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many photos, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  // Nothing is prepared, staged or scanned before the courtesy check has said
  // this is the sender's own conversation: a stranger must not be able to spend
  // a scan on an id they guessed.
  const thread = await readThread(store, conversationId, handle);
  if (thread instanceof Response) return thread;
  if (thread === null) {
    return publicApiError("Conversation not found.", "NOT_FOUND", 404);
  }

  const messageId = crypto.randomUUID();
  const { storage, moderation } = messagePhotoRouteDeps();
  let staged: StagedMessagePhoto | null = null;
  try {
    const prepared = await prepareMessagePhoto(photo);
    staged = await stagePreparedMessagePhoto(conversationId, messageId, prepared, storage);

    const signedUrl = await signMessagePhotoObject(staged.stagingKey, storage);
    const scan = await scanUploadedImage({
      surface: "message-photo",
      signedUrl,
      adapter: moderation,
    });

    if (scan.verdict === "refused") {
      // Refused bytes never reach the serving key, so nothing was ever one
      // request away from being readable.
      await discardStagedMessagePhoto(staged, storage);
      staged = null;
      return publicApiError(MESSAGE_PHOTO_REFUSED_LINE, "PHOTO_REFUSED", 400);
    }

    const promoted = await promoteStagedMessagePhoto(staged, storage);
    staged = null;

    const sent = await store.send(conversationId, handle, messageBody, {
      kind: "photo",
      messageId,
      objectKey: promoted.objectKey,
      width: promoted.width,
      height: promoted.height,
    });
    if (!sent) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    signalSent(conversationId, sent.membership);
    return jsonNoStore({ message: sent.message }, { status: 201 });
  } catch (error) {
    if (staged) {
      try {
        await discardStagedMessagePhoto(staged, storage);
      } catch {
        // Swallow cleanup errors so the original failure is what is reported.
      }
    }
    if (error instanceof MessagePhotoError) return photoError(error);
    log("error", "message_photo.send_failed", {
      route: "POST /api/messages/[id]",
      error: error instanceof Error ? error.message : String(error),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
