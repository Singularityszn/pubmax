"use client";

import { useEffect, useState } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import ReviewStars from "@/components/social/ReviewStars";
import { authedFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { formatSocialReviewRating, type SocialLotVenueReview } from "@/lib/socialPostReviews";

type Answer = { reviews: SocialLotVenueReview[]; summary: { average: number; raters: number } | null };

function reviewDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * What your lot said about this pub: the scored posts your mutual friends
 * wrote about it, newest first, and their newest scores averaged. It is your
 * friends' word, read to you alone (0187), never a public rating, so a reader
 * who is signed out, or whose lot has not been, sees nothing here at all.
 */
export default function PubLotReviews({ venueId, venueName }: { venueId: string; venueName: string }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const { signedIn } = useViewerSession();

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void authedFetch(`/api/social/pub-reviews?venueId=${encodeURIComponent(venueId)}`, { credentials: "same-origin", signal: controller.signal }, { requiresIdentity: true })
      .then(async (response) => {
        if (!response.ok) {
          discardBody(response);
          return;
        }
        setAnswer((await response.json()) as Answer);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [venueId, signedIn]);

  if (!signedIn || !answer || answer.reviews.length === 0) return null;
  const { summary } = answer;
  return (
    <section className="pubPage__section" aria-labelledby="pub-lot-title">
      <h2 id="pub-lot-title">Your lot on {venueName}</h2>
      {summary ? (
        <p className="pubLot__summary">
          <ReviewStars rating={summary.average} size={16} label={`Your lot average ${formatSocialReviewRating(summary.average)} out of 5`} />
          <span>from {summary.raters === 1 ? "one of your lot" : `${summary.raters} of your lot`}</span>
        </p>
      ) : null}
      <ul className="pubLot__list">
        {answer.reviews.map((review) => (
          <li key={review.postId} className="pubLot__review">
            <div className="pubLot__head">
              <strong>@{review.authorHandle}</strong>
              <ReviewStars rating={review.rating} size={12} />
              <time dateTime={review.createdAt}>{reviewDate(review.createdAt)}</time>
            </div>
            {review.body ? <p>{review.body}</p> : null}
            {review.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a moderated Social photo served by our own route
              <img className="pubLot__photo" src={review.photo.url} alt={review.photo.altText} loading="lazy" />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
