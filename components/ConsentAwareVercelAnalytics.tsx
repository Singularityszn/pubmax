"use client";

import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";

import type { BeforeSendEvent } from "@vercel/analytics/next";

import { analyticsCollectionAllowed, flushVerifiedAnalyticsOutbox, subscribeAnalyticsConsent } from "@/lib/analytics";

const Analytics = lazy(() => import("@vercel/analytics/next").then((module) => ({ default: module.Analytics })));
const serverConsent = () => false;

export function consentAwareBeforeSend(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  return analyticsCollectionAllowed() ? event : null;
}

export function shouldMountVercelAnalytics(
  environment: string | undefined,
  vercelDeployment?: string,
): boolean {
  return environment === "production" && vercelDeployment === "1";
}

/** Vercel pageviews remain disabled until explicit analytics consent. */
export default function ConsentAwareVercelAnalytics() {
  const allowed = useSyncExternalStore(subscribeAnalyticsConsent, analyticsCollectionAllowed, serverConsent);
  useEffect(() => { void flushVerifiedAnalyticsOutbox(); }, []);
  if (!allowed || !shouldMountVercelAnalytics(process.env.NODE_ENV, process.env.VERCEL)) return null;
  return <Suspense fallback={null}><Analytics beforeSend={consentAwareBeforeSend} /></Suspense>;
}
