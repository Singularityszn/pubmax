"use client";

import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";

import type { BeforeSendEvent } from "@vercel/analytics/next";

import { isPasswordRecoveryUrl } from "@/lib/passwordRecovery";

import { analyticsCollectionAllowed, flushVerifiedAnalyticsOutbox, subscribeAnalyticsConsent } from "@/lib/analytics";

const Analytics = lazy(() => import("@vercel/analytics/next").then((module) => ({ default: module.Analytics })));
const serverConsent = () => false;

const PUBLIC_VERCEL_PATHS = new Set([
  "/", "/about", "/borough", "/crawls", "/historic", "/map", "/near",
  "/places", "/pint-index", "/privacy", "/pubs", "/terms", "/today", "/tonight",
]);

function publicVercelUrl(value: string, origin: string): boolean {
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
  if (!analyticsCollectionAllowed() || isPasswordRecoveryUrl(event.url) ||
      event.type !== "pageview" || !vercelTelemetryUrlAllowed(event.url)) return null;
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
  const allowed = useSyncExternalStore(subscribeAnalyticsConsent, analyticsCollectionAllowed, serverConsent);
  useEffect(() => { void flushVerifiedAnalyticsOutbox(); }, []);
  if (!allowed || !shouldMountVercelAnalytics(process.env.NODE_ENV, process.env.VERCEL)) return null;
  return <Suspense fallback={null}><Analytics beforeSend={consentAwareBeforeSend} /></Suspense>;
}
