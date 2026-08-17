"use client";

import { useCallback, useEffect, useState } from "react";

import { outWindowToApiDay, type OutDayWindow } from "@/lib/outListings";
import { outAnswerView } from "@/lib/out/outStatus";
import type { OutDay, OutResponse } from "@/lib/out/types";
import { discardBody } from "@/lib/responseBody";

type HeldOutAnswer = {
  day: OutDay;
  body: OutResponse | null;
  failed: boolean;
};

/**
 * One client read of GET /api/out. Shared by /out and /tonight so a ready
 * Ticketmaster answer cannot sit behind a second, idle What's-On wait.
 */
export function useOutListings(window: OutDayWindow) {
  const apiDay = outWindowToApiDay(window);
  const [answer, setAnswer] = useState<HeldOutAnswer | null>(null);
  const [generation, setGeneration] = useState(0);
  const view = outAnswerView(answer, apiDay);

  const retry = useCallback(() => {
    setAnswer(null);
    setGeneration((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/out?city=london&day=${apiDay}`);
        if (cancelled) {
          discardBody(res);
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setAnswer({ day: apiDay, body: null, failed: true });
          return;
        }
        const json = (await res.json()) as OutResponse;
        if (cancelled) return;
        setAnswer({ day: apiDay, body: json, failed: false });
      } catch {
        if (cancelled) return;
        setAnswer({ day: apiDay, body: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiDay, generation]);

  return { ...view, retry };
}
