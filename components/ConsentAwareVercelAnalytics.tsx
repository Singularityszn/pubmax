"use client";

import { useEffect } from "react";

import {
  Analytics,
  type BeforeSendEvent,
} from "@vercel/analytics/next";

import {
  analyticsCollectionAllowed,
  flushVerifiedAnalyticsOutbox,
} from "@/lib/analytics";
import {
  safeVercelTelemetryLocation,
  shouldMountVercelTelemetry,
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
): boolean {
  return shouldMountVercelTelemetry(environment, vercelDeployment);
}

/** Vercel pageviews remain disabled until explicit analytics consent. */
export default function ConsentAwareVercelAnalytics({
  enabled,
}: {
  enabled: boolean;
}) {
  useEffect(() => { void flushVerifiedAnalyticsOutbox(); }, []);
  if (!enabled) return null;
  return <Analytics beforeSend={consentAwareBeforeSend} />;
}
