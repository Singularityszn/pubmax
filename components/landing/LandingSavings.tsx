"use client";

import { useEffect, useState } from "react";

import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { discardBody } from "@/lib/responseBody";
import {
  readerSavingLine,
  readerSavings,
  strangerSavingLine,
  type PintPriceAverages,
} from "@/lib/pintSavings";

// The one line that says what this is worth in pounds.
//
// A STRANGER reads the dataset's own arithmetic: the mean listed pint across
// every priced London pub against the mean across the cheapest third of them.
// __tests__/pintSavings.test.ts measures both from the shipped dataset, so the
// figure is checked rather than claimed, and a dataset too small to mean
// anything prints no line at all.
//
// A SIGNED IN READER reads their own total instead: every price they logged
// that came in under that average, counted for the gap it actually beat it by.
// The read only runs when there is a handle to read, so a stranger's landing
// makes no request and the route's own request ceiling never moves.

type Logged = { priceGbp: number | null };

export default function LandingSavings({ averages }: { averages: PintPriceAverages | null }) {
  const handle = useViewerHandle();
  const [mine, setMine] = useState<string | null>(null);

  useEffect(() => {
    if (!handle || !averages) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/pint-drops?author=${encodeURIComponent(handle)}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          discardBody(response);
          return;
        }
        const payload = (await response.json()) as { drops?: Logged[] };
        const logged = (payload.drops ?? []).flatMap((drop) =>
          typeof drop.priceGbp === "number" ? [{ priceGbp: drop.priceGbp }] : [],
        );
        setMine(readerSavingLine(readerSavings(logged, averages)));
      } catch {
        // A read that failed says nothing rather than a wrong number.
      }
    })();
    return () => controller.abort();
  }, [handle, averages]);

  const line = mine ?? strangerSavingLine(averages);
  if (!line) return null;
  return (
    <p className="lpSaved" data-mine={mine ? "" : undefined}>
      {line}
    </p>
  );
}
