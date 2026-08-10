// Messaging inbox + conversation open/send (PRD E4 / Wave I2).
//   GET  ?handle=<handle>                          → { conversations: ConversationDTO[] }
//   POST { action:"open", handle, other }          → { conversationId }
//   POST { action:"send", handle, other, body }    → { message }   (opens if needed)
//
// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY (Wave I2). DMs require a signed-in actor. Prefer the auth-linked
// handle when the JWT's user owns a profile; otherwise the asserted handle may
// be claimed on first write via gateHandleAction. Unsigned requests get 401.
// The store still enforces the participant check; the DB denies all anon access
// (RLS-on / no-policy, migration 0019).
// ─────────────────────────────────────────────────────────────────────────────
//
// Reads are fail-soft (the store returns an empty inbox on error) so an outage
// never 500s the inbox. Sends are rate-limited per handle (~20/min).

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { requireLinkedActor } from "@/lib/messageAuth";
import { messagesStore } from "@/lib/messagesStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;
const OPEN_LIMIT = 20;
const OPEN_WINDOW_MS = 60_000;

async function activeRecipient(handle: string): Promise<
  { ok: true } | { ok: false; response: Response }
> {
  try {
    const profile = await profileStore().getByHandle(handle);
    if (!profile || !profile.userId?.trim() || isProfileTombstoned(profile)) {
      return {
        ok: false,
        response: publicApiError("Recipient not found.", "NOT_FOUND", 404),
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      response: publicApiError(
        "Profile storage is unavailable.",
        "UNAVAILABLE",
        503,
        { retryable: true },
      ),
    };
  }
}

export async function GET(request: Request): Promise<Response> {
  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const actor = await requireLinkedActor(request, asserted);
  if (!actor.ok) {
    // No JWT and no handle → empty inbox so the page still renders.
    if (!asserted.trim()) {
      return jsonNoStore({ conversations: [] }, { status: 200 });
    }
    return publicApiErrorFromStatus(actor.error, actor.status);
  }
  const handle = actor.handle;
  if (!handle) return jsonNoStore({ conversations: [] }, { status: 200 });

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    // Fail-soft on store outage: empty inbox keeps the page rendering.
    // Keep 401/403 as hard errors so ownership denials stay visible.
    if (ownership.status === 503) {
      return jsonNoStore({ conversations: [] }, { status: 200 });
    }
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }
  const conversations = await messagesStore().listConversations(handle);
  return jsonNoStore({ conversations }, { status: 200 });
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
  const other = normalizeHandle(readString(body.other) ?? "");
  if (!handle) return publicApiError("Add your handle.", "INVALID_REQUEST", 400);
  if (!other) return publicApiError("Add a recipient handle.", "INVALID_REQUEST", 400);
  if (handle === other) {
    return publicApiError("You can't message yourself.", "INVALID_REQUEST", 400);
  }

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const store = messagesStore();

  if (action === "open") {
    const key = `msg-open:${handle}:${hashIp(clientIp(request))}`;
    if (await isLimited(key, key, OPEN_LIMIT, OPEN_WINDOW_MS, { failClosed: true })) {
      return publicApiError("Too many conversation opens, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    const recipient = await activeRecipient(other);
    if (!recipient.ok) return recipient.response;
    const conversationId = await store.openConversation(handle, other);
    if (!conversationId) {
      return publicApiError("Couldn't open that conversation.", "UNAVAILABLE", 503, { retryable: true });
    }
    return jsonNoStore({ conversationId }, { status: 200 });
  }

  if (action === "send") {
    const key = `msg-send:${handle}:${hashIp(clientIp(request))}`;
    if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) {
      return publicApiError("Too many messages, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    const messageBody = readString(body.body);
    if (!messageBody) return publicApiError("Write a message.", "INVALID_REQUEST", 400);
    const recipient = await activeRecipient(other);
    if (!recipient.ok) return recipient.response;
    const conversationId = await store.openConversation(handle, other);
    if (!conversationId) {
      return publicApiError("Couldn't open that conversation.", "UNAVAILABLE", 503, { retryable: true });
    }
    const message = await store.send(conversationId, handle, messageBody);
    if (!message) {
      // Store miss / write failure after validation — degraded dependency, not 400.
      return publicApiError("Couldn't send that message.", "UNAVAILABLE", 503, { retryable: true });
    }
    return jsonNoStore({ message, conversationId }, { status: 201 });
  }

  return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
}
