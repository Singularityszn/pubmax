"use client";

import type { ComponentProps } from "react";

import { SpeedInsights } from "@vercel/speed-insights/next";

import { analyticsCollectionAllowed } from "@/lib/analytics";

import { shouldMountVercelAnalytics, vercelTelemetryUrlAllowed } from "@/components/ConsentAwareVercelAnalytics";

export type SpeedInsightsBeforeSendEvent = Parameters<
  NonNullable<ComponentProps<typeof SpeedInsights>["beforeSend"]>
>[0];

/** Vercel Speed Insights vitals stay disabled until explicit analytics consent. */
export function consentAwareSpeedInsightsBeforeSend(
  event: SpeedInsightsBeforeSendEvent,
): SpeedInsightsBeforeSendEvent | null {
  if (!analyticsCollectionAllowed() || event.type !== "vital" ||
      !vercelTelemetryUrlAllowed(event.url, event.route)) return null;
  return event.route === undefined
    ? { type: event.type, url: event.url }
    : { type: event.type, url: event.url, route: event.route };
}

/** Speed Insights on Vercel only, consent-gated via beforeSend. */
export default function ConsentAwareVercelSpeedInsights() {
  if (!shouldMountVercelAnalytics(process.env.NODE_ENV, process.env.VERCEL)) return null;
  return (
    <SpeedInsights beforeSend={consentAwareSpeedInsightsBeforeSend} />
  );
}
