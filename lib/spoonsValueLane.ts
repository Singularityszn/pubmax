// The browser's lane onto the Spoons value figures.
//
// FETCHED ONLY WHEN THE LENS IS ON. This is not a first-paint stream and it is
// not one of the lanes lib/mapFirstPinStreams.ts holds, for a simpler reason
// than a hold: nothing asks for it until a reader has switched the lens on,
// which they can only do after the map has drawn something to switch it over.
// The map's request budget on a cold open is therefore unmoved.
//
// It reads the SLIM lane (29 KB of `[venueId, milliunits, pence, rank]`), never
// the 640 KB edition: the baskets, the towns and the credit belong to the
// ranking page and the venue sheet, which are read on the server.
//
// One read per session. A read that FAILED answers `unavailable` and is not
// cached, so switching the lens off and on again asks once more rather than
// leaving a blank lens for the life of the tab.

import { discardBody } from "@/lib/responseBody";
import {
  modalMilliunits,
  parseSpoonsValueMapLane,
  SPOONS_VALUE_MAP_LANE_URL,
  type SpoonsValueMapPub,
} from "@/lib/spoonsValue";

type SpoonsValueLaneStatus = "ready" | "empty" | "unavailable";

export type SpoonsValueLane = {
  status: SpoonsValueLaneStatus;
  byVenueId: ReadonlyMap<string, SpoonsValueMapPub>;
  /** The threshold the bands are cut at, derived from the lane itself. */
  modalMilliunits: number | null;
};

const EMPTY_SPOONS_VALUE_LANE: SpoonsValueLane = {
  status: "unavailable",
  byVenueId: new Map(),
  modalMilliunits: null,
};

let cached: SpoonsValueLane | null = null;
let pending: Promise<SpoonsValueLane> | null = null;

async function load(signal?: AbortSignal): Promise<SpoonsValueLane> {
  try {
    const res = await fetch(SPOONS_VALUE_MAP_LANE_URL, { signal });
    if (!res.ok) {
      discardBody(res);
      return EMPTY_SPOONS_VALUE_LANE;
    }
    const pubs = parseSpoonsValueMapLane(await res.json());
    const byVenueId = new Map<string, SpoonsValueMapPub>();
    for (const pub of pubs) if (!byVenueId.has(pub.venueId)) byVenueId.set(pub.venueId, pub);
    const lane: SpoonsValueLane = {
      status: pubs.length > 0 ? "ready" : "empty",
      byVenueId,
      modalMilliunits: modalMilliunits(pubs),
    };
    cached = lane;
    return lane;
  } catch {
    return EMPTY_SPOONS_VALUE_LANE;
  } finally {
    pending = null;
  }
}

export function loadSpoonsValueLane(signal?: AbortSignal): Promise<SpoonsValueLane> {
  if (cached) return Promise.resolve(cached);
  pending ??= load(signal);
  return pending;
}
