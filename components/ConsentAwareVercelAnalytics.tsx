"use client";

import { useEffect } from "react";

import {
  Analytics,
  type BeforeSendEvent,
} from "@vercel/analytics/next";

import { analyticsCollectionAllowed, flushVerifiedAnalyticsOutbox } from "@/lib/analytics";

export function consentAwareBeforeSend(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  return analyticsCollectionAllowed() ? event : null;
}

export function shouldMountVercelAnalytics(
  environment: string | undefined,
): boolean {
  return environment === "production";
}

/** Vercel pageviews remain disabled until explicit analytics consent. */
export default function ConsentAwareVercelAnalytics() {
  useEffect(() => { void flushVerifiedAnalyticsOutbox(); }, []);
  if (!shouldMountVercelAnalytics(process.env.NODE_ENV)) return null;
  return <Analytics beforeSend={consentAwareBeforeSend} />;
}
