import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { lotVenueAverage } from "@/lib/socialPostReviews";
import { socialPostReviewStore } from "@/lib/socialPostReviewStore";
import { resolveSocialVenueId } from "@/lib/socialPostVenue.server";
import { hashActor } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/social/pub-reviews?venueId=...: what the reader's lot said about one
 * pub, for its pub page. Mutual friends' scored posts the reader may already
 * read, newest first, and their newest scores averaged. Answered to the reader
 * alone (0187); a reader with no lot, or no Social access, gets nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) {
    return publicApiError(access.error, access.code, access.status, { retryable: access.retryable === true, headers: NO_STORE });
  }
  const venueId = new URL(request.url).searchParams.get("venueId") ?? "";
  if (venueId.length < 1 || venueId.length > 100) {
    return publicApiError("Choose a pub.", "INVALID_VENUE", 400, { headers: NO_STORE });
  }
  const key = `social-pub-reviews:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, 120, 60_000)) {
    return publicApiError("Too many requests. Slow down.", "RATE_LIMITED", 429, { retryable: true, headers: NO_STORE });
  }
  try {
    const venue = await resolveSocialVenueId(venueId);
    if (!venue.ok) {
      return venue.unavailable
        ? publicApiError("Venue search is unavailable right now.", "VENUE_LOOKUP_UNAVAILABLE", 503, { retryable: true, headers: NO_STORE })
        : publicApiError("Choose a pub.", "INVALID_VENUE", 400, { headers: NO_STORE });
    }
    const reviews = await socialPostReviewStore().lotVenueReviews(access.actor, venue.venueId, 20);
    return Response.json({ reviews, summary: lotVenueAverage(reviews) }, { headers: NO_STORE });
  } catch {
    return publicApiError("Your lot's reviews are unavailable right now.", "SOCIAL_REVIEWS_UNAVAILABLE", 503, { retryable: true, headers: NO_STORE });
  }
}
