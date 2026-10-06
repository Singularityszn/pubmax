// The Diary, Phase 1: a drinker's own dated log of pub visits.
//
//   GET                                       -> 200 { status, entries } (owner only, newest day first)
//   POST { venueId, visitedOn?, rating?, review? }
//                                             -> 201 { entry }
//
// Account-bound and PRIVATE: the owner is the authenticated account's auth user
// id, a body handle or owner field is ignored, and no route reads another
// account's entries. The venue name is the canonical name the server resolves
// for the id, never a client-typed one. A second log of the same pub on the
// same London day answers 409. A write is durably RATE LIMITED and a hard
// store failure answers 503, never a fake success. The envelope is
// publicApiError; nothing is cached.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { validateDiaryEntryCreate } from "@/lib/diary";
import { diaryStore } from "@/lib/diaryStore";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export const runtime = "nodejs";

const CREATE_WINDOW_MS = 60_000;

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return jsonNoStore(owner.body, { status: owner.httpStatus });

  try {
    const result = await diaryStore().listForOwner(owner.accountId);
    return jsonNoStore(result, { status: 200 });
  } catch (err) {
    log("error", "diary.list_failed", {
      route: "GET /api/diary",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return jsonNoStore(owner.body, { status: owner.httpStatus });

  const ipHash = hashIp(clientIp(request));
  const key = `diary:${owner.actor}:${ipHash}`;
  if (await isLimited(key, key, undefined, CREATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const venueId = readString(body.venueId);
  const lookup = venueId ? await lookupCanonicalVenue(venueId) : null;
  // An outage of the venue index is not the drinker's mistake: say so, and let
  // the client retry, rather than call a valid pub invalid.
  if (lookup?.status === "unavailable") {
    return publicApiError("Pubs are unavailable right now. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  const venue = lookup?.status === "found" ? lookup.venue : null;
  if (!venue || !isPubVenueKind(venue.kind)) {
    return publicApiError("Pick a pub from the map.", "INVALID_DIARY_ENTRY", 400);
  }

  const result = validateDiaryEntryCreate({
    ownerUserId: owner.accountId,
    venueId: venue.id,
    venueName: venue.name,
    visitedOn: body.visitedOn,
    rating: body.rating,
    review: body.review,
    visibility: body.visibility,
  });
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_DIARY_ENTRY", 400);
  }

  try {
    const created = await diaryStore().create(result.value);
    if (created.status === "duplicate") {
      return publicApiError(
        "You already logged this pub for that day.",
        "DIARY_ENTRY_EXISTS",
        409,
      );
    }
    return jsonNoStore({ entry: created.entry }, { status: 201 });
  } catch (err) {
    log("error", "diary.create_failed", {
      route: "POST /api/diary",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
