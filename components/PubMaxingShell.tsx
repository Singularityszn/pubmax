"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useEffect, useState } from "react";

import CityPubsOnlyNoteMount from "@/components/map/CityPubsOnlyNote";
import MapLoadingSkeleton from "@/components/map/MapLoadingSkeleton";
import { MapPricesReadContext } from "@/components/map/mapPricesReadContext";
import { warmCityMapFirstPaint, warmMapFirstPaint } from "@/lib/mapWarmup";
import { resolveMapDisplayName } from "@/lib/mapDisplayName";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID, getCity } from "@/lib/cities";
import { ONBOARDING_DISMISSED_KEY } from "@/lib/onboardingDismissal";
import type { UkPlaceMapArrival } from "@/lib/ukPlaceSearch";
import type { ZonePintIndex } from "@/lib/zones";
// PubMap and PubMapCanvas load side by side from this shell: the canvas is
// warmed when this module runs and PubMap renders below. A module both of them
// import therefore ships in both chunk groups, unless this shell already holds
// it. Both read the venue model and the UK base pubs, so the shell holds those
// and each crosses the wire once.
import "@/lib/venues";
import "@/lib/ukBasePubs";

// next/dynamic hands its loading component no props, so the city the shell is
// about reaches the held skeleton through context instead. The placeholder
// renders in PubMap's own position, inside the provider below.
const MapSkeletonCityContext = createContext<string>("");

function DynamicMapSkeleton() {
  return (
    <MapLoadingSkeleton
      cityDisplayName={useContext(MapSkeletonCityContext)}
      pricesReadLine={useContext(MapPricesReadContext)}
    />
  );
}

const PubMap = dynamic(() => import("./PubMap"), {
  ssr: false,
  loading: () => <DynamicMapSkeleton />,
});

// Cold /map (London prerendered document only): start the MapLibre canvas
// chunk as soon as this module evaluates, instead of waiting for useEffect.
if (typeof window !== "undefined") {
  const path = window.location.pathname;
  if (path === "/map" || path === "/map/") {
    warmMapFirstPaint();
  }
}

// lib/onboardingDismissal.ts owns the dismissal key and its storage contract.
function restoreOnboardingDismissal(): null {
  if (typeof window === "undefined") return null;
  try {
    if (
      window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1" &&
      window.sessionStorage.getItem(ONBOARDING_DISMISSED_KEY) !== "1"
    ) {
      window.sessionStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    }
  } catch {
    // Storage can throw (private mode / quota); the overlay then just keeps
    // its previous per-session behaviour.
  }
  return null;
}

function persistOnboardingDismissal(): void {
  try {
    if (
      window.sessionStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1" &&
      window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== "1"
    ) {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    }
  } catch {
    // Best-effort only — see restoreOnboardingDismissal.
  }
}

type PubMaxingShellProps = {
  cityId?: CityId;
  // Server-resolved uncovered-place arrival, checked against our own place
  // index (lib/ukPlaceIndex.server). The client never reads the place name off
  // the query string, so no stranger's copy can be rendered as ours, and a soft
  // navigation cannot lose the arrival to an empty location.search at mount.
  placeArrival?: UkPlaceMapArrival | null;
  /** Explicit UK-wide browse (`/map?uk=1`). Passed to PubMap as nationalBrowse. */
  ukNationalBrowse?: boolean;
  /** The published fare-zone medians (`loadZonePintIndex`), so every surface prints one figure per zone. */
  zonePintIndex?: ZonePintIndex | null;
  /**
   * The bundled London pint snapshot's date line (`mapPricesReadLineFor`), built by the
   * page on the server. Both loading screens print it; null prints nothing.
   */
  pricesReadLine?: string | null;
};

export default function PubMaxingShell({
  cityId = DEFAULT_CITY_ID,
  placeArrival = null,
  ukNationalBrowse = false,
  zonePintIndex = null,
  pricesReadLine = null,
}: PubMaxingShellProps) {
  // Lazy initializer = runs exactly once, before the dynamic PubMap (ssr:false)
  // can possibly have mounted and read the sessionStorage flag.
  useState(restoreOnboardingDismissal);

  // Start the first frame's two certain dependencies after React commits this
  // shell. Starting the dynamic import inside a state initializer updates
  // Next's development style runtime while this component is still rendering.
  useEffect(() => {
    warmCityMapFirstPaint(cityId);
  }, [cityId]);
  // Defer the check after clicks and key presses so PubMap can write its
  // dismissal before the shell persists it.
  useEffect(() => {
    const onInteract = () => {
      window.setTimeout(persistOnboardingDismissal, 0);
    };
    window.addEventListener("click", onInteract, true);
    window.addEventListener("keydown", onInteract, true);
    return () => {
      window.removeEventListener("click", onInteract, true);
      window.removeEventListener("keydown", onInteract, true);
    };
  }, []);

  // Same name PubMap prints once it mounts, so the held frame and the live map
  // never call the same map two things.
  const mapDisplayName = resolveMapDisplayName({
    placeName: placeArrival?.name,
    ukNationalBrowse,
    cityDisplayName: getCity(cityId).displayName,
  });

  return (
    <MapSkeletonCityContext.Provider value={mapDisplayName}>
      <MapPricesReadContext.Provider value={pricesReadLine}>
        <h1 className="sr-only">{mapDisplayName} pub map</h1>
        <PubMap
          key={cityId}
          cityId={cityId}
          placeArrival={placeArrival}
          nationalBrowse={ukNationalBrowse}
          zonePintIndex={zonePintIndex}
        />
        {/* A city with no listed prices says so (lib/cityPubsOnlyNote.ts). It
            mounts here, outside the edit-locked PubMap, and portals into the
            map stage so the banner staging rules reach it. A UK place arrival
            or national browse already explains its own coverage. */}
        {placeArrival || ukNationalBrowse ? null : <CityPubsOnlyNoteMount key={`coverage:${cityId}`} cityId={cityId} />}
      </MapPricesReadContext.Provider>
    </MapSkeletonCityContext.Provider>
  );
}
