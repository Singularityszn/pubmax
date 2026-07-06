// "I'm here tonight" presence route (PRD §1.5 / §5.1 — the tonight loop).
//
//   POST { handle, venueId }        → { ok: true }   (marks the viewer present)
//   GET  ?venueId=<id>  (or none)   → { presence: PresenceDTO[] }  (recent, live)
//
// The actor is derived server-side (hashActor of the hashed client IP) — the
// body is never trusted for identity, and no raw IP or actor id is stored. Writes
// are rate-limited (isLimited) exactly like the other write paths. Presence is
// opt-in (a deliberate tap) — there is NO auto-tracking and NO GPS.
//
// The reader NEVER 500s: a GET failure falls through to 200 { presence: [] } so
// the "Live tonight" strip degrades to nothing rather than a broken band.

import { isLimited } from "@/lib/pintDrops";
import { markPresence, recentPresence } from "@/lib/presenceStore";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const handle = readString(body.handle).trim();
  const venueId = readString(body.venueId).trim();
  if (!handle) return Response.json({ error: "Add a handle first." }, { status: 400 });
  if (!venueId) return Response.json({ error: "A venue is required." }, { status: 400 });

  // Identity is server-derived from the hashed client IP — never the body. The
  // raw IP is hashed (hashIp) then folded into a stable actor hash (hashActor),
  // so the actor_hash column can't be correlated back to a device or address.
  const ipHash = hashIp(clientIp(request));
  const actorHash = hashActor(`presence:${handle.toLowerCase()}:${ipHash}`);

  // Rate-limit the tap: durable key = handle + hashed IP; in-memory backstop
  // keyed on handle alone (same shape as the pint-drops write path).
  const durableKey = `presence:${handle.toLowerCase()}:${ipHash}`;
  if (await isLimited(handle, durableKey)) {
    return Response.json({ error: "Too many check-ins, slow down." }, { status: 429 });
  }

  // markPresence is fail-soft (never throws) — a presence hiccup must not fail
  // the tap. Cleaning/capping happens inside the store.
  await markPresence({ handle, venueId, actorHash });
  return Response.json({ ok: true }, { status: 200 });
}

export async function GET(request: Request): Promise<Response> {
  const venueId = new URL(request.url).searchParams.get("venueId") ?? undefined;
  // recentPresence is itself fail-soft (returns [] on any error), so the reader
  // never 500s — but keep a belt-and-braces guard so a surprise still 200s empty.
  try {
    const presence = await recentPresence(venueId || undefined);
    return Response.json({ presence }, { status: 200 });
  } catch {
    return Response.json({ presence: [] }, { status: 200 });
  }
}
