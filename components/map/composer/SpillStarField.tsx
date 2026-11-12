import { useId } from "react";

import StarRating from "@/components/ratings/StarRating";
import type { RatingValue } from "@/lib/ratings";

// The drinker's stars for what they drank. Optional, and only ever theirs:
// the drop shows this one vote, never a count or an average.
export function SpillStarField({
  rating,
  setRating,
}: {
  rating: RatingValue | null;
  setRating: (value: RatingValue | null) => void;
}) {
  const labelId = useId();
  return (
    <div className="spillTextField spillStarField" role="group" aria-labelledby={labelId}>
      <span className="spillFieldLabel" id={labelId}>
        How was it?
      </span>
      <div className="spillStarRow">
        <StarRating value={rating} label="Rate your drink" interactive size="lg" onRate={setRating} />
        {rating !== null ? (
          <button type="button" className="spillStarClear" onClick={() => setRating(null)}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
