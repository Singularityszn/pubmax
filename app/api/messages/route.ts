// Messaging inbox + conversation open/send (PRD E4 / Wave I2).
//   GET  ?handle=<handle>              → { conversations: ConversationDTO[], status }
//   POST { action:"open", handle, other }          → { conversationId }
//   POST { action:"send", handle, other, body }    → { message }   (opens if needed)
//
// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY (Wave I2). DMs require a signed-in actor. Prefer the auth-linked
// handle when the JWT's user owns a profile; otherwise the asserted handle may
// be claimed on first write via gateHandleAction. A read is allowed only when
// that account owns the handle: an unowned row and a tombstone are refused
// the same way as a handle owned by somebody else. Unsigned requests get 401.
// The store still enforces the participant check; the DB denies all anon access
// (RLS-on / no-policy, migration 0019).
// ─────────────────────────────────────────────────────────────────────────────
//
// Reads are fail-soft so an outage never 500s the inbox, but fail-soft is not
// fail-silent: the body carries the read's own `status`, and `degraded` means a
// read could not be run rather than that there is nothing here. EVERY write action is rate-limited per handle (~20/min)
// by one limiter above the action switch, and a recipient handle must resolve to
// a live profile before any conversation row is written.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { requireLinkedActor } from "@/lib/messageAuth";
import {
  cleanGroupTitle,
  GROUP_MAX_MEMBERS,
  GROUP_MEMBER_UNKNOWN_LINE,
  GROUP_TOO_LARGE_LINE,
  GROUP_TOO_SMALL_LINE,
  normalizeGroupMembers,
} from "@/lib/messageGroupThread";
import { broadcastMessageSent, deferMessagesSignal } from "@/lib/messagesBroadcast.server";
import { attachParticipantCards } from "@/lib/messageParticipantCards.server";
import { messagesStore } from "@/lib/messagesStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  isProfileTombstoned,
  profileStore,
  type ProfileRecord,
} from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const actor = await requireLinkedActor(request, asserted);
  if (!actor.ok) {
    // No JWT and no handle → empty inbox so the page still renders.
    if (!asserted.trim()) {
      return jsonNoStore({ conversations: [], status: "ready" }, { status: 200 });
    }
    return publicApiErrorFromStatus(actor.error, actor.status);
  }
  const handle = actor.handle;
  if (!handle) return jsonNoStore({ conversations: [], status: "ready" }, { status: 200 });

  const ownership = await gateHandleAction(request, handle, actor.userId, {
    requireAccountOwner: true,
  });
  if (!ownership.allowed) {
    // Fail-soft on store outage: the page keeps rendering, and the body SAYS the
    // read failed rather than handing a stranger an empty inbox as an answer.
    // Keep 401/403 as hard errors so ownership denials stay visible.
    if (ownership.status === 503) {
      return jsonNoStore({ conversations: [], status: "degraded" }, { status: 200 });
    }
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }
  // A read that COULD NOT RUN is not an empty inbox. The rows and how well they
  // were read travel together, and the surface words the difference.
  const inbox = await messagesStore().listConversations(handle);
  return jsonNoStore(
    {
      conversations: await attachParticipantCards(inbox.conversations),
      status: inbox.status,
    },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  // Solo-operator emergency freeze (U15): opening a thread and sending a DM are
  // social writes. (Message reporting lives on /api/messages/[id] and stays open.)
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const action = readString(body.action);
  const actor = await requireLinkedActor(request, readString(body.handle) ?? "");
  if (!actor.ok) {
    return publicApiErrorFromStatus(actor.error, actor.status);
  }
  const handle = actor.handle;
  if (!handle) return publicApiError("Add your handle.", "INVALID_REQUEST", 400);

  // A GROUP IS OPENED WHOLE, so it names its members up front and takes its own
  // branch before the 1:1 door's `other` is read. Everything below it — the one
  // limiter, the ownership gate, the live-profile check — applies to both.
  const openingGroup = action === "open-group";
  const other = openingGroup ? "" : normalizeHandle(readString(body.other) ?? "");
  if (!openingGroup) {
    if (!other) return publicApiError("Add a recipient handle.", "INVALID_REQUEST", 400);
    if (handle === other) {
      return publicApiError("You can't message yourself.", "INVALID_REQUEST", 400);
    }
  }

  // ONE limiter, ABOVE the action switch AND above the ownership read it would
  // otherwise pay for. It used to sit inside `send` alone, so `open` - which
  // upserts a conversations row per distinct pair - was unbounded, and the
  // tree-wide "every mutating route consults isLimited" fence could not see the
  // gap because the file called it somewhere. Anything added below is bounded
  // by construction.
  const key = `msg-write:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) {
    return publicApiError("Too many messages, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const ownership = await gateHandleAction(request, handle, actor.userId);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // A conversation is opened WITH somebody. A handle nobody holds is not
  // somebody, and accepting one minted a durable row per fabricated name.
  if (action === "open" || action === "send") {
    let recipient: ProfileRecord | null;
    try {
      recipient = await profileStore().getByHandle(other);
    } catch {
      return publicApiError("Profile storage is unavailable.", "UNAVAILABLE", 503, {
        retryable: true,
      });
    }
    if (!recipient || isProfileTombstoned(recipient)) {
      return publicApiError("We couldn't find that person.", "NOT_FOUND", 404);
    }
  }

  const store = messagesStore();

  if (openingGroup) return openGroup(handle, body, store);

  if (action === "open") {
    const conversationId = await store.openConversation(handle, other);
    if (!conversationId) {
      return publicApiError("Couldn't open that conversation.", "UNAVAILABLE", 503, { retryable: true });
    }
    return jsonNoStore({ conversationId }, { status: 200 });
  }

  if (action === "send") {
    const messageBody = readString(body.body);
    if (!messageBody) return publicApiError("Write a message.", "INVALID_REQUEST", 400);
    const conversationId = await store.openConversation(handle, other);
    if (!conversationId) {
      return publicApiError("Couldn't open that conversation.", "UNAVAILABLE", 503, { retryable: true });
    }
    const sent = await store.send(conversationId, handle, messageBody, undefined, {
      clientMessageId: readString(body.clientMessageId) ?? undefined,
    });
    if (!sent) {
      // Store miss / write failure after validation — degraded dependency, not 400.
      return publicApiError("Couldn't send that message.", "UNAVAILABLE", 503, { retryable: true });
    }
    // The nudge is a courtesy and the row is already stored, so the 201 does not
    // wait on it: a degraded Realtime used to add its whole timeout to a send.
    deferMessagesSignal(() => broadcastMessageSent(conversationId, [handle, other]));
    return jsonNoStore({ message: sent.message, conversationId }, { status: 201 });
  }

  return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
}

/**
 * Opening a GROUP thread. A group is opened WHOLE, so its members are named up
 * front and every one of them must be somebody: a group minted around a
 * fabricated handle is a durable row with a person in it who does not exist,
 * and the thread would name them for ever.
 */
async function openGroup(
  handle: string,
  body: Record<string, unknown>,
  store: ReturnType<typeof messagesStore>,
): Promise<Response> {
  const members = normalizeGroupMembers(handle, body.participants);
  if (!members) {
    // The caps are the only two ways a list can be wrong here, and they owe
    // different sentences: one says add somebody, the other says take one off.
    const named = Array.isArray(body.participants) ? body.participants.length : 0;
    return publicApiError(
      named >= GROUP_MAX_MEMBERS ? GROUP_TOO_LARGE_LINE : GROUP_TOO_SMALL_LINE,
      "INVALID_REQUEST",
      400,
    );
  }
  for (const member of members) {
    if (member === handle) continue;
    let profile: ProfileRecord | null;
    try {
      profile = await profileStore().getByHandle(member);
    } catch {
      return publicApiError("Profile storage is unavailable.", "UNAVAILABLE", 503, {
        retryable: true,
      });
    }
    if (!profile || isProfileTombstoned(profile)) {
      return publicApiError(GROUP_MEMBER_UNKNOWN_LINE, "NOT_FOUND", 404);
    }
  }
  const opened = await store.openGroupConversation(
    handle,
    members,
    cleanGroupTitle(body.title),
  );
  if (opened.status === "invalid") {
    return publicApiError(GROUP_TOO_SMALL_LINE, "INVALID_REQUEST", 400);
  }
  if (opened.status === "unavailable") {
    return publicApiError("Couldn't start that group.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return jsonNoStore({ conversationId: opened.conversationId, members }, { status: 201 });
}
