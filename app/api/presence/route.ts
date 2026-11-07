// "I'm here tonight" presence route (PRD §1.5 / §5.1 — the tonight loop).
//
//   POST { handle, venueId }        → { ok: true }   (marks the viewer present)
//   GET  ?venueId=<id>  (or none)   → { presence: PresenceDTO[] }  (recent, live)
//
// A presence row is live location of a named person, so GET answers it only to
// that person's mates (lib/presenceAudience.server.ts): a verified Social
// account (signed in, a handle, the adult check) that is a mutual follow, with
// no block either way. Anyone else gets the seeded demo rows alone, which exist
// only keyless; in production that is an empty list.
//
// The actor is derived server-side (hashActor of the hashed client IP) — the
// body is never trusted for identity, and no raw IP or actor id is stored. Writes
// are rate-limited (isLimited) exactly like the other write paths. Presence is
// opt-in (a deliberate tap) — there is NO auto-tracking and NO GPS.
//
// The reader NEVER 500s: a GET failure falls through to 200 { presence: [] } so
// the "Live tonight" strip degrades to nothing rather than a broken band.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { projectPublicAuthors } from "@/lib/avatarResolve";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { presenceHandlesForViewer } from "@/lib/presenceAudience.server";
import { markPresence, recentPresenceWithAmbient } from "@/lib/presenceStore";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { fulfilWantedsForHandleAtVenue } from "@/lib/wantedFulfil.server";
import { wantedFulfilledLine } from "@/lib/wanted";

assertServerEnv();

// The answer depends on who asks, so no shared cache may keep it.
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = await resolveMessageHandle(request, readString(body.handle));
  const venueId = readString(body.venueId).trim();
  if (!handle) return publicApiError("Add a handle first.", "INVALID_REQUEST", 400);
  if (!venueId) return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // Identity is server-derived from the hashed client IP — never the body. The
  // raw IP is hashed (hashIp) then folded into a stable actor hash (hashActor),
  // so the actor_hash column can't be correlated back to a device or address.
  const ipHash = hashIp(clientIp(request));
  const actorHash = hashActor(`presence:${ownership.handle.toLowerCase()}:${ipHash}`);

  // Rate-limit the tap: durable key = handle + hashed IP; in-memory backstop
  // keyed on handle alone (same shape as the pint-drops write path).
  const durableKey = `presence:${ownership.handle.toLowerCase()}:${ipHash}`;
  if (await isLimited(ownership.handle, durableKey)) {
    return publicApiError("Too many check-ins, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // markPresence is fail-soft (never throws) — a presence hiccup must not fail
  // the tap. Cleaning/capping happens inside the store.
  await markPresence({ handle: ownership.handle, venueId, actorHash });
  // Quiet Wanted fulfilment: landing at a saved place closes the Wanted.
  const fulfilled = await fulfilWantedsForHandleAtVenue(ownership.handle, venueId);
  const wantedNote =
    fulfilled[0] != null ? wantedFulfilledLine(fulfilled[0].venueName) : undefined;
  return jsonNoStore(
    {
      ok: true,
      ...(fulfilled.length > 0
        ? { wantedFulfilled: fulfilled.length, wantedNote }
        : {}),
    },
    { status: 200 },
  );
}

export async function GET(request: Request): Promise<Response> {
  const venueId = new URL(request.url).searchParams.get("venueId") ?? undefined;
  // recentPresenceWithAmbient is itself fail-soft (returns [] on any error) and
  // appends the deterministic demo layer ONLY when Supabase is absent, so the
  // reader never 500s — but keep a belt-and-braces guard so a surprise 200s empty.
  // Any failure past the read, the audience check included, answers nothing:
  // this list fails closed.
  try {
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    const access = await requireVerifiedSocialActor(new Request(request, { headers }));
    const handles = access.ok ? await presenceHandlesForViewer(access.actor) : [];
    const rows = await recentPresenceWithAmbient(venueId || undefined, Date.now(), handles);
    const presence = await projectPublicAuthors(rows);
    return jsonNoStore({ presence }, { status: 200, headers: PRIVATE_NO_STORE });
  } catch {
    return jsonNoStore({ presence: [] }, { status: 200, headers: PRIVATE_NO_STORE });
  }
}
