"use client";

// The map's Last orders filter: the venue ids whose OpenStreetMap hours run at
// least 30 more minutes right now (lib/lastOrdersList.ts). The hours pack is
// read only once the filter is on, the same rule as Open now's directory, so a
// map that never turns it on pays nothing. The set is recomputed every minute,
// because a pub that closes at 23:30 must leave the map at 23:00.
//
// `ids` is null ONLY when the filter is off, and the caller then does not
// narrow. While the filter is on and the hours are not read yet, `ids` is an
// EMPTY set and `reading` is true: no curated pin may sit under the caption
// "open 30 more minutes" before the hours that would say so have arrived. A
// failed read is an empty set too: with no hours we can stand behind, no pin
// may claim to be open.

import { useEffect, useMemo, useState } from "react";

import {
  LAST_ORDERS_HOURS_PATH,
  lastOrdersOpenVenueIds,
  parseLastOrdersHoursPack,
  type LastOrdersPub,
} from "@/lib/lastOrdersList";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { useLiveClock } from "@/lib/useLiveClock";

const TICK_MS = 60_000;

export type LastOrdersVenueIds = {
  ids: ReadonlySet<string> | null;
  /** On, and the hours or the clock have not answered yet. */
  reading: boolean;
  /** On, and the hours could not be read: no pin shows, and the caption says why. */
  failed: boolean;
};

const NONE: ReadonlySet<string> = new Set();

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function useLastOrdersVenueIds(on: boolean): LastOrdersVenueIds {
  const [pubs, setPubs] = useState<readonly LastOrdersPub[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!on) return;
    const controller = new AbortController();
    void loadSurfaceJson<unknown>(
      LAST_ORDERS_HOURS_PATH,
      { signal: controller.signal, validate: (body) => parseLastOrdersHoursPack(body) !== null },
      (body) => {
        setFailed(false);
        setPubs(parseLastOrdersHoursPack(body)?.pubs ?? []);
      },
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) {
        setFailed(true);
        setPubs([]);
      }
    });
    return () => controller.abort();
  }, [on]);

  // A live clock that also wakes with the tab (lib/useLiveClock.ts).
  const now = useLiveClock(TICK_MS, on);

  // The same pubs are open from one minute to the next nearly every tick. The
  // set keeps its identity while its members do, so the map's pin pipeline and
  // the canvas (both keyed on identity) redraw only when a pub really leaves.
  const [held, setHeld] = useState<ReadonlySet<string> | null>(null);
  const fresh = useMemo(
    () => (on && pubs && now ? lastOrdersOpenVenueIds(pubs, now) : null),
    [on, pubs, now],
  );
  const stable = fresh && held && sameMembers(fresh, held) ? held : fresh;
  if (stable !== held) setHeld(stable);

  if (!on) return { ids: null, reading: false, failed: false };
  if (failed) return { ids: NONE, reading: false, failed: true };
  if (!stable) return { ids: NONE, reading: true, failed: false };
  return { ids: stable, reading: false, failed: false };
}
