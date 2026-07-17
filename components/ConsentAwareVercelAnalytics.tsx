"use client";

import {
  Analytics,
  type BeforeSendEvent,
} from "@vercel/analytics/next";

import { analyticsCollectionAllowed } from "@/lib/analytics";

export function consentAwareBeforeSend(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  return analyticsCollectionAllowed() ? event : null;
}

/** Vercel pageviews remain disabled until explicit analytics consent. */
export default function ConsentAwareVercelAnalytics() {
  return <Analytics beforeSend={consentAwareBeforeSend} />;
}
