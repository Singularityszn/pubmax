"use client";

// Bridge tonight's drink-weather verdict to a DrinkCategory for the persona
// lens's "fits tonight" sort. Reads the SAME /api/tonight-conditions surface the
// Conditions strip uses (no new weather rules, no duplicated evaluation) and
// maps the verdict's drinkSuggestion phrase to a category via lib/personaDrinks.
// Fail-soft + React 19 deferred setState, matching useTonightOpportunities.

import { useEffect, useState } from "react";

import type { DrinkCategory } from "@/lib/drinks";
import { drinkCategoryForSuggestion } from "@/lib/personaDrinks";

type ConditionsResponse = {
  summary?: { drinkSuggestion?: string } | null;
};

/**
 * The DrinkCategory that fits tonight, or null when there is no verdict / the
 * request fails. `enabled` gates the fetch (conditions is London-only today).
 */
export function usePersonaTonightCategory(enabled: boolean): DrinkCategory | null {
  const [category, setCategory] = useState<DrinkCategory | null>(null);

  useEffect(() => {
    if (!enabled) {
      Promise.resolve().then(() => setCategory(null));
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/tonight-conditions", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as ConditionsResponse;
        if (controller.signal.aborted) return;
        const next = drinkCategoryForSuggestion(body.summary?.drinkSuggestion);
        Promise.resolve().then(() => setCategory(next));
      } catch {
        if (controller.signal.aborted) return;
        Promise.resolve().then(() => setCategory(null));
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  return category;
}
