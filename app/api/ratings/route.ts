// Ratings API (PRD E3) — star ratings for drinks AND pubs.
//
//   POST { kind: "drink"|"venue", ref, venueId?, handle, rating }
//        → 200 { ref, summary }        (upsert: latest vote replaces the old)
//        → 400 invalid input · 429 rate-limited · 503 storage failed
//   GET  ?kind=drink|venue&refs=a,b,c  → 200 { summaries: { ref → summary } }
//   GET  ?kind=venue&top=1&limit=10    → 200 { top: [{ ref, summary }] }
//
// Identity is the self-asserted `handle` (no auth yet) — the SAME trust
// posture as reactions/comments/notifications: a star rating is already-public
// low-sensitivity signal, and the unique (ref, handle) upsert means the worst
// a spoofed handle can do is move ONE vote. Noted honestly here, in
// lib/ratingsStore.ts, and in migration 0020. When auth ownership merges, gate
// writes on auth.uid().
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
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

// Bound untrusted keys/batches so one request can't carry an unbounded load.
const MAX_REF_LENGTH = 200;
const MAX_BATCH_REFS = 50;
const MAX_TOP_LIMIT = 25;

function cleanRef(value: unknown): string | null {
  const ref = readString(value)?.trim() ?? "";
  return ref !== "" && ref.length <= MAX_REF_LENGTH ? ref : null;
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const kind = body.kind;
  if (!isRatingKind(kind)) {
    return jsonNoStore({ error: "kind must be \"drink\" or \"venue\"." }, { status: 400 });
  }

  // For a venue, the venue id IS the ref — accept either field.
  const ref = cleanRef(body.ref) ?? (kind === "venue" ? cleanRef(body.venueId) : null);
  if (!ref) return jsonNoStore({ error: "Add a ref to rate." }, { status: 400 });

  const handle = normalizeHandle(readString(body.handle) ?? "");
  if (!handle) return jsonNoStore({ error: "Add a handle." }, { status: 400 });

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  const rating = parseRating(body.rating);
  if (rating === null) {
    return jsonNoStore(
      { error: "Pick 1–5 stars, in half-star steps." },
      { status: 400 },
    );
  }

  // Rate-limit per handle + hashed IP, like the app's other write routes.
  const key = `rating:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return jsonNoStore({ error: "Too many ratings, slow down." }, { status: 429 });
  }

  try {
    const summary = await ratingsStore().rate({
      kind,
      ref,
      venueId: cleanRef(body.venueId) ?? undefined,
      handle,
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
    return jsonNoStore(
      { error: "Ratings storage is unavailable — try again shortly." },
      { status: 503 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (!isRatingKind(kind)) {
    return jsonNoStore({ error: "kind must be \"drink\" or \"venue\"." }, { status: 400 });
  }

  // Top-rated list mode (the discover page's "Top rated pubs this month").
  if (params.get("top")) {
    const rawLimit = Number(params.get("limit"));
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_TOP_LIMIT)
        : 10;
    const top = await ratingsStore().top(kind as RatingKind, { limit });
    return jsonNoStore({ top }, { status: 200 });
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
