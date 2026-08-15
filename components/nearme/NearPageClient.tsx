"use client";

import { Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import { readPreferredCity, subscribePreferredCity } from "@/lib/cityPreference";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { resolveNightPatch } from "@/lib/nightPatches";

import NearMeNow from "./NearMeNow";
import "./nearPage.css";

export function resolveNearAutoLocate(
  searchParams: Pick<URLSearchParams, "get">,
): boolean {
  return searchParams.get("locate") === "1";
}

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
  const autoLocate = resolveNearAutoLocate(searchParams);

  return (
    <div className="nmnPage">
      {/* Standard app chrome (journey audit P0): same floating SiteNav pill as
          every other app page. /near is not a primary-nav destination, so no
          active key is set (Map stays unlit). */}
      <SiteNav />
      <main className="nmnPageBody">
        {/* Idle-first on /near so patch chips are reachable without granting
            location. Shareable ?patch= deep links answer immediately. */}
        <NearMeNow
          cityId={cityId}
          autoLocate={autoLocate}
          initialPatchId={initialPatchId}
          syncPatchToUrl
          intentWrite={intentWrite}
          showPriceTrust
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
