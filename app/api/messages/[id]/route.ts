// A single conversation's thread (PRD E4).
//   GET  ?handle=<handle>                         → { messages: MessageDTO[] }
//   POST { action:"send",   handle, body }        → { message }
//   POST { action:"report", handle, messageId }   → { flagged: boolean }
//
// ─────────────────────────────────────────────────────────────────────────────
// COURTESY PARTICIPANT CHECK. A read/send is only served when `handle` is a
// participant of THIS conversation. A non-participant (or unknown conversation)
// gets a 404 — deliberately indistinguishable from "no such conversation" so the
// endpoint never confirms a private thread exists to an outsider.
//
// Identity prefers a verified Supabase Auth JWT (linked profile handle) when
// present; otherwise the self-asserted handle (anonymous/demo dual-backend).
// See app/api/messages/route.ts + lib/messageAuth.ts + migration 0019.
// ─────────────────────────────────────────────────────────────────────────────

import { jsonNoStore } from "@/lib/apiResponses";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { messagesStore } from "@/lib/messagesStore";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const handle = await resolveMessageHandle(request, asserted);
  if (!handle) return jsonNoStore({ error: "Add your handle." }, { status: 400 });

  const messages = await messagesStore().listMessages(id, handle);
  // null = not a participant (or unknown conversation) → 404, never a leak.
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
  const handle = await resolveMessageHandle(request, readString(body.handle) ?? "");
  if (!handle) return jsonNoStore({ error: "Add your handle." }, { status: 400 });

  const store = messagesStore();

  if (action === "report") {
    const messageId = readString(body.messageId);
    if (!messageId) return jsonNoStore({ error: "Missing message id." }, { status: 400 });
    // Gate the report on participation too: only someone in the conversation can
    // flag its messages. A non-participant read returns null → 404.
    const thread = await store.listMessages(id, handle);
    if (thread === null) {
      return jsonNoStore({ error: "Conversation not found." }, { status: 404 });
    }
    const flagged = await store.report(id, messageId, handle);
    return jsonNoStore({ flagged }, { status: 200 });
  }

  if (action === "send") {
    const key = `msg-send:${handle}:${hashIp(clientIp(request))}`;
    if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) {
      return jsonNoStore({ error: "Too many messages, slow down." }, { status: 429 });
    }
    const messageBody = readString(body.body);
    if (!messageBody) return jsonNoStore({ error: "Write a message." }, { status: 400 });
    // store.send re-runs the participant check on the conversation, so a
    // non-participant sender is rejected (null → 404) without a separate lookup.
    const message = await store.send(id, handle, messageBody);
    if (!message) {
      return jsonNoStore({ error: "Conversation not found." }, { status: 404 });
    }
    return jsonNoStore({ message }, { status: 201 });
  }

  return jsonNoStore({ error: "Unknown action." }, { status: 400 });
}
