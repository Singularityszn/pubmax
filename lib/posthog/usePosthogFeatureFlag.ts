"use client";

import { useEffect, useState } from "react";

import { analyticsCollectionAllowed } from "@/lib/analytics";
import { loadPosthogClientForIdentity } from "@/lib/posthogClient";

/**
 * Read a PostHog feature flag after consent-gated SDK init. Returns `undefined`
 * until flags load; no existing product behaviour should depend on this hook yet.
 */
export function usePosthogFeatureFlag(flagKey: string): boolean | undefined {
  const consentAllowed = analyticsCollectionAllowed();
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!flagKey || !consentAllowed) return;
    let cancelled = false;
    void loadPosthogClientForIdentity().then((client) => {
      if (!client || cancelled) return;
      const read = () => {
        const value = client.isFeatureEnabled(flagKey);
        setEnabled(value === true);
      };
      client.onFeatureFlags(read);
      read();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [consentAllowed, flagKey]);

  if (!flagKey || !consentAllowed) return undefined;
  return enabled;
}
