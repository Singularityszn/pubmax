// A single conversation's thread (PRD E4 / Wave I2).
//   GET  ?handle=<handle>                         → { messages: MessageDTO[] }
//   POST { action:"send",   handle, body }        → { message }
//   POST { action:"report", handle, messageId }   → { flagged: boolean }
//
// Wave I2: requires a signed-in linked actor (401 without JWT). Linked-handle
// ownership still collapses 403 → 404 so the endpoint never confirms a private
// thread exists to an outsider.

import { jsonNoStore } from "@/lib/apiResponses";
import { requireLinkedActor } from "@/lib/messageAuth";
import { messagesStore } from "@/lib/messagesStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const actor = await requireLinkedActor(request, asserted);
  if (!actor.ok) {
    return jsonNoStore({ error: actor.error }, { status: actor.status });
  }
  const handle = actor.handle;
  if (!handle) return jsonNoStore({ error: "Add your handle." }, { status: 400 });

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    if (ownership.status === 403) {
      return jsonNoStore({ error: "Conversation not found." }, { status: 404 });
    }
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  const messages = await messagesStore().listMessages(id, handle);
  if (messages === null) {
    return jsonNoStore({ error: "Conversation not found." }, { status: 404 });
  }
  return jsonNoStore({ messages }, { status: 200 });
}

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
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
  if (!handle) return jsonNoStore({ error: "Add your handle." }, { status: 400 });

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    if (ownership.status === 403) {
      return jsonNoStore({ error: "Conversation not found." }, { status: 404 });
    }
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  const store = messagesStore();

  if (action === "report") {
    const messageId = readString(body.messageId);
    if (!messageId) return jsonNoStore({ error: "Missing message id." }, { status: 400 });
    const thread = await store.listMessages(id, handle);
    if (thread === null) {
      return jsonNoStore({ error: "Conversation not found." }, { status: 404 });
    }
    const flagged = await store.report(id, messageId, handle);
    return jsonNoStore({ flagged }, { status: 200 });
  }

  if (action === "send") {
    // Solo-operator emergency freeze (U15): sending is a social write. The
    // `report` branch above returns first, so reporting a message stays OPEN.
    const frozen = socialFreezeResponse();
    if (frozen) return frozen;

    const key = `msg-send:${handle}:${hashIp(clientIp(request))}`;
    if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) {
      return jsonNoStore({ error: "Too many messages, slow down." }, { status: 429 });
    }
    const messageBody = readString(body.body);
    if (!messageBody) return jsonNoStore({ error: "Write a message." }, { status: 400 });
    const message = await store.send(id, handle, messageBody);
    if (!message) {
      return jsonNoStore({ error: "Conversation not found." }, { status: 404 });
    }
    return jsonNoStore({ message }, { status: 201 });
  }

  return jsonNoStore({ error: "Unknown action." }, { status: 400 });
}
