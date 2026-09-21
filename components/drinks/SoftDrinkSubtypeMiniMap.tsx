"use client";

import Link from "next/link";

import {
  boundsFromCoords,
  projectCoords,
  type LngLat,
} from "@/lib/routeMiniMap";
import type { SubtypePricedVenueRow } from "@/lib/drinkSubtypeObservedPrice";
import { drinkSubtypePricedMapHref } from "@/lib/drinkSubtypeObservedPrice";

const VIEW_W = 320;
const VIEW_H = 200;
const PADDING = 18;

type SoftDrinkSubtypeMiniMapProps = {
  subtypeId: string;
  rows: readonly SubtypePricedVenueRow[];
};

export default function SoftDrinkSubtypeMiniMap({
  subtypeId,
  rows,
}: SoftDrinkSubtypeMiniMapProps) {
  const priced = rows.filter((row) => row.observed);
  const coords: LngLat[] = priced
    .map((row) => [row.longitude, row.latitude] as LngLat)
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (coords.length === 0) return null;

  const bounds = boundsFromCoords(coords);
  if (!bounds) return null;
  const projected = projectCoords(coords, bounds, {
    width: VIEW_W,
    height: VIEW_H,
    padding: PADDING,
  });

  const mapHref = drinkSubtypePricedMapHref({ subtypeId });

  return (
    <Link className="softDrinksWater__mapFrame" href={mapHref} prefetch={false}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="Map preview of pubs with listed prices. Open the full map."
      >
        <rect width={VIEW_W} height={VIEW_H} className="softDrinksWater__mapBg" />
        {projected.map((point, index) => (
          <circle
            key={priced[index]?.venueId ?? index}
            cx={point.x}
            cy={point.y}
            r={5}
            className="softDrinksWater__mapDot"
          />
        ))}
      </svg>
      <span className="softDrinksWater__mapCaption">Open the map</span>
    </Link>
  );
}
