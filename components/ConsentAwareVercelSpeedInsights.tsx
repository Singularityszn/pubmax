"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";

import { analyticsCollectionAllowed } from "@/lib/analytics";

import { shouldMountVercelAnalytics } from "@/components/ConsentAwareVercelAnalytics";

export type SpeedInsightsBeforeSendEvent = {
  type: "vital";
  url: string;
  route?: string;
};

/** Vercel Speed Insights vitals stay disabled until explicit analytics consent. */
export function consentAwareSpeedInsightsBeforeSend(
  event: SpeedInsightsBeforeSendEvent,
): SpeedInsightsBeforeSendEvent | null {
  return analyticsCollectionAllowed() ? event : null;
}

/** Speed Insights on Vercel only, consent-gated via beforeSend. */
export default function ConsentAwareVercelSpeedInsights() {
  if (!shouldMountVercelAnalytics(process.env.NODE_ENV, process.env.VERCEL)) return null;
  return (
    <SpeedInsights beforeSend={consentAwareSpeedInsightsBeforeSend} />
  );
}
