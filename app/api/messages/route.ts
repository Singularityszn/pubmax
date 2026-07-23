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

import { jsonNoStore } from "@/lib/apiResponses";
import { requireLinkedActor } from "@/lib/messageAuth";
import { messagesStore } from "@/lib/messagesStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
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
      return jsonNoStore({ conversations: [] }, { status: 200 });
    }
    return jsonNoStore({ error: actor.error }, { status: actor.status });
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
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
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
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const action = readString(body.action);
  const actor = await requireLinkedActor(request, readString(body.handle) ?? "");
  if (!actor.ok) {
    return jsonNoStore({ error: actor.error }, { status: actor.status });
  }
  const handle = actor.handle;
  const other = normalizeHandle(readString(body.other) ?? "");
  if (!handle) return jsonNoStore({ error: "Add your handle." }, { status: 400 });
  if (!other) return jsonNoStore({ error: "Add a recipient handle." }, { status: 400 });
  if (handle === other) {
    return jsonNoStore({ error: "You can't message yourself." }, { status: 400 });
  }

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  const store = messagesStore();

  if (action === "open") {
    const conversationId = await store.openConversation(handle, other);
    if (!conversationId) {
      return jsonNoStore({ error: "Couldn't open that conversation." }, { status: 503 });
    }
    return jsonNoStore({ conversationId }, { status: 200 });
  }

  if (action === "send") {
    const key = `msg-send:${handle}:${hashIp(clientIp(request))}`;
    if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) {
      return jsonNoStore({ error: "Too many messages, slow down." }, { status: 429 });
    }
    const messageBody = readString(body.body);
    if (!messageBody) return jsonNoStore({ error: "Write a message." }, { status: 400 });
    const conversationId = await store.openConversation(handle, other);
    if (!conversationId) {
      return jsonNoStore({ error: "Couldn't open that conversation." }, { status: 503 });
    }
    const message = await store.send(conversationId, handle, messageBody);
    if (!message) {
      // Store miss / write failure after validation — degraded dependency, not 400.
      return jsonNoStore({ error: "Couldn't send that message." }, { status: 503 });
    }
    return jsonNoStore({ message, conversationId }, { status: 201 });
  }

  return jsonNoStore({ error: "Unknown action." }, { status: 400 });
}
