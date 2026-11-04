// The owner's "Share your top ten" tap.
//
// GET /api/profiles/[handle]/top-ten -> 200 { path } (owner only)
//
// The ranking is private, so nothing reads it in public. This route signs the
// owner's first ten pubs as they stand now and returns the link to the page
// that shows them (lib/passportTopTenShare.server.ts). It stores nothing, so it
// is a read: the signature is the whole of the link. The profile asks for it
// only when the owner taps "Share your top ten". A list with no pubs answers 409.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { mintTopTenShare, topTenSharePath } from "@/lib/passportTopTenShare.server";
import { isLimited } from "@/lib/pintDrops";
import { topTenForShare } from "@/lib/profilePassport";
import { readPassportRanked } from "@/lib/profilePassport.server";
import { normalizeHandle } from "@/lib/profiles";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_LIMIT = 20;
const WINDOW_MS = 60 * 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle ?? "");
  const key = `passport-top-ten:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const result = await readPassportRanked(request, handle);
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.status, { retryable: result.status === 503 });
  }
  const ten = topTenForShare(result.body.ranked);
  if (!ten.length) {
    return publicApiError("Rank a pub first.", "NOTHING_RANKED", 409);
  }
  try {
    const token = mintTopTenShare(handle, ten.map((venue) => venue.venueId));
    return jsonNoStore({ path: topTenSharePath(handle, token) }, { status: 200 });
  } catch {
    return publicApiError("Sharing is unavailable right now.", "SHARE_UNAVAILABLE", 503, { retryable: true });
  }
}
