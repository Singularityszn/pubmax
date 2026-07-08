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

import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { markPresence, recentPresenceWithAmbient } from "@/lib/presenceStore";
import { gateHandleAction } from "@/lib/profileOwnership";
import { normalizeHandle } from "@/lib/profiles";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

assertServerEnv();

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const handle = normalizeHandle(readString(body.handle).trim());
  const venueId = readString(body.venueId).trim();
  if (!handle) return jsonNoStore({ error: "Add a handle first." }, { status: 400 });
  if (!venueId) return jsonNoStore({ error: "A venue is required." }, { status: 400 });

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  // Identity is server-derived from the hashed client IP — never the body. The
  // raw IP is hashed (hashIp) then folded into a stable actor hash (hashActor),
  // so the actor_hash column can't be correlated back to a device or address.
  const ipHash = hashIp(clientIp(request));
  const actorHash = hashActor(`presence:${handle.toLowerCase()}:${ipHash}`);

  // Rate-limit the tap: durable key = handle + hashed IP; in-memory backstop
  // keyed on handle alone (same shape as the pint-drops write path).
  const durableKey = `presence:${handle.toLowerCase()}:${ipHash}`;
  if (await isLimited(handle, durableKey)) {
    return jsonNoStore({ error: "Too many check-ins, slow down." }, { status: 429 });
  }

  // markPresence is fail-soft (never throws) — a presence hiccup must not fail
  // the tap. Cleaning/capping happens inside the store.
  await markPresence({ handle, venueId, actorHash });
  return jsonNoStore({ ok: true }, { status: 200 });
}

export async function GET(request: Request): Promise<Response> {
  const venueId = new URL(request.url).searchParams.get("venueId") ?? undefined;
  // recentPresenceWithAmbient is itself fail-soft (returns [] on any error) and
  // appends the deterministic demo layer ONLY when Supabase is absent, so the
  // reader never 500s — but keep a belt-and-braces guard so a surprise 200s empty.
  try {
    const presence = await recentPresenceWithAmbient(venueId || undefined);
    return jsonNoStore({ presence }, { status: 200 });
  } catch {
    return jsonNoStore({ presence: [] }, { status: 200 });
  }
}
