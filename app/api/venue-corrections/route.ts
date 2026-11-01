// "That's wrong": a signed-in drinker tells a person that a listed fact about
// a pub is off.
//
//   POST { venueId, kind: "closed" | "hours" | "other", note? }
//        -> 201 { stored: true, correction: { id, kind, status, createdAt } }
//   POST { venueId, kind: "price" }
//        -> 200 { stored: false, next: "price_log", hint }   (nothing is written)
//
// A CORRECTION IS A NOTE TO A PERSON. Nothing here moves a pin, hides a pub,
// changes hours or touches a price. A moderator reads the queue at
// /api/admin/venue-corrections and fixes the fact through the pack rebuild.
//
// A PRICE IS NOT A CORRECTION. A new price is a dated observation with a bill
// behind it, so a "price" answer stores nothing and tells the client to open
// the existing log flow on the same sheet.
//
// WHO MAY SEND ONE: a signed-in account with a claimed handle, through the
// shared contribution gate (sign_in_required, onboarding_required and the adult
// check). The owner comes from the SESSION, never from the body. The venue must
// resolve through the one community-write door, so the id is in the curated
// index or the UK base. Every write is durably rate limited per account, a hard
// store failure answers 503 and never a fake success, and nothing is cached.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson } from "@/lib/boundedRequest.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import {
  isStoredVenueCorrectionKind,
  validateVenueCorrection,
  VENUE_CORRECTION_PRICE_HINT,
} from "@/lib/venueCorrections";
import { venueCorrectionsStore } from "@/lib/venueCorrectionsStore";
import { resolveWritableVenueId } from "@/lib/venueWriteTarget.server";

assertServerEnv();

export const runtime = "nodejs";

/** A drinker flags a few pubs on a bad night; more than this in an hour is a script. */
const ACTOR_HOURLY_LIMIT = 10;
const HOUR_MS = 60 * 60 * 1000;
const JSON_BODY_MAX_BYTES = 4 * 1024;

function rateLimited(): Response {
  return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, { retryable: true });
}

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await boundedJson(request, JSON_BODY_MAX_BYTES);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return jsonNoStore(owner.body, { status: owner.httpStatus });

  // Burst first, keyed on the account AND the address, like every contribution door.
  const ipHash = hashIp(clientIp(request));
  const burstKey = `venue-correction:${owner.actor}:${ipHash}`;
  if (await isLimited(burstKey, burstKey)) return rateLimited();

  const body = await parseJson(request);
  if (!body) return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);

  const input = validateVenueCorrection(body);
  if (!input.ok) {
    return publicApiError(input.error, "INVALID_VENUE_CORRECTION", 400, { details: { field: input.field } });
  }

  // A new price goes through the log flow with its bill. Nothing is stored and
  // no hourly budget is spent: the drinker has not reported anything yet.
  if (!isStoredVenueCorrectionKind(input.kind)) {
    return jsonNoStore({ stored: false, next: "price_log", hint: VENUE_CORRECTION_PRICE_HINT }, { status: 200 });
  }

  const actorKey = `venue-correction-actor:${owner.actor}`;
  if (await isLimited(actorKey, actorKey, ACTOR_HOURLY_LIMIT, HOUR_MS)) return rateLimited();

  const target = await resolveWritableVenueId(input.venueId);
  if (!target.ok) return publicApiErrorFromStatus(target.error, target.status);

  try {
    const correction = await venueCorrectionsStore().create({
      venueId: target.venueId,
      kind: input.kind,
      note: input.note,
      ownerUserId: owner.accountId,
    });
    return jsonNoStore(
      {
        stored: true,
        correction: {
          id: correction.id,
          kind: correction.kind,
          status: correction.status,
          createdAt: correction.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    log("error", "venue_correction.create_failed", {
      route: "POST /api/venue-corrections",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
