"use client";

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { outWindowToApiDay, type OutDayWindow } from "@/lib/outListings";
import { outAnswerView, outListingsHealth } from "@/lib/out/outStatus";
import type { OutDay, OutResponse } from "@/lib/out/types";
import { discardBody } from "@/lib/responseBody";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { londonServiceDayRollover, PUBLIC_TONIGHT_FRESH_MS } from "@/lib/tonightListingCache";

type HeldOutAnswer = {
  day: OutDay;
  city: CityId;
  body: OutResponse | null;
  failed: boolean;
};

/**
 * Abort a hung /api/out request after this long, then report a failed read.
 *
 * The same ceiling the What's-On spine keeps (useWhatsOnTonight), and for the
 * same reason twice over: /tonight now waits on BOTH reads, so a request that
 * never answers would pin the loading skeleton for good over a night What's-On
 * had already described. Every read here settles, one way or the other.
 */
const OUT_FETCH_TIMEOUT_MS = 8_000;

/**
 * One client read of GET /api/out. Shared by /out and /tonight so a ready
 * Ticketmaster answer cannot sit behind a second, idle What's-On wait.
 *
 * The answer is held WITH the city it is about as well as the day, because the
 * reader's chosen city can change under the page (Places writes it, and the
 * write notifies every tab). London listings under a Manchester heading is the
 * same lie a stale day would be, so a city change is a pending read, never a
 * relabelled one. `/tonight` stays on London by passing nothing.
 */
export function useOutListings(
  window: OutDayWindow,
  city: CityId = DEFAULT_CITY_ID,
  options: { shareCurrentNight?: boolean } = {},
) {
  const apiDay = outWindowToApiDay(window);
  const sharedTonight = window === "tonight" && options.shareCurrentNight === true;
  const [answer, setAnswer] = useState<HeldOutAnswer | null>(null);
  const [generation, setGeneration] = useState(0);
  const view = outAnswerView(
    answer && answer.city === city ? answer : null,
    apiDay,
  );

  const retry = useCallback(() => {
    setAnswer(null);
    setGeneration((n) => n + 1);
  }, [setAnswer, setGeneration]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OUT_FETCH_TIMEOUT_MS);
    const url = `/api/out?city=${encodeURIComponent(city)}&day=${apiDay}`;
    void (async () => {
      try {
        if (sharedTonight) {
          const now = Date.now();
          const rollover = londonServiceDayRollover(now);
          const source = await loadSurfaceJson<OutResponse>(url, {
            signal: controller.signal,
            fresh: generation > 0,
            freshForMs: PUBLIC_TONIGHT_FRESH_MS,
            maxAgeMs: generation > 0 ? -1 : Math.min(PUBLIC_TONIGHT_FRESH_MS, now - rollover),
            requestNotBefore: rollover,
            validate: (body) => Array.isArray(body?.events),
          }, (body) => {
            setAnswer({ day: apiDay, city, body, failed: false });
            return outListingsHealth(body).status === "ready" && body.venueMatch !== "unavailable";
          });
          if (!cancelled && source === "failed") setAnswer({ day: apiDay, city, body: null, failed: true });
          return;
        }
        const res = await fetch(url, { signal: controller.signal });
        if (cancelled) {
          discardBody(res);
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setAnswer({ day: apiDay, city, body: null, failed: true });
          return;
        }
        const json = (await res.json()) as OutResponse;
        if (cancelled) return;
        setAnswer({ day: apiDay, city, body: json, failed: false });
      } catch {
        // Offline, DNS, a timeout abort: the reader is owed the same honest
        // line as a refused read, never day chips over an empty page with no
        // status, and never a skeleton that outlives the request behind it.
        if (cancelled) return;
        setAnswer({ day: apiDay, city, body: null, failed: true });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiDay, city, generation, sharedTonight]);

  return { ...view, retry };
}
