// Summon your mates to a pub (lib/summonMates.server.ts owns who and how).
//   GET                                   → { mates: string[] }
//   POST { venueId, time, mates: [...] }  → { sent: string[], failed: string[] }
//
// Both need a verified Social account: signed in, a handle, the adult check
// passed and not suspended. A summon is a direct message with the pub
// attached, so it reaches only live mates with no block or mute either way.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { log } from "@/lib/log";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { hashActor } from "@/lib/supabase";
import { parseSummonTime, SUMMON_SEND_FAILED_LINE } from "@/lib/summonMates";
import { sendSummon, summonableMates } from "@/lib/summonMates.server";

assertServerEnv();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const READ_LIMIT = 60;
const READ_WINDOW_MS = 60_000;
const SEND_LIMIT = 6;
const SEND_WINDOW_MS = 10 * 60_000;
const VENUE_ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,99}$/;

type Access = Awaited<ReturnType<typeof requireVerifiedSocialActor>>;

function accessError(access: Exclude<Access, { ok: true }>): Response {
  return publicApiError(access.error, access.code, access.status, {
    retryable: access.retryable === true,
    ...(access.gate ? { details: { gate: access.gate } } : {}),
    headers: NO_STORE,
  });
}

function slowDown(): Response {
  return publicApiError("Too many summons. Slow down.", "RATE_LIMITED", 429, {
    retryable: true,
    headers: NO_STORE,
  });
}

function unavailable(): Response {
  return publicApiError(SUMMON_SEND_FAILED_LINE, "UNAVAILABLE", 503, {
    retryable: true,
    headers: NO_STORE,
  });
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return accessError(access);
  const key = `summon-read:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, READ_LIMIT, READ_WINDOW_MS)) return slowDown();
  try {
    const mates = await summonableMates(access.actor);
    return jsonNoStore({ mates }, { headers: NO_STORE });
  } catch (err) {
    log("error", "summon.mates_read_failed", {
      route: "GET /api/summon",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Your mates are unavailable right now.", "UNAVAILABLE", 503, {
      retryable: true,
      headers: NO_STORE,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400, { headers: NO_STORE });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400, { headers: NO_STORE });
  }
  const venueId = typeof body.venueId === "string" ? body.venueId : "";
  if (!VENUE_ID.test(venueId)) {
    return publicApiError("Choose a pub.", "INVALID_VENUE", 400, { headers: NO_STORE });
  }
  const time = parseSummonTime(body.time);
  if (!time) return publicApiError("Pick a time.", "INVALID_REQUEST", 400, { headers: NO_STORE });
  const mates = Array.isArray(body.mates)
    ? body.mates.filter((mate): mate is string => typeof mate === "string")
    : [];
  if (mates.length === 0) {
    return publicApiError("Pick at least one mate.", "INVALID_REQUEST", 400, { headers: NO_STORE });
  }

  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return accessError(access);
  const key = `summon-send:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) return slowDown();

  let result: Awaited<ReturnType<typeof sendSummon>>;
  try {
    result = await sendSummon(access.actor, { venueId, time, mates });
  } catch (err) {
    log("error", "summon.send_failed", {
      route: "POST /api/summon",
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable();
  }
  switch (result.status) {
    case "unknown_pub":
      return publicApiError("We couldn't find that pub.", "NOT_FOUND", 404, { headers: NO_STORE });
    case "unavailable":
      return unavailable();
    case "no_mates":
      return publicApiError("None of those mates can be summoned.", "INVALID_REQUEST", 400, {
        headers: NO_STORE,
      });
    case "sent":
      if (result.sent.length === 0) return unavailable();
      return jsonNoStore({ sent: result.sent, failed: result.failed }, { status: 201, headers: NO_STORE });
  }
}
