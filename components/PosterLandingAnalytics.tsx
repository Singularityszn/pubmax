"use client";

import { useEffect, useRef } from "react";

import { analyticsCollectionAllowed, subscribeAnalyticsConsent, trackEvent } from "@/lib/analytics";
import { posterArrival } from "@/lib/posterCodes";
import { isPosterLandingSrc } from "@/lib/posterLanding";

export default function PosterLandingAnalytics(): null {
  const recorded = useRef(false);

  useEffect(() => {
    // Hydration can finish after client navigation. Navigation Timing keeps
    // the original document URL even when the router has already left /near.
    const navigation = window.performance.getEntriesByType("navigation")[0];
    const url = new URL(navigation?.name ?? window.location.href);
    if (url.pathname !== "/near" || !isPosterLandingSrc(url.searchParams.get("src"))) return;
    const { medium, code } = posterArrival(url.searchParams);

    const deliver = () => {
      if (recorded.current || !analyticsCollectionAllowed()) return;
      recorded.current = true;
      trackEvent("poster_landing", code ? { medium, code } : { medium });
    };

    deliver();
    return subscribeAnalyticsConsent(deliver);
  }, []);

  return null;
}
