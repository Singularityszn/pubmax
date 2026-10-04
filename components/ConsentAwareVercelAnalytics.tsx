"use client";

import { useEffect } from "react";

import {
  Analytics,
  type BeforeSendEvent,
} from "@vercel/analytics/next";

import { analyticsCollectionAllowed, flushVerifiedAnalyticsOutbox } from "@/lib/analytics";

// Vercel receives only these public static pages. PostHog has its own vocabulary.
const PUBLIC_VERCEL_PATHS = new Set([
  "/", "/about", "/borough", "/crawls", "/historic", "/map", "/near",
  "/places", "/pint-index", "/privacy", "/pubs", "/terms", "/today", "/tonight",
]);

function publicVercelUrl(value: string, origin: string): boolean {
  // Reject normalization and raw delimiters, including a bare ? or #.
  if (typeof value !== "string" || /[\s%\\?#]/u.test(value)) return false;
  try {
    const url = new URL(value, origin);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === origin && PUBLIC_VERCEL_PATHS.has(url.pathname) &&
      (value === url.pathname || value === `${origin}${url.pathname}`);
  } catch {
    return false;
  }
}

/** Check current context again, including callbacks retained or buffered by the SDK. */
export function vercelTelemetryUrlAllowed(eventUrl: string, route?: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const { origin, href } = window.location;
    if (!publicVercelUrl(href, origin) || !publicVercelUrl(eventUrl, origin)) return false;
    if (route !== undefined && !publicVercelUrl(route, origin)) return false;
    const referrer = window.document.referrer;
    return referrer === undefined || referrer === "" || publicVercelUrl(referrer, origin);
  } catch {
    return false;
  }
}

export function consentAwareBeforeSend(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  if (!analyticsCollectionAllowed() || event.type !== "pageview" ||
      !vercelTelemetryUrlAllowed(event.url)) return null;
  // Do not forward undeclared fields supplied by a future SDK callback.
  return { type: event.type, url: event.url };
}

export function shouldMountVercelAnalytics(
  environment: string | undefined,
  vercelDeployment?: string,
): boolean {
  return environment === "production" && vercelDeployment === "1";
}

/** Vercel pageviews remain disabled until explicit analytics consent. */
export default function ConsentAwareVercelAnalytics() {
  useEffect(() => { void flushVerifiedAnalyticsOutbox(); }, []);
  if (!shouldMountVercelAnalytics(process.env.NODE_ENV, process.env.VERCEL)) return null;
  return <Analytics beforeSend={consentAwareBeforeSend} />;
}
