"use client";

// The map's Last orders filter: the venue ids whose OpenStreetMap hours run at
// least 30 more minutes right now (lib/lastOrdersList.ts). The hours pack is
// read only once the filter is on, the same rule as Open now's directory, so a
// map that never turns it on pays nothing. The set is recomputed every minute,
// because a pub that closes at 23:30 must leave the map at 23:00.
//
// `null` means "no answer yet" (filter off, or the pack still loading), and the
// caller then does not narrow. A failed read is an EMPTY set: with no hours we
// can stand behind, no pin may claim to be open.

import { useEffect, useMemo, useState } from "react";

import {
  LAST_ORDERS_HOURS_PATH,
  lastOrdersOpenVenueIds,
  parseLastOrdersHoursPack,
  type LastOrdersPub,
} from "@/lib/lastOrdersList";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

const TICK_MS = 60_000;

export function useLastOrdersVenueIds(on: boolean): ReadonlySet<string> | null {
  const [pubs, setPubs] = useState<readonly LastOrdersPub[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!on) return;
    const controller = new AbortController();
    void loadSurfaceJson<unknown>(
      LAST_ORDERS_HOURS_PATH,
      { signal: controller.signal, validate: (body) => parseLastOrdersHoursPack(body) !== null },
      (body) => setPubs(parseLastOrdersHoursPack(body)?.pubs ?? []),
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) setPubs([]);
    });
    return () => controller.abort();
  }, [on]);

  useEffect(() => {
    if (!on) return;
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [on]);

  return useMemo(
    () => (on && pubs && now ? lastOrdersOpenVenueIds(pubs, now) : null),
    [on, pubs, now],
  );
}
