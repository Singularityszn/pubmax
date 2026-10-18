import { Star, StarHalf } from "lucide-react";

import { formatSocialReviewRating, socialReviewStars } from "@/lib/socialPostReviews";

import "./reviewStars.css";

/**
 * A person's own score for a pub, as five stars and the figure. The stars are
 * decoration; the label carries the score for a screen reader.
 */
export default function ReviewStars({
  rating,
  size = 14,
  showFigure = true,
  label,
}: {
  rating: number;
  size?: number;
  showFigure?: boolean;
  label?: string;
}) {
  const { full, half, empty } = socialReviewStars(rating);
  const figure = formatSocialReviewRating(rating);
  return (
    <span className="reviewStars" role="img" aria-label={label ?? `${figure} out of 5`}>
      {Array.from({ length: full }, (_, index) => (
        <Star key={`full-${index}`} size={size} className="reviewStars__full" aria-hidden="true" />
      ))}
      {half ? (
        <span className="reviewStars__halfWrap" aria-hidden="true">
          <Star size={size} className="reviewStars__empty" />
          <StarHalf size={size} className="reviewStars__full reviewStars__half" />
        </span>
      ) : null}
      {Array.from({ length: empty }, (_, index) => (
        <Star key={`empty-${index}`} size={size} className="reviewStars__empty" aria-hidden="true" />
      ))}
      {showFigure ? <span className="reviewStars__figure" aria-hidden="true">{figure}</span> : null}
    </span>
  );
}
