"use client";

// Both Been lists on one map: the pubs you've both been to, yours and theirs,
// each a different pin. The map loads only here, after the lists have painted.
// A pub the venue index cannot place stays in its list and gets no pin.

import dynamic from "next/dynamic";
import { Component, useCallback, useMemo, useState, type ReactNode } from "react";

import { probeWebGl2 } from "@/components/map/canvas/webgl";
import { PASSPORT_COPY, type BeenCompare, type ComparedVenue } from "@/lib/profilePassport";

import type { BeenComparePin } from "./BeenCompareMapCanvas";

const MapCanvas = dynamic(() => import("./BeenCompareMapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="beenCompareMapCanvas">
      <p className="beenCompareMapLoading">Loading the streets…</p>
    </div>
  ),
});

class MapBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onUnavailable();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function pinsFor(been: BeenCompare<ComparedVenue>): BeenComparePin[] {
  const sides: Array<[BeenComparePin["side"], ComparedVenue[]]> = [
    ["you", been.onlyYou],
    ["them", been.onlyThem],
    ["both", been.both],
  ];
  return sides.flatMap(([side, venues]) =>
    venues.flatMap((venue) =>
      venue.point ? [{ venueId: venue.venueId, name: venue.venueName || "A London pub", side, lng: venue.point[0], lat: venue.point[1] }] : [],
    ),
  );
}

export default function BeenCompareMap({ been }: { been: BeenCompare<ComparedVenue> }) {
  const pins = useMemo(() => pinsFor(been), [been]);
  const [unavailable, setUnavailable] = useState(
    () => typeof WebGL2RenderingContext !== "function" || !probeWebGl2().hasContext,
  );
  const onUnavailable = useCallback(() => setUnavailable(true), []);

  if (!pins.length) return null;
  const legend = (
    <ul className="beenCompareLegend" aria-label="Pins">
      <li><span className="beenComparePin beenComparePin--both" aria-hidden="true" />{PASSPORT_COPY.compareBoth}</li>
      <li><span className="beenComparePin beenComparePin--you" aria-hidden="true" />{PASSPORT_COPY.compareOnlyYou}</li>
      <li><span className="beenComparePin beenComparePin--them" aria-hidden="true" />{PASSPORT_COPY.compareOnlyThem}</li>
    </ul>
  );
  if (unavailable) {
    return <p className="passportQuiet" role="status">{PASSPORT_COPY.compareMapUnavailable}</p>;
  }
  return (
    <div className="beenCompareMap">
      <MapBoundary onUnavailable={onUnavailable}>
        <MapCanvas pins={pins} onUnavailable={onUnavailable} />
      </MapBoundary>
      {legend}
    </div>
  );
}
