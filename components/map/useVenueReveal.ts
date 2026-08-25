"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  revealForm,
  venuePriceRevealMotion,
  venuePriceRevealMotionClass,
  venueRevealRootClasses,
  VENUE_REVEAL_CINEMA_MS,
  VENUE_REVEAL_SHORT_MS,
  type VenuePriceRevealMotion,
  type VenueRevealForm,
} from "@/lib/venueReveal";
import type { CommunityPrice } from "@/lib/communityPrice";
import { orderVenueDrinkPrices, DEFAULT_DRINK_LANE } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";

export type VenueRevealState = {
  venueId: string;
  form: VenueRevealForm;
  priceMotion: VenuePriceRevealMotion;
  priceMotionClass: string;
  interrupted: boolean;
  active: boolean;
};

export function useVenueReveal() {
  const lastRevealAtRef = useRef<number | null>(null);
  const revealRunningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reveal, setReveal] = useState<VenueRevealState | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const interruptReveal = useCallback(() => {
    revealRunningRef.current = false;
    clearTimer();
    setReveal((current) =>
      current?.active ? { ...current, interrupted: true, active: false } : current,
    );
  }, [clearTimer]);

  const beginReveal = useCallback(
    (
      venueId: string,
      rows: readonly CommunityPrice[] | undefined,
      lane: DrinkCategory = DEFAULT_DRINK_LANE,
    ) => {
      const now = Date.now();
      const forceShort = revealRunningRef.current;
      const form = forceShort ? "short" : revealForm(now, lastRevealAtRef.current);
      lastRevealAtRef.current = now;
      revealRunningRef.current = form === "full";
      const ordered = orderVenueDrinkPrices(rows, lane);
      const lead = ordered[0]?.price;
      const priceMotion = venuePriceRevealMotion({ communityLead: lead }, now);
      const duration = form === "full" ? VENUE_REVEAL_CINEMA_MS : VENUE_REVEAL_SHORT_MS;
      clearTimer();
      setReveal({
        venueId,
        form,
        priceMotion,
        priceMotionClass: venuePriceRevealMotionClass(priceMotion),
        interrupted: false,
        active: true,
      });
      timerRef.current = setTimeout(() => {
        revealRunningRef.current = false;
        setReveal((current) =>
          current?.venueId === venueId
            ? { ...current, active: false }
            : current,
        );
        timerRef.current = null;
      }, duration);
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const rootClasses =
    reveal?.active && !reveal.interrupted
      ? venueRevealRootClasses({
          active: true,
          form: reveal.form,
          interrupted: false,
        })
      : "";

  const entranceOvershoot = Boolean(
    reveal?.active && reveal.form === "full" && !reveal.interrupted,
  );

  return {
    reveal,
    beginReveal,
    interruptReveal,
    rootClasses,
    entranceOvershoot,
  };
}
