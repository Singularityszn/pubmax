"use client";

import dynamic from "next/dynamic";

import MapLoadingSkeleton from "@/components/map/MapLoadingSkeleton";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";

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
  return <PubMap cityId={cityId} />;
}
