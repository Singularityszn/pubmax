// The drink's community score on the price line (PRD E3): a READ-ONLY star row
// and its vote count, beside the figure.
//
// A ROW WITH NO COMMUNITY SCORE IN IT RENDERS NOTHING (captain, 4 Sept 2026).
// Five empty stars beside a price read as a rating the drink does not have,
// and the Menu is a trust surface where every other mark - the figure, the
// PINT DROP chip, the observation date - is a claim somebody can stand behind.
// So the stars appear here only past the vote floor (MIN_VOTES_TO_SHOW), which
// `useDrinkRating` decides once as `shownAverage`.
//
// THE PICKER IS NOT HERE. Casting a vote is one quiet action inside the
// drink's own detail (`DrinkRatingAction`), so the price line carries a
// finished claim and never a widget asking to be filled in, and a drinker's
// own vote is shown where they cast it rather than on a line about everybody
// else. Nothing interactive is announced on this line.
//
// Colour: inherits `--rating-accent` from the surrounding category section
// when the caller passes the category accent (wine burgundy, whisky amber, …),
// defaulting to brass.

import type { RatingSummary } from "@/lib/ratings";

import StarRating from "./StarRating";

export type DrinkRatingRowProps = {
  drinkName: string;
  /** The batched community summary, or null while it is unread. */
  summary: RatingSummary | null;
  /** The community average past the vote floor; null means say nothing. */
  shownAverage: number | null;
  /** Category accent colour for the stars (defaults to brass). */
  accent?: string;
};

export default function DrinkRatingRow({
  drinkName,
  summary,
  shownAverage,
  accent,
}: DrinkRatingRowProps) {
  if (shownAverage === null || summary === null) return null;

  return (
    <span className="drinkRatingRow">
      <StarRating
        value={shownAverage}
        label={`${drinkName} rating`}
        size="sm"
        accent={accent}
      />
      <span className="ratingCount">
        {shownAverage.toFixed(1)} · {summary.count}
      </span>
    </span>
  );
}
