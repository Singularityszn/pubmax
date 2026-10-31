// Ratings API (PRD E3) — star ratings for drinks AND pubs.
//
//   POST { kind: "drink"|"venue", ref, venueId?, handle, rating }
//        → 200 { ref, summary }        (upsert: latest vote replaces the old)
//        → 400 invalid input · 429 rate-limited · 503 storage failed
//   GET  ?kind=drink|venue&refs=a,b,c  → 200 { summaries: { ref → summary } }
//
// Identity is the `handle`, resolved by resolveMessageHandle and then gated by
// gateHandleAction (lib/profileOwnership.ts): a handle linked to an account
// needs its signed-in owner, and an unlinked handle keeps the demo path. That
// is the SAME trust posture as reactions/comments/notifications: a star rating
// is already-public low-sensitivity signal, and the unique (ref, handle) upsert means one
// handle holds ONE vote. Handles are unbounded, though, so a caller inventing a
// fresh one per request would add a vote each time: the second budget below is
// keyed on the hashed IP alone, and that is what bounds it. Noted honestly here,
// in lib/ratingsStore.ts, and in migration 0020.
//
// Reads are fail-soft (the store returns empty summaries / [] on any storage
// error) so a ratings outage can never 500 a menu or the discover page. The
// WRITE path is the opposite: a vote that can't be stored is a 503, never a
// silent success. Store choice is the usual seam: Supabase when configured,
// process-memory otherwise.

import {
  isRatingKind,
  parseRating,
  type RatingKind,
  type RatingSummary,
} from "@/lib/ratings";
import { ratingsStore } from "@/lib/ratingsStore";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

// Bound untrusted keys/batches so one request can't carry an unbounded load.
const MAX_REF_LENGTH = 200;
const MAX_BATCH_REFS = 50;

// The per-IP budget, independent of the handle. Rating a whole menu in one
// sitting stays well under it; a loop of invented handles does not.
const RATING_IP_LIMIT = 40;
const RATING_IP_WINDOW_MS = 10 * 60_000;

function cleanRef(value: unknown): string | null {
  const ref = readString(value)?.trim() ?? "";
  return ref !== "" && ref.length <= MAX_REF_LENGTH ? ref : null;
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const kind = body.kind;
  if (!isRatingKind(kind)) {
    return publicApiError("kind must be \"drink\" or \"venue\".", "INVALID_REQUEST", 400);
  }

  // For a venue, the venue id IS the ref — accept either field.
  const ref = cleanRef(body.ref) ?? (kind === "venue" ? cleanRef(body.venueId) : null);
  if (!ref) return publicApiError("Add a ref to rate.", "INVALID_REQUEST", 400);

  const handle = await resolveMessageHandle(request, readString(body.handle));
  if (!handle) return publicApiError("Add a handle.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const rating = parseRating(body.rating);
  if (rating === null) {
    return publicApiError("Pick 1–5 stars, in half-star steps.", "INVALID_REQUEST", 400);
  }

  // Two independent budgets, like saved-pubs: per handle + hashed IP stops one
  // profile flooding, and per hashed IP alone stops one caller minting a fresh
  // handle per vote. 429 when either is spent.
  const ipHash = hashIp(clientIp(request));
  const key = `rating:${ownership.handle}:${ipHash}`;
  const ipKey = `rating-ip:${ipHash}`;
  if (
    (await isLimited(key, key)) ||
    (await isLimited(ipKey, ipKey, RATING_IP_LIMIT, RATING_IP_WINDOW_MS))
  ) {
    return publicApiError("Too many ratings, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const summary = await ratingsStore().rate({
      kind,
      ref,
      venueId: cleanRef(body.venueId) ?? undefined,
      handle: ownership.handle,
      rating,
    });
    return jsonNoStore({ ref, summary }, { status: 200 });
  } catch (err) {
    // A vote that can't be stored is an honest 503 (retryable), never a
    // silent success and never a 500 (the input was fine; storage wasn't).
    console.error(
      "[ratings] rate failed:",
      err instanceof Error ? err.message : err,
    );
    return publicApiError("Ratings storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (!isRatingKind(kind)) {
    return publicApiError("kind must be \"drink\" or \"venue\".", "INVALID_REQUEST", 400);
  }

  // Batch summary mode. No refs → an empty (but valid) map, never an error.
  const refs = (params.get("refs") ?? "")
    .split(",")
    .map((ref) => ref.trim())
    .filter((ref) => ref !== "" && ref.length <= MAX_REF_LENGTH)
    .slice(0, MAX_BATCH_REFS);
  const summaries: Record<string, RatingSummary> =
    refs.length > 0 ? await ratingsStore().summaryFor(kind as RatingKind, refs) : {};
  return jsonNoStore({ summaries }, { status: 200 });
}
