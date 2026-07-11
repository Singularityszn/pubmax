"use client";

import dynamic from "next/dynamic";

import MapLoadingSkeleton from "@/components/map/MapLoadingSkeleton";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";

// Module-level dynamic — do not create components during render (eslint).
// City-specific copy continues in PubMap's own .mapLoading chrome after mount.
const PubMap = dynamic(() => import("./PubMap"), {
  ssr: false,
  loading: () => <MapLoadingSkeleton />,
});

type PubMaxingShellProps = {
  cityId?: CityId;
};

export default function PubMaxingShell({
  cityId = DEFAULT_CITY_ID,
}: PubMaxingShellProps) {
  return <PubMap key={cityId} cityId={cityId} />;
}
