"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { analyticsCollectionAllowed, subscribeAnalyticsConsent, trackEvent } from "@/lib/analytics";
import { posterArrival } from "@/lib/posterCodes";
import { isPosterLandingSrc } from "@/lib/posterLanding";

export default function PosterLandingAnalytics(): null {
  const pathname = usePathname();
  const query = useSearchParams();
  const pending = useRef<ReturnType<typeof posterArrival>>(null);
  const recorded = useRef(false);

  useEffect(() => {
    if (pathname === "/near" && isPosterLandingSrc(query?.get("src")) && query && !recorded.current) {
      pending.current = posterArrival(query);
    }

    const deliver = () => {
      if (!pending.current || recorded.current || !analyticsCollectionAllowed()) return;
      const { medium, code } = pending.current;
      recorded.current = true;
      pending.current = null;
      trackEvent("poster_landing", code ? { medium, code } : { medium });
    };

    deliver();
    return subscribeAnalyticsConsent(deliver);
  }, [pathname, query]);

  return null;
}
