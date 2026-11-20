"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";

import { isPasswordRecoveryUrl } from "@/lib/passwordRecovery";

import { analyticsCollectionAllowed, subscribeAnalyticsConsent } from "@/lib/analytics";

import { shouldMountVercelAnalytics, vercelTelemetryUrlAllowed } from "@/components/ConsentAwareVercelAnalytics";

const SpeedInsights = lazy(() => import("@vercel/speed-insights/next").then((module) => ({ default: module.SpeedInsights })));
const serverConsent = () => false;

export type SpeedInsightsBeforeSendEvent = {
  type: "vital";
  url: string;
  route?: string;
};

/** Vercel Speed Insights vitals stay disabled until explicit analytics consent. */
export function consentAwareSpeedInsightsBeforeSend(
  event: SpeedInsightsBeforeSendEvent,
): SpeedInsightsBeforeSendEvent | null {
  if (!analyticsCollectionAllowed() || isPasswordRecoveryUrl(event.url) ||
      event.type !== "vital" || !vercelTelemetryUrlAllowed(event.url, event.route)) return null;
  return event.route === undefined
    ? { type: event.type, url: event.url }
    : { type: event.type, url: event.url, route: event.route };
}

/** Mount on Vercel after consent. Recheck consent before every measurement. */
export default function ConsentAwareVercelSpeedInsights() {
  const allowed = useSyncExternalStore(subscribeAnalyticsConsent, analyticsCollectionAllowed, serverConsent);
  if (!allowed || !shouldMountVercelAnalytics(process.env.NODE_ENV, process.env.VERCEL)) return null;
  return (
    <Suspense fallback={null}><SpeedInsights beforeSend={consentAwareSpeedInsightsBeforeSend} /></Suspense>
  );
}
