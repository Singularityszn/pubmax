// A handle's notifications / activity inbox (story 34).
//   GET  ?handle=<handle>            → { notifications: NotificationDTO[], unread }
//   POST { handle, id? }             → { notifications, unread }   (marks read)
//
// Identity is the self-asserted `handle` (no auth yet). A notification carries
// only already-public feed signal (a follow, a reaction, a comment, a crawl save),
// so keying a read by a self-asserted recipient handle is acceptable
// low-sensitivity exposure — it can never reveal anything the feed doesn't already
// show. This is noted honestly in lib/notifications.ts and migration 0010. When
// auth ownership merges, gate reads on auth.uid() ownership.
//
// Reads are fail-soft (the store returns an empty inbox on any error), so a
// notifications outage can never 500 the bell / activity page. Store choice is the
// usual seam: Supabase when configured, process-memory otherwise.

import { jsonNoStore } from "@/lib/apiResponses";
import { notificationsStore } from "@/lib/notificationsStore";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

export async function GET(request: Request): Promise<Response> {
  const handle = normalizeHandle(new URL(request.url).searchParams.get("handle") ?? "");
  // Nothing to key on → an empty (but valid) inbox, so the bell/page still renders.
  if (!handle) return jsonNoStore({ notifications: [], unread: 0 }, { status: 200 });
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

  const handle = normalizeHandle(readString(body.handle) ?? "");
  if (!handle) return jsonNoStore({ error: "Add a handle." }, { status: 400 });

  // Rate-limit mark-read per handle + hashed IP, like the app's other routes.
  const key = `notif-read:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return jsonNoStore({ error: "Too many updates, slow down." }, { status: 429 });
  }

  // Mark one (id present) or all (id absent) of the handle's notifications read.
  const id = readString(body.id);
  const inbox = await notificationsStore().markRead(handle, id);
  return jsonNoStore(inbox, { status: 200 });
}
