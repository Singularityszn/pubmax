"use client";

import { Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import { readPreferredCity, subscribePreferredCity } from "@/lib/cityPreference";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { resolveNightPatch } from "@/lib/nightPatches";

import NearMeNow from "./NearMeNow";
import PosterLandingNote from "./PosterLandingNote";
import "./nearPage.css";

function NearPageBody({ intentWrite }: { intentWrite: boolean }) {
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const cityId = preferredCity ?? DEFAULT_CITY_ID;
  const searchParams = useSearchParams();
  const patchParam = searchParams.get("patch");
  const initialPatchId = resolveNightPatch(patchParam)?.id ?? null;

  return (
    <div className="nmnPage">
      {/* Standard app chrome (journey audit P0): same floating SiteNav pill as
          every other app page. /near is not a primary-nav destination, so no
          active key is set (Map stays unlit). */}
      <SiteNav />
      <main id="main" className="nmnPageBody">
        {/* Physical QR arrival (PLG Wave 2): one honest orientation line when
            the drinker scanned a bar poster into /near?src=poster. */}
        <PosterLandingNote src={searchParams.get("src")} />
        {/* Idle-first on /near so patch chips are reachable without granting
            location. Shareable ?patch= deep links answer immediately. */}
        <NearMeNow
          cityId={cityId}
          autoLocate={false}
          initialPatchId={initialPatchId}
          syncPatchToUrl
          intentWrite={intentWrite}
        />
      </main>
    </div>
  );
}

export default function NearPageClient({ intentWrite = false }: { intentWrite?: boolean }) {
  return (
    <Suspense fallback={<div className="nmnPage" aria-busy="true" />}>
      <NearPageBody intentWrite={intentWrite} />
    </Suspense>
  );
}
