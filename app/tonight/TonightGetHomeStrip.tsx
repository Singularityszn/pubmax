"use client";

// Tonight get-home strip — one calm line pair under the location block:
// "Victoria line good service." / "Last train from Oxford Circus 00:05."
//
// Reuses the existing /api/last-train surface through the same hook as the
// Last orders panel (./useTonightGetHome.ts), so the two read one cached
// answer and say the same thing. Renders NOTHING while loading, on error,
// when there is nothing worth saying, or when the answer it holds is out of
// date — the page must never gain a spinner or an apologetic empty card for
// an optional extra, and it must never show a stale train time as current.
//
// The words are made from the live clock on every tick (lib/useLiveClock.ts),
// so "Leave in 10 min" turns into "Leave-by time has passed" when the deadline
// does, and the answer is read again every few minutes while the strip shows.
// Privacy: the hook coarsens the point (~110 m) before it leaves the device;
// enough to find the nearest station, not the drinker's doorstep.

import { TrainFront } from "lucide-react";

import DisruptionLine from "@/components/transport/DisruptionLine";
import { useLiveClock } from "@/lib/useLiveClock";

import { useTonightGetHome } from "./useTonightGetHome";

/** How often the words are made again. A minute figure needs nothing faster. */
const TICK_MS = 30_000;

type Props = {
  origin: { lat: number; lng: number };
};

export default function TonightGetHomeStrip({ origin }: Props) {
  const now = useLiveClock(TICK_MS);
  const getHome = useTonightGetHome(origin, now);
  const summary = getHome.status === "ready" ? getHome.summary : null;

  // The get-home summary and the disruption line are independent: a material
  // disruption can matter even when we have no last-train time to show, and vice
  // versa. Each renders nothing when it has nothing to say, so an all-clear night
  // with no summary produces no output at all.
  return (
    <>
      {summary ? (
        <div className="tonightGetHome" data-testid="tonight-get-home">
          <TrainFront size={16} aria-hidden="true" className="tonightGetHomeIcon" />
          <p className="tonightGetHomeCopy">
            <span className="tonightGetHomeStatus">{summary.statusLine}</span>{" "}
            <span>{summary.trainLine}</span>
          </p>
        </div>
      ) : null}
      <DisruptionLine lat={origin.lat} lng={origin.lng} />
    </>
  );
}
