"use client";

import dynamic from "next/dynamic";

import MapLoadingSkeleton from "@/components/map/MapLoadingSkeleton";

const PubMap = dynamic(() => import("./PubMap"), {
  ssr: false,
  loading: () => <MapLoadingSkeleton />,
});

export default function PubMaxingShell() {
  return <PubMap />;
}
