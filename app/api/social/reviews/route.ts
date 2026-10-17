import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostReviewStore } from "@/lib/socialPostReviewStore";
import { resolveSocialVenueId } from "@/lib/socialPostVenue.server";
import { hashActor } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_LIMIT = 30;
const READ_WINDOW_MS = 60_000;

/**
 * GET /api/social/reviews: the viewer's own pubs, ranked by the score they
 * gave each one (newest score per pub). With ?scope=lot, the viewer's lot's
 * pubs instead: each mutual friend's newest score averaged, over posts the
 * viewer may read (0184). Neither list reaches anybody but the viewer.
 */
export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) {
    return publicApiError(access.error, access.code, access.status, { retryable: access.retryable === true, headers: { "Cache-Control": "private, no-store" } });
  }
  const raw = new URL(request.url).searchParams.get("limit");
  const limit = raw === null ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return publicApiError("Ranking size must be between 1 and 200.", "INVALID_LIMIT", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  const key = `social-review-ranking:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, READ_LIMIT, READ_WINDOW_MS)) {
    return publicApiError("Too many requests. Slow down.", "RATE_LIMITED", 429, { retryable: true, headers: { "Cache-Control": "private, no-store" } });
  }
  const scope = new URL(request.url).searchParams.get("scope") ?? "mine";
  if (scope !== "mine" && scope !== "lot") {
    return publicApiError("Choose your ranking or your lot's.", "INVALID_SCOPE", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    if (scope === "lot") {
      const lot = await socialPostReviewStore().lotRanking(access.actor, limit);
      const entries = await Promise.all(lot.map(async (entry) => {
        const venue = await resolveSocialVenueId(entry.venueId);
        return { ...entry, venueName: venue.ok ? venue.venueName : null };
      }));
      return Response.json({ entries }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const ranked = await socialPostReviewStore().ranking(access.actor, limit);
    const entries = await Promise.all(ranked.map(async (entry) => {
      const venue = await resolveSocialVenueId(entry.venueId);
      return { ...entry, venueName: venue.ok ? venue.venueName : null };
    }));
    return Response.json({ entries }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return publicApiError("Your rankings are unavailable right now.", "SOCIAL_REVIEWS_UNAVAILABLE", 503, { retryable: true, headers: { "Cache-Control": "private, no-store" } });
  }
}
