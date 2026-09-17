"use client";

// A drink's own column in the venue Menu: what the drink IS, what the crowd
// scored it, and the detail a drinker opens by tapping it.
//
// This is the client island of an otherwise server-composable menu
// (`DrinkMenu` takes its drinks as a prop and runs on either side), so the
// disclosure state and the rating state live here and `DrinkMenu` stays a
// plain renderer.
//
// TWO PLACES, ONE STATE. `useDrinkRating` is read once and handed to both
// surfaces, so a vote that crosses MIN_VOTES_TO_SHOW cannot light the detail
// and leave the price line silent:
//   • the price line carries the COMMUNITY score, read-only, past the floor;
//   • the detail carries the ONE rate action and the viewer's own vote.
// Closed, the detail renders nothing at all, so a drink nobody has rated
// announces no star widget (captain, 4 Sept 2026).

import { useState } from "react";

import DrinkRatingAction from "@/components/ratings/DrinkRatingAction";
import DrinkRatingRow from "@/components/ratings/DrinkRatingRow";
import { useDrinkRating } from "@/components/ratings/useDrinkRating";
import type { Drink } from "@/lib/drinks";
import styles from "./drinkMenu.module.css";

export type DrinkRowMainProps = {
  drink: Drink;
  /** The one-line descriptor (producer, style, region, abv), or "". */
  meta: string;
  venueId?: string;
};

export default function DrinkRowMain({ drink, meta, venueId }: DrinkRowMainProps) {
  const [open, setOpen] = useState(false);
  const rating = useDrinkRating(drink.id, venueId);
  // Derived from the stable drink id (unique inside a menu), so the server and
  // the browser agree on it and no id is minted per render.
  const detailId = `drink-detail-${drink.id}`;

  return (
    <div className={styles.drinkRowMain}>
      <button
        type="button"
        className={styles.drinkDisclosure}
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className={styles.drinkName}>{drink.name}</span>
        {meta ? <span className={styles.drinkMeta}>{meta}</span> : null}
        {drink.servingSize ? (
          <span className={styles.drinkServing}>{drink.servingSize}</span>
        ) : null}
        {drink.alcoholType === "low-no" ? (
          <span className={styles.drinkLowNoChip}>Low/no</span>
        ) : null}
      </button>
      {/* The community score, keyed by the stable drink id (see migration
          0020's drink_ref note); the whole menu's summaries arrive in ONE
          batched GET. Stars inherit the section's category accent. */}
      <DrinkRatingRow
        drinkName={drink.name}
        summary={rating.summary}
        shownAverage={rating.shownAverage}
        accent="var(--cat-accent)"
      />
      {/* The region always exists so `aria-controls` names something real, but
          its contents do not: a closed detail holds no action and no stars, so
          nothing unopened is announced or reachable by tab. */}
      <div className={styles.drinkRowDetail} id={detailId} hidden={!open}>
        {open ? (
          <DrinkRatingAction
            drinkName={drink.name}
            rating={rating}
            accent="var(--cat-accent)"
          />
        ) : null}
      </div>
    </div>
  );
}
