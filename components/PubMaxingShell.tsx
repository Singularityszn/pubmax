"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useEffect, useState } from "react";

import MapLoadingSkeleton from "@/components/map/MapLoadingSkeleton";
import { holdBackgroundWarmup } from "@/lib/backgroundWarmup";
import { warmCityMapFirstPaint } from "@/lib/mapWarmup";
import { resolveMapDisplayName } from "@/lib/mapDisplayName";
import { MAP_PIN_REVEAL_EVENT } from "@/lib/mapPinRevealEvent";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID, getCity } from "@/lib/cities";
import {
  TRUSTED_HANDOFF_FLAGS_OFF,
  type TrustedHandoffFlagsDTO,
} from "@/lib/trustedHandoffFlags";
import type { UkPlaceMapArrival } from "@/lib/ukPlaceSearch";

// next/dynamic hands its loading component no props, so the city the shell is
// about reaches the held skeleton through context instead. The placeholder
// renders in PubMap's own position, inside the provider below.
const MapSkeletonCityContext = createContext<string>("");

function DynamicMapSkeleton() {
  return <MapLoadingSkeleton cityDisplayName={useContext(MapSkeletonCityContext)} />;
}

const PubMap = dynamic(() => import("./PubMap"), {
  ssr: false,
  loading: () => <DynamicMapSkeleton />,
});

// ── One-time-ever "Start with a story" onboarding (UX defect fix) ──────────
// PubMap gates its onboarding overlay on a sessionStorage flag, so it came
// back in every new tab/session and covered most of the map (and the search
// box) on mobile. PubMap.tsx is edit-locked this cycle (F1 map decomposition),
// so durability lives here in its unlocked host shell instead:
//   1. before PubMap ever reads the flag, a durable localStorage dismissal is
//      restored into sessionStorage (the key PubMap reads);
//   2. after any user interaction, a dismissal PubMap wrote to sessionStorage
//      is mirrored back into localStorage.
// Net effect: the overlay shows at most once ever per device — the same
// durable pattern as the pubmax-tour-v1-done first-run tour flag. When the F1
// lock lifts, PubMap can read/write localStorage directly and this bridge can
// be deleted.
const ONBOARDING_DISMISSED_KEY = "pubmax_onboarding_dismissed";

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
  // Server-owned trusted-handoff flag DTO, read once in the RSC page and passed
  // down immutably. The client never interprets flag env vars itself.
  flags?: TrustedHandoffFlagsDTO;
  // Server-resolved uncovered-place arrival, checked against our own place
  // index (lib/ukPlaceIndex.server). The client never reads the place name off
  // the query string, so no stranger's copy can be rendered as ours, and a soft
  // navigation cannot lose the arrival to an empty location.search at mount.
  placeArrival?: UkPlaceMapArrival | null;
  /** Explicit UK-wide browse (`/map?uk=1`). Passed to PubMap as nationalBrowse. */
  ukNationalBrowse?: boolean;
};

export default function PubMaxingShell({
  cityId = DEFAULT_CITY_ID,
  flags = TRUSTED_HANDOFF_FLAGS_OFF,
  placeArrival = null,
  ukNationalBrowse = false,
}: PubMaxingShellProps) {
  // Lazy initializer = runs exactly once, before the dynamic PubMap (ssr:false)
  // can possibly have mounted and read the sessionStorage flag.
  useState(restoreOnboardingDismissal);

  // ── Hold background warmup until the map has painted ──────────────────────
  // A cold /map open is main-thread bound: MapLibre's chunk parse, style load,
  // tile decode and scene build all queue behind each other. The site chrome
  // that mounts alongside it warms the OTHER tab destinations, which downloads
  // and parses their route JS. Left to plain browser idle that warmup fires at
  // about one second — after the skeleton paints, before the map's own chunks
  // have even been requested — so it lands squarely inside MapLibre's init.
  //
  // The hold is taken in a lazy initializer rather than an effect because React
  // runs every render before any effect: the nav mounts in the same commit and
  // its effect would otherwise win the race. Released on the canvas's own
  // pin-reveal event, and by lib/backgroundWarmup's ceiling if that never
  // arrives, so warmup is delayed but never lost.
  const [releaseWarmupHold] = useState(() =>
    typeof window === "undefined" ? () => {} : holdBackgroundWarmup(),
  );

  // Start the first frame's two certain dependencies after React commits this
  // shell. Starting the dynamic import inside a state initializer updates
  // Next's development style runtime while this component is still rendering.
  useEffect(() => {
    warmCityMapFirstPaint(cityId);
  }, [cityId]);
  useEffect(() => {
    const release = () => releaseWarmupHold();
    window.addEventListener(MAP_PIN_REVEAL_EVENT, release, { once: true });
    return () => {
      window.removeEventListener(MAP_PIN_REVEAL_EVENT, release);
      release();
    };
  }, [releaseWarmupHold]);

  // Every dismissal path is user-initiated (scrim tap, ✕, "Dismiss / explore",
  // picking a crawl — click or Enter/Escape), so a deferred post-interaction
  // check catches the sessionStorage write without touching the locked PubMap.
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
      <PubMap
        key={cityId}
        cityId={cityId}
        flags={flags}
        placeArrival={placeArrival}
        nationalBrowse={ukNationalBrowse}
      />
    </MapSkeletonCityContext.Provider>
  );
}
