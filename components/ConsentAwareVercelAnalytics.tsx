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

/** Vercel pageviews remain disabled until explicit analytics consent. */
export default function ConsentAwareVercelAnalytics() {
  useEffect(() => { void flushVerifiedAnalyticsOutbox(); }, []);
  return <Analytics beforeSend={consentAwareBeforeSend} />;
}
