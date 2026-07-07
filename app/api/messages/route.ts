// Messaging inbox + conversation open/send (PRD E4).
//   GET  ?handle=<handle>                          → { conversations: ConversationDTO[] }
//   POST { action:"open", handle, other }          → { conversationId }
//   POST { action:"send", handle, other, body }    → { message }   (opens if needed)
//
// ─────────────────────────────────────────────────────────────────────────────
// COURTESY-CURTAIN, NOT PRIVACY. Identity is the self-asserted `handle` (no auth
// yet — same trust boundary as the rest of the social layer). A read keyed by a
// self-asserted handle trusts whoever claims it; this is a courtesy curtain, not
// cryptographic privacy. The store enforces the participant check; the DB denies
// all anon access (RLS-on / no-policy, migration 0019). Keep content
// low-sensitivity by design. When Google OAuth lands, gate on auth.uid().
// ─────────────────────────────────────────────────────────────────────────────
//
// Reads are fail-soft (the store returns an empty inbox on error) so an outage
// never 500s the inbox. Sends are rate-limited per handle (~20/min).

import { jsonNoStore } from "@/lib/apiResponses";
import { messagesStore } from "@/lib/messagesStore";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

// Sends are chattier than pint drops (a conversation is a back-and-forth), so the
// budget is looser than the default 8/min — 20 sends/min per handle.
const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const handle = normalizeHandle(new URL(request.url).searchParams.get("handle") ?? "");
  // Nothing to key on → an empty (but valid) inbox, so the page still renders.
  if (!handle) return jsonNoStore({ conversations: [] }, { status: 200 });
  const conversations = await messagesStore().listConversations(handle);
  return jsonNoStore({ conversations }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const action = readString(body.action);
  const handle = normalizeHandle(readString(body.handle) ?? "");
  const other = normalizeHandle(readString(body.other) ?? "");
  if (!handle) return jsonNoStore({ error: "Add your handle." }, { status: 400 });
  if (!other) return jsonNoStore({ error: "Add a recipient handle." }, { status: 400 });
  if (handle === other) {
    return jsonNoStore({ error: "You can't message yourself." }, { status: 400 });
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
    // Rate-limit sends per handle + hashed IP (durable when configured).
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
      return jsonNoStore({ error: "Couldn't send that message." }, { status: 400 });
    }
    return jsonNoStore({ message, conversationId }, { status: 201 });
  }

  return jsonNoStore({ error: "Unknown action." }, { status: 400 });
}
