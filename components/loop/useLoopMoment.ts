"use client";

import { useEffect, useRef } from "react";

import { trackEvent } from "@/lib/analytics";
import type { AnalyticsEventName, AnalyticsProps } from "@/lib/analyticsEvents";

/**
 * Report one loop moment once per surface, whatever React does to the tree.
 *
 * The four moments this hook serves (`late_food_viewed`, `briefing_viewed`,
 * `briefing_opened`, `recap_viewed`) are IMPRESSIONS, and an impression that
 * fires twice makes every ratio built on it wrong in the direction nobody
 * checks. Three ways one would double without a latch: React's development
 * double-invoke, a parent re-render that changes an unrelated prop, and a
 * surface that re-resolves its own props after a deferred read (the morning
 * brief personalizes itself in an effect, so its props arrive after mount).
 *
 * `key` is the identity of the thing being reported, so a surface that really
 * moves on - another recap, another night - reports again while the same one
 * never does. An empty key means "not ready to say yet" and sends nothing,
 * which is what keeps a moment from being reported off a value still loading.
 *
 * There is no server half. Every one of these events is a browser impression,
 * so a route handler emitting the same name would be a second count of one
 * read; `__tests__/loopMomentEvents.test.ts` sweeps the tree for one.
 */
export function useLoopMoment(
  name: AnalyticsEventName,
  key: string | null,
  props?: AnalyticsProps,
): void {
  // The latch, not the dependency list, is what makes this once-only. A caller
  // passing a fresh props literal on every render re-runs the effect, and the
  // re-run returns at the guard, so the props stay honest (they are always the
  // ones on screen) without a ref written during render.
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!key || reported.current === key) return;
    reported.current = key;
    trackEvent(name, props);
  }, [key, name, props]);
}
