"use client";

import dynamic from "next/dynamic";
import { useMemo, useSyncExternalStore } from "react";

import { useHasBeenHere } from "@/components/map/beenHere/useBeenHere";
import type { SunChaserMap } from "@/components/map/sunChaser/SunChaserLayer";
import { readProviderAccountRevision, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { liveLocationNightSnapshot, readLiveLocationNight, subscribeLiveLocationNight } from "@/lib/liveLocationNight";
import type { Venue } from "@/lib/venues";

// Sun Chaser's maths and map layer load only once its chip is on.
const SunChaserLayer = dynamic(() => import("@/components/map/sunChaser/SunChaserLayer"), { ssr: false });
// The crew's dots load only for a reader who is in tonight's Plan or Open Crew.
const CrewLiveLocationLayer = dynamic(() => import("@/components/map/liveOverlays/CrewLiveLocationLayer"), { ssr: false });
// The Been here marks load only for a reader whose list holds a pub.
const BeenHereLayer = dynamic(() => import("@/components/map/beenHere/BeenHereLayer"), { ssr: false });

/** Map layers that follow live state. Each one draws nothing and loads nothing until it is needed. */
export default function MapLiveOverlays({ map, sunChaserOn, venues }: { map: SunChaserMap | null; sunChaserOn: boolean; venues: readonly Venue[] }) {
  const snapshot = useSyncExternalStore(subscribeLiveLocationNight, liveLocationNightSnapshot, () => "");
  const owner = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  const night = useMemo(() => readLiveLocationNight(snapshot), [snapshot]);
  const hasBeenHere = useHasBeenHere();
  return (
    <>
      {sunChaserOn ? <SunChaserLayer map={map} venues={venues} /> : null}
      {hasBeenHere && map ? <BeenHereLayer map={map} /> : null}
      {night && map ? <CrewLiveLocationLayer key={`${owner}:${night.planId}:${night.via}`} map={map} night={night} /> : null}
    </>
  );
}
