import { useEffect, useRef } from "react";

import { resolveMapLogIntent, shouldRunMapLogIntent } from "@/lib/mapLogIntent";
import { markPubmaxTiming } from "@/lib/performanceMarks";

// Map price intents share the venue picker. Legacy log=1 opens Pint Drop;
// contribute=price lets VenueInspector open category capture at the chosen pub.
// The handled ref prevents the same arrival from reopening either flow.
export function useLogIntent(deps: {
  hasLogIntent: boolean;
  hasCategoryPriceIntent: boolean;
  loaded: boolean;
  firstFilteredVenueId: string;
  firstRouteId: string;
  selectedVenueId: string;
  selectedVenueResolvable: boolean;
  selectedVenueIsPub: boolean;
  selectVenue: (id: string) => void;
  openComposerForLog: () => void;
  setFallbackVisible: (visible: boolean) => void;
}) {
  const {
    hasLogIntent,
    hasCategoryPriceIntent,
    loaded,
    firstFilteredVenueId,
    firstRouteId,
    selectedVenueId,
    selectedVenueResolvable,
    selectedVenueIsPub,
    selectVenue,
    openComposerForLog,
    setFallbackVisible,
  } = deps;
  const handled = useRef<"pending" | "fallback" | "open">("pending");

  useEffect(() => {
    if (!hasLogIntent && !hasCategoryPriceIntent) {
      handled.current = "pending";
      setFallbackVisible(false);
      return;
    }
    if (!shouldRunMapLogIntent({ hasLogIntent: hasLogIntent || hasCategoryPriceIntent, handled: handled.current === "open" })) return;
    const resolution = resolveMapLogIntent({
      hasLogIntent: hasLogIntent || hasCategoryPriceIntent,
      loaded,
      selectedVenueId,
      selectedVenueResolvable,
      selectedVenueIsPub,
      firstRouteId,
      firstFilteredVenueId,
    });
    if (resolution.status === "inactive" || resolution.status === "pending") return;
    if (resolution.status === "fallback") {
      if (handled.current !== "fallback") setFallbackVisible(true);
      handled.current = "fallback";
      return;
    }
    handled.current = "open";
    setFallbackVisible(false);
    // The selected venue's Inspector consumes contribute=price and opens its
    // category form or sign-in return. The Pint Drop opener belongs to log=1.
    if (hasCategoryPriceIntent) return;
    markPubmaxTiming("pubmax:drop-route-ready");
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      selectVenue(resolution.venueId);
      openComposerForLog();
    });
    return () => {
      active = false;
    };
  }, [
    hasLogIntent,
    hasCategoryPriceIntent,
    loaded,
    firstFilteredVenueId,
    firstRouteId,
    openComposerForLog,
    selectVenue,
    selectedVenueId,
    selectedVenueIsPub,
    selectedVenueResolvable,
    setFallbackVisible,
  ]);
}
