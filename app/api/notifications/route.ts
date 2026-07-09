// A handle's notifications / activity inbox (story 34 / Wave I2).
//   GET  ?handle=<handle>            → { notifications: NotificationDTO[], unread }
//   POST { handle, id? }             → { notifications, unread }   (marks read)
//
// Wave I2: resolve the actor via resolveMessageHandle (JWT-linked handle wins)
// then gateHandleAction — same ownership model as messages.

import { jsonNoStore } from "@/lib/apiResponses";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { notificationsStore } from "@/lib/notificationsStore";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const handle = await resolveMessageHandle(request, asserted);
  if (!handle) return jsonNoStore({ notifications: [], unread: 0 }, { status: 200 });
  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }
  const inbox = await notificationsStore().list(handle);
  return jsonNoStore(inbox, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const handle = await resolveMessageHandle(request, readString(body.handle) ?? "");
  if (!handle) return jsonNoStore({ error: "Add a handle." }, { status: 400 });

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  const key = `notif-read:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return jsonNoStore({ error: "Too many updates, slow down." }, { status: 429 });
  }

  const id = readString(body.id);
  const inbox = await notificationsStore().markRead(handle, id);
  return jsonNoStore(inbox, { status: 200 });
}
