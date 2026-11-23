"use client";

import { useEffect, useState } from "react";

import SampleSkeleton from "@/components/ui/sample-skeleton";
import { loadPintIndexLeagueRows } from "@/lib/pintIndexLeagueLoader";
import {
  venueAreaPriceCompareIsComing,
  venueAreaPriceCompareLine,
} from "@/lib/venueAreaPriceCompare";
import type { LeagueRow } from "@/lib/pintIndex";
import type { ZonePintIndex } from "@/lib/zones";

import "./venueAreaPriceCompare.css";

type LoadedLeague = { rows: LeagueRow[] };

function CompareLine({ line }: { line: string }) {
  return (
    <p className="venueAreaPriceCompare" role="status">
      {line}
    </p>
  );
}

/**
 * One compare line under the venue Overview price block.
 *
 * Borough average from the public Pint Index league when that borough has a
 * row; otherwise the fare-zone median when the zone index cleared its gate.
 * Renders nothing when the pub has no displayable pint or the patch has no
 * publishable yardstick. Jokes stay off — this sits beside a figure.
 */
export default function VenueAreaPriceCompare({
  priceGbp,
  primaryBorough,
  zone,
  zoneIndex,
}: {
  priceGbp: number | null | undefined;
  primaryBorough?: string | null;
  zone?: number | null;
  zoneIndex?: ZonePintIndex | null;
}) {
  const [league, setLeague] = useState<LoadedLeague | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPintIndexLeagueRows()
      .then((rows) => {
        if (!cancelled) setLeague({ rows });
      })
      .catch(() => {
        if (!cancelled) setLeague({ rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const input = {
    priceGbp,
    primaryBorough,
    zone,
    leagueRows: league?.rows ?? null,
    zoneIndex: zoneIndex ?? null,
  };

  // No figure until the league settles, so a zone median never flashes ahead
  // of the borough. A line that is certain to land holds its room meanwhile,
  // so the controls under it do not move under a finger when it arrives.
  if (league === null) {
    if (!venueAreaPriceCompareIsComing(input)) return null;
    return (
      <SampleSkeleton label="Loading the area price">
        <CompareLine line="Sample price beside the area figure." />
      </SampleSkeleton>
    );
  }

  const line = venueAreaPriceCompareLine(input);
  return line ? <CompareLine line={line} /> : null;
}
