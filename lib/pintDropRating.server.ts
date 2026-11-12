import "server-only";

import { cleanDrinkMeasure } from "@/lib/drinkMeasure";
import { log } from "@/lib/log";
import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";
import { normalizeHandle } from "@/lib/profiles";
import { isRatingValue, type RatingValue } from "@/lib/ratings";
import { ratingsStore } from "@/lib/ratingsStore";

// A Pint Drop's stars are the drinker's vote on what they drank at that pub.
// They live in drink_ratings, which holds ONE current vote per ref and handle,
// under a ref of their own so they never mix with a menu drink's votes. So a
// drop shows its drinker's LATEST vote on that drink at that pub, and a later
// drop of the same drink re-rates the earlier one too. A drop with no drink
// name rates its measure. The price and its evidence are never touched here.

const REF_PREFIX = "pint-drop";
const MAX_REF_LENGTH = 200;

type RatedDropKey = { venueId: string; drink: string; measure?: unknown };

function pintDropRatingRef(drop: RatedDropKey): string {
  const subject =
    drop.drink.trim().toLowerCase().replace(/\s+/g, " ") || cleanDrinkMeasure(drop.measure);
  return `${REF_PREFIX}:${drop.venueId}:${subject}`.slice(0, MAX_REF_LENGTH);
}

/**
 * Store the drinker's stars for a drop that just landed. The drop stands
 * either way: a vote that cannot be stored is logged and answered as null,
 * never a failed drop.
 */
export async function ratePintDrop(
  drop: RatedDropKey & { handle: string },
  rating: RatingValue,
): Promise<RatingValue | null> {
  try {
    await ratingsStore().rate({
      kind: "drink",
      ref: pintDropRatingRef(drop),
      venueId: drop.venueId,
      handle: drop.handle,
      rating,
    });
    return rating;
  } catch (err) {
    log("warn", "pint_drops.rating_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Each listed drop's stars, by drop id. Only a drop that names its drinker can
 * carry them: an anonymous or retired drop shows a label, not a handle, and
 * the vote is kept under the real one.
 */
export async function pintDropRatings(
  drops: ReadonlyArray<RatedDropKey & { id: string; handle: string; visibility?: string }>,
): Promise<Map<string, RatingValue>> {
  const named = drops.filter(
    (drop) => drop.visibility !== "anonymous" && drop.handle !== ANON_HANDLE_LABEL,
  );
  const out = new Map<string, RatingValue>();
  if (named.length === 0) return out;
  const votes = await ratingsStore().handleVotes("drink", named.map(pintDropRatingRef));
  for (const drop of named) {
    const vote = votes[pintDropRatingRef(drop)]?.[normalizeHandle(drop.handle)];
    if (isRatingValue(vote)) out.set(drop.id, vote);
  }
  return out;
}
