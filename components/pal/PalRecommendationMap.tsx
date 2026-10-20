"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useState } from "react";

import { probeWebGl2 } from "@/components/map/canvas/webgl";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import type { PalCard } from "@/lib/palChat";
import { palRecommendationPoints, type PalRecommendationPoint } from "@/lib/palRecommendationMap";
import { loadSlimVenuesForCity } from "@/lib/venuesSlim";
import "./palChat.css";

const MapCanvas = dynamic(() => import("@/components/map/PalRecommendationMapCanvas"), {
  ssr: false,
  loading: () => <div className="palChatMapCanvas"><p className="palChatMapStatus">Loading the pub map…</p></div>,
});

/** These are choices, so the map draws pins without inventing a walking route. */
export default function PalRecommendationMap({ cards }: { cards: PalCard[] }) {
  const [points, setPoints] = useState<PalRecommendationPoint[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const onUnavailable = useCallback(() => setUnavailable(true), []);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    let current = true;
    void loadSlimVenuesForCity(DEFAULT_CITY_ID).then((venues) => {
      if (!current) return;
      const next = palRecommendationPoints(cards, venues);
      setPoints((previous) => previous && previous.length === next.length && previous.every((point, index) => {
        const other = next[index]!;
        return point.venueId === other.venueId && point.name === other.name && point.lat === other.lat && point.lng === other.lng && point.number === other.number;
      }) ? previous : next);
      setUnavailable(typeof WebGL2RenderingContext !== "function" || !probeWebGl2().hasContext);
    }, () => { if (current) setUnavailable(true); });
    return () => { current = false; };
  }, [cards]);

  if (unavailable || (points && !points.length)) {
    return <p className="palChatMapStatus" role="status">The map preview is unavailable. Open a pub below to see its location.</p>;
  }
  return (
    <section className="palChatMap" tabIndex={-1} aria-labelledby={titleId} aria-describedby={descriptionId}>
      <p id={titleId} className="palChatMapTitle">{points ? `${points.length} ${points.length === 1 ? "pub" : "pubs"} on the map` : "Your pubs on the map"}</p>
      <p id={descriptionId} className="palChatMapCaption">
        {points?.map((point) => `${point.number}. ${point.name}`).join(" · ") ?? "Locating the pubs in this answer…"}
      </p>
      {points?.length ? (
        <MapCanvas points={points} onUnavailable={onUnavailable} />
      ) : <div className="palChatMapCanvas"><p className="palChatMapStatus" role="status">Loading the pub map…</p></div>}
    </section>
  );
}
