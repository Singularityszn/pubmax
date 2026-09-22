"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  Analytics,
  type BeforeSendEvent,
} from "@vercel/analytics/next";

import {
  analyticsCollectionAllowed,
  flushVerifiedAnalyticsOutbox,
  subscribeAnalyticsConsent,
} from "@/lib/analytics";
import {
  safeVercelTelemetryLocation,
  shouldMountVercelTelemetry,
  shouldMountVercelTelemetryForLocation,
} from "@/lib/vercelTelemetry";

export function consentAwareBeforeSend(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  if (!analyticsCollectionAllowed()) return null;
  const location = safeVercelTelemetryLocation(event.url, window.location.origin);
  return location ? { ...event, url: location.url } : null;
}

export function shouldMountVercelAnalytics(
  environment: string | undefined,
  vercelDeployment?: string,
  vercelEnvironment?: string,
): boolean {
  return shouldMountVercelTelemetry(
    environment,
    vercelDeployment,
    vercelEnvironment,
  );
}

/** Vercel pageviews remain disabled until explicit analytics consent. */
export default function ConsentAwareVercelAnalytics({
  enabled,
}: {
  enabled: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [analyticsAllowed, setAnalyticsAllowed] = useState(false);

  useEffect(() => { void flushVerifiedAnalyticsOutbox(); }, []);
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
  return <Analytics beforeSend={consentAwareBeforeSend} />;
}
