"use client";

import { Suspense, useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import { samePathWithQuery } from "@/lib/appLink";
import { trackEvent } from "@/lib/analytics";
import {
  clearPosterLandingSession,
  isPosterLandingSrc,
} from "@/lib/posterLanding";
import { readPreferredCity, subscribePreferredCity } from "@/lib/cityPreference";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import {
  NEAR_MODE_QUERY,
  resolveNearMode,
  shouldSwitchNearMode,
  type NearMode,
} from "@/lib/nearDesk";
import {
  readRememberedNearMode,
  subscribeRememberedNearMode,
  writeRememberedNearMode,
} from "@/lib/nearModePreference";
import { resolveNightPatch } from "@/lib/nightPatches";

import NearDeskNow from "./NearDeskNow";
import NearMeNow from "./NearMeNow";
import NearModeSwitch from "./NearModeSwitch";
import PosterLandingNote from "./PosterLandingNote";
import "./nearPage.css";

export function resolveNearAutoLocate(
  searchParams: Pick<URLSearchParams, "get">,
): boolean {
  return searchParams.get("locate") === "1";
}

/**
 * The mode the page renders. `/near` is prerendered once with no query, so
 * the build writes the Pint surface for every URL. Until hydration ends the
 * page must answer Pint too, even for `?mode=desk`, or React finds Desk text
 * where the document holds Pint text and throws #418. The query and the
 * remembered mode both swap in once the browser answers.
 */
export function resolveNearPageMode({
  hydrated,
  modeParam,
  rememberedMode,
}: {
  hydrated: boolean;
  modeParam: string | null;
  rememberedMode: string | null;
}): NearMode {
  if (!hydrated) return "pint";
  return resolveNearMode(modeParam, rememberedMode);
}

function NearPageBody() {
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  // False on the server and through hydration, true after. Everything the
  // body renders from the query waits on it, because the document holds the
  // no-query render (see resolveNearPageMode).
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const cityId = preferredCity ?? DEFAULT_CITY_ID;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const patchParam = searchParams.get("patch");
  const initialPatchId = resolveNightPatch(patchParam)?.id ?? null;
  const autoLocate = resolveNearAutoLocate(searchParams);
  const rememberedMode = useSyncExternalStore(
    subscribeRememberedNearMode,
    readRememberedNearMode,
    () => null,
  );
  const mode = resolveNearPageMode({
    hydrated,
    modeParam: searchParams.get(NEAR_MODE_QUERY),
    rememberedMode,
  });

  const setMode = useCallback((next: NearMode) => {
    if (!shouldSwitchNearMode(mode, next)) return;
    writeRememberedNearMode(next);
    trackEvent("near_mode_switched", { mode: next });
    if (!pathname) return;
    try {
      const params = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
      );
      params.set(NEAR_MODE_QUERY, next);
      const query = params.toString();
      router.replace(samePathWithQuery(pathname, query), { scroll: false });
    } catch {
      // URL sync is best-effort — the remembered mode still stands.
    }
  }, [mode, pathname, router]);

  // Mount-only: a fresh /near load without src=poster must not inherit a stale
  // poster session from an earlier scan in the same tab.
  useEffect(() => {
    if (!isPosterLandingSrc(searchParams.get("src"))) {
      clearPosterLandingSession();
    }
    // Mount-only by contract: later query changes must not clear this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="nmnPage">
      {/* Standard app chrome (journey audit P0): same floating SiteNav pill as
          every other app page. /near is not a primary-nav destination, so no
          active key is set (Map stays unlit). */}
      <SiteNav />
      <main id="main" className="nmnPageBody">
        {/* Physical QR arrival (PLG Wave 2): one honest orientation line when
            the drinker scanned a bar poster into /near?src=poster. */}
        <PosterLandingNote src={hydrated ? searchParams.get("src") : null} />
        <NearModeSwitch value={mode} onChange={setMode} />
        {/* Idle-first on /near so patch chips are reachable without granting
            location. Shareable ?patch= deep links answer immediately. */}
        {mode === "desk" ? (
          <NearDeskNow
            autoLocate={hydrated && autoLocate}
            initialPatchId={initialPatchId}
            syncPatchToUrl
          />
        ) : (
          <NearMeNow
            cityId={cityId}
            autoLocate={hydrated && autoLocate}
            initialPatchId={initialPatchId}
            syncPatchToUrl
            allowVenueAcceptance
            showPriceTrust
          />
        )}
      </main>
    </div>
  );
}

export default function NearPageClient() {
  return (
    <Suspense fallback={<div className="nmnPage" aria-busy="true" />}>
      <NearPageBody />
    </Suspense>
  );
}
