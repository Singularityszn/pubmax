"use client";

import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SpeedInsights } from "@vercel/speed-insights/next";

import {
  analyticsCollectionAllowed,
  subscribeAnalyticsConsent,
} from "@/lib/analytics";
import {
  safeVercelTelemetryLocation,
  shouldMountVercelTelemetryForLocation,
} from "@/lib/vercelTelemetry";

type SpeedInsightsBeforeSendEvent = Parameters<
  NonNullable<ComponentProps<typeof SpeedInsights>["beforeSend"]>
>[0];

export function consentAwareSpeedInsightsBeforeSend(
  event: SpeedInsightsBeforeSendEvent,
): SpeedInsightsBeforeSendEvent | null {
  if (!analyticsCollectionAllowed()) return null;
  const location = safeVercelTelemetryLocation(event.url, window.location.origin);
  return location
    ? { ...event, url: location.url, route: location.route }
    : null;
}

export default function ConsentAwareVercelSpeedInsights({
  enabled,
}: {
  enabled: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [analyticsAllowed, setAnalyticsAllowed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setAnalyticsAllowed(analyticsCollectionAllowed());
    const unsubscribe = subscribeAnalyticsConsent(refresh);
    refresh();
    return unsubscribe;
  }, [enabled]);

  if (
    !enabled
    || !analyticsAllowed
    || !shouldMountVercelTelemetryForLocation(pathname, search)
  ) return null;
  return <SpeedInsights beforeSend={consentAwareSpeedInsightsBeforeSend} />;
}
