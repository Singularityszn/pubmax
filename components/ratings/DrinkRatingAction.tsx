"use client";

// The ONE rate action, inside a drink's own detail (PRD E3).
//
// Hiding the empty star row from the price line (#1446) took the only door on
// to a first vote with it, and the vote floor is 10, so a drink nobody had
// rated could never gain a rating. This is that door, moved to where it does
// not make a claim: the drink's detail, opened by tapping the drink.
//
// EXACTLY ONE ACTION. Closed, the detail offers a single quiet "Rate this
// drink" button and no stars, so nothing is announced that has no rating in
// it. Pressing it opens the EXISTING picker (`StarRating` interactive), which
// is the same widget and the same write path as before. Once a vote is cast
// the picker stays, holding that vote, and the button is gone: the drinker
// sees their own rating here, never on the price line, which speaks for
// everybody else.

import { useState } from "react";

import StarRating from "./StarRating";
import type { DrinkRatingState } from "./useDrinkRating";

export type DrinkRatingActionProps = {
  drinkName: string;
  rating: DrinkRatingState;
  /** Category accent colour for the stars (defaults to brass). */
  accent?: string;
};

export default function DrinkRatingAction({
  drinkName,
  rating,
  accent,
}: DrinkRatingActionProps) {
  const [picking, setPicking] = useState(false);
  // The picker is open once it is asked for, and stays open over a cast vote,
  // a handle prompt and a refusal, so the way out never disappears mid-attempt.
  const open =
    picking || rating.myRating !== null || rating.needsHandle || rating.error !== null;

  if (!open) {
    return (
      <button
        type="button"
        className="drinkRateAction"
        onClick={() => setPicking(true)}
      >
        Rate this drink
      </button>
    );
  }

  return (
    <div className="drinkRatePicker">
      <StarRating
        value={rating.myRating}
        label={`Rate ${drinkName}`}
        interactive
        size="sm"
        accent={accent}
        onRate={(value) => rating.rate(value)}
      />
      {rating.myRating !== null ? (
        <span className="ratingNote">
          Your rating: {rating.myRating.toFixed(1)}
        </span>
      ) : null}
      {rating.needsHandle ? (
        <input
          className="ratingHandleInput"
          type="text"
          value={rating.handle}
          onChange={(event) => rating.setHandle(event.target.value)}
          placeholder="your handle"
          aria-label={`Handle to rate ${drinkName} as`}
        />
      ) : null}
      {rating.error ? (
        <span className="ratingError" role="status">
          {rating.error}
        </span>
      ) : null}
    </div>
  );
}
