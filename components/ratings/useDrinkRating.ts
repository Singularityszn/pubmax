"use client";

// ONE drink row, ONE rating state (PRD E3).
//
// A drink's rating is read once and written once, but it is SHOWN in two
// places that must never disagree: the community score on the price line, and
// the viewer's own vote inside the drink's detail. Two components each holding
// their own copy would let a vote that crosses the floor update the detail and
// leave the price line silent, so the state is lifted here and both surfaces
// read the same fields.
//
// `shownAverage` is the ONE predicate for "there is a community score to
// print": a score under MIN_VOTES_TO_SHOW is noise, and the price line stays
// blank rather than paint five stars nobody earned (captain, 4 Sept 2026).
//
// Identity is the app's self-asserted handle (localStorage `pubmax_handle`);
// with none stored, the first rating attempt asks for one inline.

import { useEffect, useState } from "react";

import type { RatingSummary, RatingValue } from "@/lib/ratings";

import {
  fetchRatingSummary,
  postRating,
  rememberHandle,
  storedHandle,
} from "./ratingsClient";

export type DrinkRatingState = {
  /** The batched community summary, or null while it is unread. */
  summary: RatingSummary | null;
  /** The viewer's own vote in this session, or null. */
  myRating: RatingValue | null;
  /** The community average, but only past the vote floor. Null otherwise. */
  shownAverage: number | null;
  handle: string;
  setHandle: (handle: string) => void;
  /** True once a rating attempt found no stored handle. */
  needsHandle: boolean;
  error: string | null;
  rate: (value: RatingValue) => void;
};

export function useDrinkRating(
  drinkRef: string,
  venueId?: string,
): DrinkRatingState {
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [myRating, setMyRating] = useState<RatingValue | null>(null);
  const [handle, setHandle] = useState("");
  const [needsHandle, setNeedsHandle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const nextHandle = storedHandle();
      const result = await fetchRatingSummary("drink", drinkRef);
      if (cancelled) return;
      setHandle(nextHandle);
      if (result) setSummary(result);
    });
    return () => {
      cancelled = true;
    };
  }, [drinkRef]);

  const rate = (value: RatingValue) => {
    void (async () => {
      const clean = handle.trim();
      if (!clean) {
        setNeedsHandle(true);
        setError("Add a handle to rate.");
        return;
      }
      setMyRating(value);
      setError(null);
      try {
        const fresh = await postRating({
          kind: "drink",
          ref: drinkRef,
          venueId,
          handle: clean,
          rating: value,
        });
        rememberHandle(clean);
        setNeedsHandle(false);
        setSummary(fresh);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't save your rating just now.",
        );
      }
    })();
  };

  const shownAverage =
    summary && summary.shown && summary.average !== null ? summary.average : null;

  return {
    summary,
    myRating,
    shownAverage,
    handle,
    setHandle,
    needsHandle,
    error,
    rate,
  };
}
