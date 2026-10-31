"use client";

import { useCallback, useRef } from "react";

import { trackEvent } from "@/lib/analytics";

/** Keep the latest choice across map rebuilds without sending its key. */
export function usePalLeadStarted(): (key: string) => void {
  const reported = useRef<string | null>(null);
  return useCallback((key: string) => {
    if (reported.current === key) return;
    reported.current = key;
    trackEvent("pal_lead_started");
  }, []);
}
